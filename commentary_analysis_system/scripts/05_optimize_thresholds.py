import json
import argparse
from pathlib import Path
import sys

# Ensure we can import from src
sys.path.append(str(Path(__file__).parent.parent))

from src.pipeline.evaluator import compute_metrics

OUTPUT_DIR = Path("data/output")

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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--score_key", type=str, default="hybrid_score", help="Which score to optimize")
    args = parser.parse_args()
    
    if not OUTPUT_DIR.exists():
        print(json.dumps({"error": "Run 03_run_pipeline.py first to generate predictions."}))
        return
        
    safe_name = args.model_name.replace("/", "_")
    prediction_files = list(OUTPUT_DIR.glob(f"predictions_{safe_name}_*.json"))
    
    if not prediction_files:
        print(json.dumps({"error": f"No prediction files found for model {args.model_name}."}))
        return

    # Load all chunks across all files
    all_chunks = []
    for pred_file in prediction_files:
        with open(pred_file, "r", encoding="utf-8") as f:
            all_chunks.extend(json.load(f))

    results = []
    
    # Sweep threshold from 0.10 to 0.90 in steps of 0.05
    for t in range(10, 95, 5):
        threshold = t / 100.0
        metrics = evaluate_method(all_chunks, args.score_key, threshold=threshold)
        
        results.append({
            "threshold": threshold,
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1": metrics["f1"]
        })
        
    # Find the threshold with max F1
    best_result = max(results, key=lambda x: x["f1"])
    for r in results:
        r["is_best"] = (r["threshold"] == best_result["threshold"])

    # Output JSON string for API consumption
    print(json.dumps({"results": results, "best": best_result}))

if __name__ == "__main__":
    main()
