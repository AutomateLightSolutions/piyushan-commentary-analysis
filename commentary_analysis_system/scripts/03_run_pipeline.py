import json
import argparse
from pathlib import Path
from src.models.hybrid_model import HybridModel
from src.pipeline.merger import merge_chunks
from src.utils.config import get_threshold
from src.data_processing.chunker import build_context_windows

PROCESSED_CHUNKS_DIR = Path("data/processed/chunks")
OUTPUT_DIR = Path("data/output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SPLIT_FILE = Path("data/config/split_index.json")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--dataset", type=str, default="all", help="Comma-separated dataset(s) to run on, or 'all'")
    args = parser.parse_args()
    selected_ids = None if args.dataset == "all" else {d.strip() for d in args.dataset.split(",") if d.strip()}

    # Load split index for tagging chunks
    split_index = None
    if SPLIT_FILE.exists():
        with open(SPLIT_FILE, "r", encoding="utf-8") as f:
            split_index = json.load(f)
        print(f"Split index loaded (seed={split_index['seed']}). Chunks will be tagged with split role.")
    else:
        print("WARNING: No split_index.json found. Run 00_split_data.py first. Chunks will not be tagged.")
    
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

        if selected_ids is not None and match_id not in selected_ids:
            continue
            
        print(f"Running pipeline for {match_id} using {args.model_name}...")
        
        with open(chunk_file, 'r', encoding='utf-8') as f:
            chunks = json.load(f)
            
        # Overlay CSV data if it exists so predictions file gets the true labels
        csv_path = Path(f"data/processed/datasets/ml/dataset_{match_id}.csv")
        if csv_path.exists():
            import pandas as pd
            try:
                df = pd.read_csv(csv_path)
                record_map = {}
                for _, row in df.iterrows():
                    record_map[f"{row.get('start_time', row.get('start'))}_{row.get('end_time', row.get('end'))}"] = {
                        "event": row.get("event_class", row.get("event")),
                        "score": row.get("highlight_score", row.get("score"))
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
        # Load dynamic weights from configuration
        highlight_lexicon_weight = get_threshold("highlight_lexicon_weight", 0.3)
        event_lexicon_weight = get_threshold("event_lexicon_weight", 0.3)

        # Build the same sliding-window context the model was trained on
        # (see colab_backend.py's WINDOW_SIZE) - the lexicon still scores
        # each chunk's own text via `texts`, only RoBERTa's input is windowed.
        roberta_texts = build_context_windows(texts, hybrid_model.roberta.window_size)
        predictions = hybrid_model.predict(
            texts,
            roberta_text_list=roberta_texts,
            roberta_weight=1.0,
            highlight_lexicon_weight=highlight_lexicon_weight,
            event_lexicon_weight=event_lexicon_weight
        )
        
        # 2. Attach predictions back to chunks
        for i, pred in enumerate(predictions):
            chunks[i].update(pred)

        # 3. Tag each chunk with its split role using the CSV row order
        if split_index is not None:
            import pandas as pd
            csv_path_ml = Path(f"data/processed/datasets/ml/dataset_{match_id}.csv")
            if csv_path_ml.exists():
                df = pd.read_csv(csv_path_ml)
                row_assignments = split_index["assignments"].get(match_id, {})
                # Build (start, end) -> split role lookup from CSV row order
                split_lookup = {}
                for row_idx, row in df.iterrows():
                    role = row_assignments.get(str(row_idx), "train")
                    key = f"{row.get('start_time', row.get('start'))}_{row.get('end_time', row.get('end'))}"
                    split_lookup[key] = role
                for chunk in chunks:
                    key = f"{chunk['start']}_{chunk['end']}"
                    chunk["split"] = split_lookup.get(key, "train")
            else:
                # No CSV available — mark all as train
                for chunk in chunks:
                    chunk["split"] = "train"
            
        # 3. Save chunks with predictions (append model_name to avoid overwriting)
        out_chunks_path = OUTPUT_DIR / f"predictions_{safe_name}_{match_id}.json"
        with open(out_chunks_path, 'w', encoding='utf-8') as f:
            json.dump(chunks, f, indent=2)
            
        # 4. Extract Highlight Timestamps
        merged_highlights = merge_chunks(chunks)
        
        out_clips_path = OUTPUT_DIR / f"highlights_timestamps_{safe_name}_{match_id}.json"
        with open(out_clips_path, 'w', encoding='utf-8') as f:
            json.dump(merged_highlights, f, indent=2)
            
    print("Pipeline run complete.")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
