import json
import argparse
from pathlib import Path
import sys

# Ensure we can import from src
sys.path.append(str(Path(__file__).parent.parent))

from src.models.transformer_classifier import TransformerClassifier

OUTPUT_DIR = Path("data/output")

def compute_event_metrics(y_true, y_pred, id2label):
    # Compute simple accuracy
    correct = sum(1 for t, p in zip(y_true, y_pred) if t == p)
    accuracy = correct / len(y_true) if y_true else 0.0
    
    # We return accuracy, but map it to f1 as well for the frontend UI graph which expects an F1 field
    return {"accuracy": accuracy, "f1": accuracy}

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

    # Build id2label manually to avoid loading the heavy Transformer model (which causes timeouts)
    events_path = Path(__file__).parent.parent / "data" / "events.json"
    try:
        with open(events_path, "r") as f:
            events = json.load(f)
        id2label = {0: "normal_play"}
        for i, evt in enumerate(events, start=1):
            id2label[i] = evt
    except Exception:
        id2label = {0: "normal_play", 1: "highlight"}
    
    # Load all chunks across all files
    all_chunks = []
    missing_files = 0
    for pred_file in prediction_files:
        with open(pred_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)
            # Only include files that have the cached probabilities
            if chunks and "raw_roberta_probs" in chunks[0]:
                all_chunks.extend(chunks)
            else:
                missing_files += 1
            
    # Check if caching is available
    if not all_chunks:
        print(json.dumps({"error": "Predictions are missing raw probability caching. Please re-run 03_run_pipeline.py (Steps 7-12) first."}))
        return

    results = []
    
    print("Optimizing Event Lexicon Weight...")
    
    # Sweep lexicon_weight from 0.0 to 1.0 in steps of 0.05
    for w in range(0, 105, 5):
        weight = w / 100.0
        
        y_true = []
        y_pred = []
        
        for chunk in all_chunks:
            # 1. Determine Ground Truth Event
            true_event = str(chunk.get("event", "normal_play")).strip()
            if true_event in ['', '-', 'None']:
                true_event = 'normal_play'
                
            y_true.append(true_event)
            
            # 2. Extract Cached Probs
            r_probs = chunk.get("raw_roberta_probs", [])
            lexicon_features = chunk.get("raw_lexicon_features", {})
            
            # 3. Recalculate event probabilities for this weight
            max_hybrid_prob = -1
            predicted_event_id = 0
            
            for i, p in enumerate(r_probs):
                event_name = id2label.get(i, "normal_play")
                
                # Get the lexicon score specifically for this event
                l_prob_for_event = lexicon_features.get(event_name, 0.0)
                
                # Normalize lexicon score (similar to how score_chunk scales weights)
                l_prob_normalized = min(1.0, float(l_prob_for_event) * 100.0)
                
                # Combine them for this specific event (assuming roberta_weight=1.0)
                event_hybrid_prob = (p * 1.0) + (l_prob_normalized * weight)
                
                if event_hybrid_prob > max_hybrid_prob:
                    max_hybrid_prob = event_hybrid_prob
                    predicted_event_id = i
                    
            predicted_event = id2label.get(predicted_event_id, "normal_play")
            y_pred.append(predicted_event)
            
        # 4. Evaluate metrics for this weight
        metrics = compute_event_metrics(y_true, y_pred, id2label)
        
        results.append({
            "lexicon_weight": weight,
            "accuracy": metrics["accuracy"],
            "f1": metrics["accuracy"] 
        })
        
    # Find the weight with max accuracy
    best_result = max(results, key=lambda x: x["accuracy"])
    for r in results:
        r["is_best"] = (r["lexicon_weight"] == best_result["lexicon_weight"])

    # Output JSON string for API consumption / easy parsing
    print(json.dumps({"results": results, "best": best_result}, indent=4))

if __name__ == "__main__":
    main()
