import json
import argparse
from pathlib import Path
import sys

# Ensure we can import from src
sys.path.append(str(Path(__file__).parent.parent))

from src.pipeline.evaluator import compute_metrics

OUTPUT_DIR = Path("data/output")

# Maps each threshold setting key → the prediction score column to sweep
THRESHOLD_TARGETS = {
    "lexicon_threshold": "lexicon_score",
    "ml_threshold":      "roberta_score",
    "hybrid_threshold":  "hybrid_score",
    "merger_threshold":  "hybrid_score",   # merger uses hybrid_score but saved separately
}

def evaluate_method(chunks: list[dict], score_key: str, threshold: float) -> dict:
    y_true = []
    y_pred = []

    for chunk in chunks:
        event = chunk.get("event")
        if event and str(event).strip() not in ['', '-', 'None', 'normal_play']:
            label = 1
        else:
            label = chunk.get("label", 0)

        y_true.append(label)
        y_pred.append(1 if chunk.get(score_key, 0.0) >= threshold else 0)

    return compute_metrics(y_true, y_pred)


def sweep_threshold(chunks: list[dict], score_key: str) -> dict:
    """Sweep threshold from 0.10 to 0.90 in steps of 0.05, return results + best."""
    results = []

    for t in range(10, 95, 5):
        threshold = t / 100.0
        metrics = evaluate_method(chunks, score_key, threshold=threshold)

        results.append({
            "threshold": threshold,
            "precision": metrics["precision"],
            "recall":    metrics["recall"],
            "f1":        metrics["f1"],
        })

    best_result = max(results, key=lambda x: x["f1"])
    for r in results:
        r["is_best"] = (r["threshold"] == best_result["threshold"])

    return {"results": results, "best": best_result}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base",
                        help="HuggingFace model string")
    args = parser.parse_args()

    if not OUTPUT_DIR.exists():
        print(json.dumps({"error": "Run 03_run_pipeline.py first to generate predictions."}))
        return

    safe_name = args.model_name.replace("/", "_")
    prediction_files = list(OUTPUT_DIR.glob(f"predictions_{safe_name}_*.json"))

    if not prediction_files:
        print(json.dumps({"error": f"No prediction files found for model {args.model_name}."}))
        return

    # Load all chunks
    all_chunks = []
    for pred_file in prediction_files:
        with open(pred_file, "r", encoding="utf-8") as f:
            all_chunks.extend(json.load(f))

    # Filter to validation split only
    val_chunks = [c for c in all_chunks if c.get("split") == "val"]
    if val_chunks:
        print(
            f"Using {len(val_chunks)} validation chunks out of {len(all_chunks)} total.",
            file=sys.stderr, flush=True
        )
        all_chunks = val_chunks
    else:
        print(json.dumps({
            "error": "No chunks with split='val' found. Run 00_split_data.py then tag_existing_predictions.py first."
        }), flush=True)
        return

    # Sweep every optimizable threshold
    output = {}
    for threshold_key, score_key in THRESHOLD_TARGETS.items():
        print(f"Sweeping {threshold_key} (score: {score_key})...", file=sys.stderr, flush=True)
        output[threshold_key] = sweep_threshold(all_chunks, score_key)

    print(json.dumps(output))


if __name__ == "__main__":
    main()
