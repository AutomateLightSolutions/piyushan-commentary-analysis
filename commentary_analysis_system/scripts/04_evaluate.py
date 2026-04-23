import json
from pathlib import Path
from src.pipeline.evaluator import compute_metrics, print_evaluation_table

OUTPUT_DIR = Path("data/output")

def evaluate_method(chunks: list[dict], score_key: str, threshold: float = 0.65) -> dict:
    y_true = []
    y_pred = []
    
    for chunk in chunks:
        # Assuming label is 1 or 0
        y_true.append(chunk.get("label", 0))
        y_pred.append(1 if chunk.get(score_key, 0.0) >= threshold else 0)
        
    return compute_metrics(y_true, y_pred)

def main():
    if not OUTPUT_DIR.exists():
        print("Run 03_run_pipeline.py first.")
        return
        
    total_metrics = {
        "Lexicon Only": {"precision": 0, "recall": 0, "f1": 0},
        "RoBERTa Only": {"precision": 0, "recall": 0, "f1": 0},
        "Hybrid Model": {"precision": 0, "recall": 0, "f1": 0}
    }
    num_files = 0
    
    for pred_file in OUTPUT_DIR.glob("predictions_*.json"):
        with open(pred_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)
            
        # Evaluate for single match
        lexicon_res = evaluate_method(chunks, "lexicon_score")
        roberta_res = evaluate_method(chunks, "roberta_score")
        hybrid_res = evaluate_method(chunks, "hybrid_score")
        
        # Accumulate sums for macro-average
        for key in ["precision", "recall", "f1"]:
            total_metrics["Lexicon Only"][key] += lexicon_res[key]
            total_metrics["RoBERTa Only"][key] += roberta_res[key]
            total_metrics["Hybrid Model"][key] += hybrid_res[key]
            
        num_files += 1
        
    if num_files > 0:
        # Average
        for method in total_metrics:
            for key in ["precision", "recall", "f1"]:
                total_metrics[method][key] = round(total_metrics[method][key] / num_files, 2)
                
        print(f"--- Macro-Averaged Evaluation over {num_files} matches ---")
        print_evaluation_table(total_metrics)
    else:
        print("No prediction files found.")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
