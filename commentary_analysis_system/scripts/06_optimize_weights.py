import json
import argparse
from pathlib import Path
import sys

# Ensure we can import from src
sys.path.append(str(Path(__file__).parent.parent))

from src.pipeline.evaluator import compute_metrics
from src.utils.config import get_threshold

OUTPUT_DIR = Path("data/output")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
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
    hybrid_threshold = get_threshold("hybrid_threshold")
    
    print(f"Optimizing Lexicon Weight using fixed hybrid_threshold = {hybrid_threshold}")
    
    # Sweep lexicon_weight from 0.0 to 1.0 in steps of 0.05
    for w in range(0, 105, 5):
        weight = w / 100.0
        
        y_true = []
        y_pred = []
        
        for chunk in all_chunks:
            # 1. Determine Ground Truth
            event = chunk.get("event")
            if event and str(event).strip() not in ['', '-', 'None', 'normal_play']:
                label = 1
            else:
                label = chunk.get("label", 0)
            
            y_true.append(label)
            
            # 2. Recalculate Hybrid Score dynamically for this weight
            r_prob = chunk.get("roberta_score", 0.0)
            l_prob = chunk.get("lexicon_score", 0.0)
            
            # The booster formula!
            new_hybrid_score = min(1.0, r_prob + (l_prob * weight))
            
            # 3. Predict using the standard threshold
            y_pred.append(1 if new_hybrid_score >= hybrid_threshold else 0)
            
        # 4. Evaluate metrics for this weight
        metrics = compute_metrics(y_true, y_pred)
        
        results.append({
            "lexicon_weight": weight,
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1": metrics["f1"]
        })
        
    # Find the weight with max F1
    best_result = max(results, key=lambda x: x["f1"])
    for r in results:
        r["is_best"] = (r["lexicon_weight"] == best_result["lexicon_weight"])

    # Output JSON string for API consumption / easy parsing
    print(json.dumps({"results": results, "best": best_result}, indent=4))

if __name__ == "__main__":
    main()
