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

def load_all_event_classes() -> list[str]:
    """normal_play plus every event configured in data/events.json (see the
    manage-events UI) - the canonical class list for per-class reporting, so
    every match's table has a consistent, complete row set."""
    events = []
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "r", encoding="utf-8") as f:
            events = json.load(f)
    return ["normal_play"] + events

def _extract_labels(chunks: list[dict], prediction_key: str) -> tuple[list[str], list[str]]:
    y_true = []
    y_pred = []
    for chunk in chunks:
        event = chunk.get("event")
        if not event or str(event).strip() in ['', '-', 'None']:
            event = "normal_play"
        y_true.append(event)
        y_pred.append(chunk.get(prediction_key, "normal_play"))
    return y_true, y_pred

def evaluate_regression(chunks: list[dict], score_key: str) -> dict:
    y_true_reg = []
    y_pred_reg = []

    for chunk in chunks:
        y_true_reg.append(float(chunk.get("score", 0.0)))
        y_pred_reg.append(float(chunk.get(score_key, 0.0)))

    return compute_regression_metrics(y_true_reg, y_pred_reg)

def evaluate_multiclass(chunks: list[dict], prediction_key: str) -> dict:
    y_true, y_pred = _extract_labels(chunks, prediction_key)
    return compute_multiclass_metrics(y_true, y_pred)

def evaluate_per_class(chunks: list[dict], prediction_key: str, all_classes: list[str]) -> dict:
    y_true, y_pred = _extract_labels(chunks, prediction_key)
    return compute_per_class_metrics(y_true, y_pred, all_classes)

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
    methods = ["Lexicon Only", "ML Model Only", "Hybrid Model"]

    total_metrics = {
        "Classification": {
            "Lexicon Only": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
            "ML Model Only": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
            "Hybrid Model": {"precision": 0.0, "recall": 0.0, "f1": 0.0}
        },
        "Regression": {
            "Lexicon Only": {"mse": 0.0, "mae": 0.0},
            "ML Model Only": {"mse": 0.0, "mae": 0.0},
            "Hybrid Model": {"mse": 0.0, "mae": 0.0}
        },
        "PerClass": {
            method: {cls: {"precision": 0.0, "recall": 0.0, "f1": 0.0, "support": 0} for cls in all_classes}
            for method in methods
        }
    }

    num_files = 0
    timestamp = datetime.now().isoformat()
    
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
            print(f"  {pred_file.name}: {len(chunks)} total → {len(filtered)} '{args.split}' chunks")
            chunks = filtered
            
        # Evaluate for single match
        lexicon_reg = evaluate_regression(chunks, "lexicon_score")
        roberta_reg = evaluate_regression(chunks, "roberta_score")
        hybrid_reg = evaluate_regression(chunks, "hybrid_score")
        
        lexicon_class = evaluate_multiclass(chunks, "lexicon_predicted_event")
        roberta_class = evaluate_multiclass(chunks, "roberta_predicted_event")
        hybrid_class = evaluate_multiclass(chunks, "hybrid_predicted_event")

        lexicon_per_class = evaluate_per_class(chunks, "lexicon_predicted_event", all_classes)
        roberta_per_class = evaluate_per_class(chunks, "roberta_predicted_event", all_classes)
        hybrid_per_class = evaluate_per_class(chunks, "hybrid_predicted_event", all_classes)

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
                "Classification": {
                    "Lexicon Only": lexicon_class,
                    "ML Model Only": roberta_class,
                    "Hybrid Model": hybrid_class
                },
                "Regression": {
                    "Lexicon Only": lexicon_reg,
                    "ML Model Only": roberta_reg,
                    "Hybrid Model": hybrid_reg
                },
                "PerClass": {
                    "Lexicon Only": lexicon_per_class,
                    "ML Model Only": roberta_per_class,
                    "Hybrid Model": hybrid_per_class
                }
            }
        }
        metrics_db.append(record)

        # Accumulate sums for macro-average
        for key in ["precision", "recall", "f1"]:
            total_metrics["Classification"]["Lexicon Only"][key] += lexicon_class[key]
            total_metrics["Classification"]["ML Model Only"][key] += roberta_class[key]
            total_metrics["Classification"]["Hybrid Model"][key] += hybrid_class[key]

        for key in ["mse", "mae"]:
            total_metrics["Regression"]["Lexicon Only"][key] += lexicon_reg[key]
            total_metrics["Regression"]["ML Model Only"][key] += roberta_reg[key]
            total_metrics["Regression"]["Hybrid Model"][key] += hybrid_reg[key]

        for method, per_class in [
            ("Lexicon Only", lexicon_per_class),
            ("ML Model Only", roberta_per_class),
            ("Hybrid Model", hybrid_per_class),
        ]:
            for cls, m in per_class.items():
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
            for key in ["precision", "recall", "f1"]:
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

        print(f"--- Macro-Averaged Evaluation over {num_files} matches for {args.model_name} (Training Round {current_training_round}, Eval {current_eval_round}) ---")
        print_classification_table(total_metrics["Classification"])
        print_regression_table(total_metrics["Regression"])
        print_per_class_table(total_metrics["PerClass"]["ML Model Only"], title="Event Detection Per-Event Breakdown (ML Model)")

        # We output this JSON to stdout line by line or emit it via SSE
        print(f"__METRICS__:{json.dumps(total_metrics)}")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
