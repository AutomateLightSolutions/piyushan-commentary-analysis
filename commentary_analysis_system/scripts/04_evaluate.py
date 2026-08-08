import json
import argparse
from pathlib import Path
from datetime import datetime
from src.pipeline.evaluator import (
    compute_regression_metrics,
    print_classification_table,
    print_regression_table,
    print_per_class_table,
    compute_multiclass_metrics,
    compute_per_class_metrics,
)
from src.utils.config import get_threshold

OUTPUT_DIR = Path("data/output")
DB_FILE = OUTPUT_DIR / "evaluation_metrics.json"
EVENTS_FILE = Path("data/events.json")

METHODS = ["Lexicon Only", "ML Model Only", "Hybrid Model"]
PREDICTION_KEYS = {
    "Lexicon Only": "lexicon_predicted_event",
    "ML Model Only": "roberta_predicted_event",
    "Hybrid Model": "hybrid_predicted_event",
}
SCORE_KEYS = {
    "Lexicon Only": "lexicon_score",
    "ML Model Only": "roberta_score",
    "Hybrid Model": "hybrid_score",
}

def load_all_event_classes() -> list[str]:
    """normal_play plus every event configured in data/events.json (see the
    manage-events UI) - the canonical class list for per-class reporting, so
    every match's table has a consistent, complete row set."""
    events = []
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "r", encoding="utf-8") as f:
            events = json.load(f)
    return ["normal_play"] + events

def _true_events(chunks: list[dict]) -> list[str]:
    events = []
    for chunk in chunks:
        event = chunk.get("event")
        if not event or str(event).strip() in ['', '-', 'None']:
            event = "normal_play"
        events.append(event)
    return events

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--dataset", type=str, default="all", help="Comma-separated dataset(s) to run on, or 'all'")
    parser.add_argument("--split", type=str, default="all", choices=["all", "train", "val", "test"],
                        help="Evaluate only chunks belonging to this split role (default: all)")
    args = parser.parse_args()

    if not OUTPUT_DIR.exists():
        print("Run 03_run_pipeline.py first.")
        return

    safe_name = args.model_name.replace("/", "_")

    if args.dataset != "all":
        match_ids = [d.strip() for d in args.dataset.split(",") if d.strip()]
        prediction_files = [
            f for match_id in match_ids
            for f in OUTPUT_DIR.glob(f"predictions_{safe_name}_{match_id}.json")
        ]
    else:
        prediction_files = list(OUTPUT_DIR.glob(f"predictions_{safe_name}_*.json"))

    if not prediction_files:
        print(f"No prediction files found for model {args.model_name}.")
        return

    # Load existing DB
    if DB_FILE.exists():
        with open(DB_FILE, "r", encoding="utf-8") as f:
            metrics_db = json.load(f)
    else:
        metrics_db = []

    state_file = OUTPUT_DIR / "model_states.json"
    if state_file.exists():
        with open(state_file, 'r') as f:
            states = json.load(f)
        current_training_round = states.get(args.model_name, {}).get("training_round", 1)
        training_datasets = states.get(args.model_name, {}).get("history", {}).get(str(current_training_round), [])
    else:
        current_training_round = 1
        training_datasets = []

    # Find evaluation round for this specific training round
    existing_evals = [m for m in metrics_db if m.get("model_used") == args.model_name and m.get("training_round") == current_training_round]
    current_eval_round = len(existing_evals) + 1

    all_classes = load_all_event_classes()

    total_metrics = {
        "Classification": {
            method: {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0} for method in METHODS
        },
        "Regression": {
            method: {"mse": 0.0, "mae": 0.0} for method in METHODS
        },
        "PerClass": {
            method: {cls: {"precision": 0.0, "recall": 0.0, "f1": 0.0, "support": 0} for cls in all_classes}
            for method in METHODS
        }
    }

    num_files = 0
    timestamp = datetime.now().isoformat()

    # Pooled across every evaluated match, for a statistically sound
    # "Combined" figure - mirrors colab_evaluation.py's COMBINED section,
    # which concatenates raw predictions across matches before scoring
    # rather than averaging already-computed per-match rates (as
    # total_metrics below does). Averaging per-match rates directly
    # distorts rare classes: a class with 0-3 samples in a given match
    # still counts as one full, equally-weighted data point in that
    # average, regardless of how little evidence it represents.
    pooled_true_event = []
    pooled_pred_event = {method: [] for method in METHODS}
    pooled_true_score = []
    pooled_pred_score = {method: [] for method in METHODS}

    for pred_file in prediction_files:
        match_id = pred_file.stem.replace(f"predictions_{safe_name}_", "")
        dataset_name = f"dataset_{match_id}"

        with open(pred_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)

        # Filter by split role if requested
        if args.split != "all":
            filtered = [c for c in chunks if c.get("split") == args.split]
            if not filtered:
                print(f"  WARNING: No chunks with split='{args.split}' in {pred_file.name}. Skipping.")
                continue
            print(f"  {pred_file.name}: {len(chunks)} total -> {len(filtered)} '{args.split}' chunks")
            chunks = filtered

        true_event = _true_events(chunks)
        true_score = [float(c.get("score", 0.0)) for c in chunks]

        classification_metrics, per_class_metrics, regression_metrics = {}, {}, {}
        for method in METHODS:
            pred_event = [c.get(PREDICTION_KEYS[method], "normal_play") for c in chunks]
            pred_score = [float(c.get(SCORE_KEYS[method], 0.0)) for c in chunks]

            classification_metrics[method] = compute_multiclass_metrics(true_event, pred_event, all_classes)
            per_class_metrics[method] = compute_per_class_metrics(true_event, pred_event, all_classes)
            regression_metrics[method] = compute_regression_metrics(true_score, pred_score)

            pooled_pred_event[method].extend(pred_event)
            pooled_pred_score[method].extend(pred_score)

        pooled_true_event.extend(true_event)
        pooled_true_score.extend(true_score)

        # Append to DB
        record = {
            "id": f"{match_id}_{current_training_round}_{current_eval_round}_{int(datetime.now().timestamp())}",
            "match_id": match_id,
            "dataset_name": dataset_name,
            "training_round": current_training_round,
            "training_datasets": training_datasets,
            "evaluation_round": current_eval_round,
            "model_used": args.model_name,
            "timestamp": timestamp,
            "metrics": {
                "Classification": classification_metrics,
                "Regression": regression_metrics,
                "PerClass": per_class_metrics,
            }
        }
        metrics_db.append(record)

        # Accumulate sums for the per-match-averaged summary
        for method in METHODS:
            for key in ["accuracy", "precision", "recall", "f1"]:
                total_metrics["Classification"][method][key] += classification_metrics[method][key]
            for key in ["mse", "mae"]:
                total_metrics["Regression"][method][key] += regression_metrics[method][key]
            for cls, m in per_class_metrics[method].items():
                total_metrics["PerClass"][method][cls]["precision"] += m["precision"]
                total_metrics["PerClass"][method][cls]["recall"] += m["recall"]
                total_metrics["PerClass"][method][cls]["f1"] += m["f1"]
                total_metrics["PerClass"][method][cls]["support"] += m["support"]

        num_files += 1

    # Save DB
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(metrics_db, f, indent=4)

    if num_files > 0:
        # Average Classification
        for method in total_metrics["Classification"]:
            for key in ["accuracy", "precision", "recall", "f1"]:
                total_metrics["Classification"][method][key] = round(total_metrics["Classification"][method][key] / num_files, 2)

        # Average Regression
        for method in total_metrics["Regression"]:
            for key in ["mse", "mae"]:
                total_metrics["Regression"][method][key] = round(total_metrics["Regression"][method][key] / num_files, 4)

        # Average PerClass (precision/recall/f1 averaged across matches;
        # support stays summed - it's a real total count, not a rate)
        for method in total_metrics["PerClass"]:
            for cls in total_metrics["PerClass"][method]:
                for key in ["precision", "recall", "f1"]:
                    total_metrics["PerClass"][method][cls][key] = round(
                        total_metrics["PerClass"][method][cls][key] / num_files, 2
                    )

        # Combined: pool raw predictions across every evaluated match and
        # score once - see the note above pooled_true_event.
        combined_classification, combined_per_class, combined_regression = {}, {}, {}
        for method in METHODS:
            combined_classification[method] = compute_multiclass_metrics(
                pooled_true_event, pooled_pred_event[method], all_classes
            )
            combined_per_class[method] = compute_per_class_metrics(
                pooled_true_event, pooled_pred_event[method], all_classes
            )
            combined_regression[method] = compute_regression_metrics(
                pooled_true_score, pooled_pred_score[method]
            )

        print(f"--- Macro-Averaged Evaluation over {num_files} matches for {args.model_name} (Training Round {current_training_round}, Eval {current_eval_round}) ---")
        print_classification_table(total_metrics["Classification"])
        print_regression_table(total_metrics["Regression"])
        print_per_class_table(total_metrics["PerClass"]["ML Model Only"], title="Event Detection Per-Event Breakdown (ML Model)")

        print(f"\n--- Combined (pooled across all {num_files} matches) for {args.model_name} ---")
        print_classification_table(combined_classification)
        print_regression_table(combined_regression)
        print_per_class_table(combined_per_class["ML Model Only"], title="Combined Per-Event Breakdown (ML Model)")

        for method in METHODS:
            for key in ["accuracy", "precision", "recall", "f1"]:
                combined_classification[method][key] = round(combined_classification[method][key], 2)
            for key in ["mse", "mae"]:
                combined_regression[method][key] = round(combined_regression[method][key], 4)
            for cls in combined_per_class[method]:
                for key in ["precision", "recall", "f1"]:
                    combined_per_class[method][cls][key] = round(combined_per_class[method][cls][key], 2)

        total_metrics["Combined"] = {
            "Classification": combined_classification,
            "Regression": combined_regression,
            "PerClass": combined_per_class,
        }

        # We output this JSON to stdout line by line or emit it via SSE
        print(f"__METRICS__:{json.dumps(total_metrics)}")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
