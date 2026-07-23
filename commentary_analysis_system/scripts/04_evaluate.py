import json
import argparse
from pathlib import Path
from datetime import datetime
from src.pipeline.evaluator import compute_metrics, print_evaluation_table, compute_multiclass_metrics
from src.utils.config import get_threshold

OUTPUT_DIR = Path("data/output")
DB_FILE = OUTPUT_DIR / "evaluation_metrics.json"

def evaluate_method(chunks: list[dict], score_key: str, threshold: float = 0.65) -> dict:
    y_true = []
    y_pred = []
    
    for chunk in chunks:
        # Assuming event schema is used, we derived label in training, but in chunks it might be 'event'
        # Let's derive ground truth 'label' safely
        event = chunk.get("event")
        if event and str(event).strip() not in ['', '-', 'None', 'normal_play']:
            label = 1
        else:
            label = chunk.get("label", 0)
            
        y_true.append(label)
        y_pred.append(1 if chunk.get(score_key, 0.0) >= threshold else 0)
        
    return compute_metrics(y_true, y_pred)

def evaluate_multiclass(chunks: list[dict]) -> dict:
    y_true = []
    y_pred = []
    for chunk in chunks:
        event = chunk.get("event")
        if not event or str(event).strip() in ['', '-', 'None']:
            event = "normal_play"
        y_true.append(event)
        
        pred_event = chunk.get("predicted_event", "normal_play")
        y_pred.append(pred_event)
        
    return compute_multiclass_metrics(y_true, y_pred)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    args = parser.parse_args()
    
    if not OUTPUT_DIR.exists():
        print("Run 03_run_pipeline.py first.")
        return
        
    safe_name = args.model_name.replace("/", "_")
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
    else:
        current_training_round = 1
        
    # Find evaluation round for this specific training round
    existing_evals = [m for m in metrics_db if m.get("model_used") == args.model_name and m.get("training_round") == current_training_round]
    current_eval_round = len(existing_evals) + 1
    
    total_metrics = {
        "Lexicon Only": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
        "ML Model Only": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
        "Hybrid Model": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
        "Specific Event (Multi-class)": {"precision": 0.0, "recall": 0.0, "f1": 0.0}
    }
    
    num_files = 0
    timestamp = datetime.now().isoformat()
    
    for pred_file in prediction_files:
        match_id = pred_file.stem.replace(f"predictions_{safe_name}_", "")
        dataset_name = f"dataset_{match_id}"
        
        with open(pred_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)
            
        # Evaluate for single match
        lexicon_res = evaluate_method(chunks, "lexicon_score", threshold=get_threshold("lexicon_threshold"))
        roberta_res = evaluate_method(chunks, "roberta_score", threshold=get_threshold("ml_threshold"))
        hybrid_res = evaluate_method(chunks, "hybrid_score", threshold=get_threshold("hybrid_threshold"))
        multiclass_res = evaluate_multiclass(chunks)
        
        # Append to DB
        record = {
            "id": f"{match_id}_{current_training_round}_{current_eval_round}_{int(datetime.now().timestamp())}",
            "match_id": match_id,
            "dataset_name": dataset_name,
            "training_round": current_training_round,
            "evaluation_round": current_eval_round,
            "model_used": args.model_name,
            "timestamp": timestamp,
            "metrics": {
                "Lexicon Only": lexicon_res,
                "ML Model Only": roberta_res,
                "Hybrid Model": hybrid_res,
                "Specific Event (Multi-class)": multiclass_res
            }
        }
        metrics_db.append(record)
        
        # Accumulate sums for macro-average
        for key in ["precision", "recall", "f1"]:
            total_metrics["Lexicon Only"][key] += lexicon_res[key]
            total_metrics["ML Model Only"][key] += roberta_res[key]
            total_metrics["Hybrid Model"][key] += hybrid_res[key]
            total_metrics["Specific Event (Multi-class)"][key] += multiclass_res[key]
            
        num_files += 1
        
    # Save DB
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(metrics_db, f, indent=4)
        
    if num_files > 0:
        # Average
        for method in total_metrics:
            for key in ["precision", "recall", "f1"]:
                total_metrics[method][key] = round(total_metrics[method][key] / num_files, 2)
                
        print(f"--- Macro-Averaged Evaluation over {num_files} matches for {args.model_name} (Training Round {current_training_round}, Eval {current_eval_round}) ---")
        print_evaluation_table(total_metrics)
        # We output this JSON to stdout line by line or emit it via SSE
        print(f"__METRICS__:{json.dumps(total_metrics)}")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
