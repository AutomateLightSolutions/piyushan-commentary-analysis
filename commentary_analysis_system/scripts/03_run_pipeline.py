import json
import argparse
from pathlib import Path
from src.models.hybrid_model import HybridModel
from src.pipeline.merger import merge_chunks

PROCESSED_CHUNKS_DIR = Path("data/processed/chunks")
OUTPUT_DIR = Path("data/output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    args = parser.parse_args()
    
    if not PROCESSED_CHUNKS_DIR.exists():
        print("No processed chunks. Run 01_prepare_data.py first.")
        return
        
    safe_name = args.model_name.replace("/", "_")
    model_path = OUTPUT_DIR / f"{safe_name}_finetuned" / "best"
    
    hybrid_model = HybridModel(
        roberta_model_path=str(model_path) if model_path.exists() else None, 
        model_name=args.model_name
    )
    
    for chunk_file in PROCESSED_CHUNKS_DIR.glob("*.json"):
        match_id = chunk_file.stem.replace("chunks_", "")
        print(f"Running pipeline for {match_id} using {args.model_name}...")
        
        with open(chunk_file, 'r', encoding='utf-8') as f:
            chunks = json.load(f)
            
        # Overlay CSV data if it exists so predictions file gets the true labels
        csv_path = Path(f"data/processed/datasets/dataset_{match_id}.csv")
        if csv_path.exists():
            import pandas as pd
            try:
                df = pd.read_csv(csv_path)
                record_map = {}
                for _, row in df.iterrows():
                    record_map[f"{row['start']}_{row['end']}"] = {
                        "event": row.get("event"),
                        "score": row.get("score")
                    }
                
                for c in chunks:
                    key = f"{c['start']}_{c['end']}"
                    if key in record_map:
                        if pd.notna(record_map[key]["event"]):
                            c["event"] = record_map[key]["event"]
                        if pd.notna(record_map[key]["score"]):
                            c["score"] = record_map[key]["score"]
            except Exception as e:
                print(f"Warning: Could not overlay CSV labels for {match_id}: {e}")
            
        texts = [c["text_clean"] for c in chunks]
        
        # 1. Predict
        predictions = hybrid_model.predict(texts, roberta_weight=0.7, lexicon_weight=0.3)
        
        # 2. Attach predictions back to chunks
        for i, pred in enumerate(predictions):
            chunks[i].update(pred)
            
        # 3. Save chunks with predictions (append model_name to avoid overwriting)
        out_chunks_path = OUTPUT_DIR / f"predictions_{safe_name}_{match_id}.json"
        with open(out_chunks_path, 'w', encoding='utf-8') as f:
            json.dump(chunks, f, indent=2)
            
        # 4. Extract Highlight Timestamps
        merged_highlights = merge_chunks(chunks, threshold=0.40)
        
        out_clips_path = OUTPUT_DIR / f"highlights_timestamps_{safe_name}_{match_id}.json"
        with open(out_clips_path, 'w', encoding='utf-8') as f:
            json.dump(merged_highlights, f, indent=2)
            
    print("Pipeline run complete.")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
