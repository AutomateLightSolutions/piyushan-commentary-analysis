import os
import csv
import json
from pathlib import Path

from src.data_processing.parser import parse_whisper_json
from src.data_processing.chunker import create_chunks


RAW_DIR = Path("data/raw")
PROCESSED_CHUNKS_DIR = Path("data/processed/chunks")
PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

# Create required directories
PROCESSED_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_SEGMENTS_DIR = Path("data/processed/segments")
PROCESSED_SEGMENTS_DIR.mkdir(parents=True, exist_ok=True)

def process_match(match_id: str, json_file: Path):
    print(f"Processing Match {match_id}...")
    
    # 1. Parse JSON
    segments = parse_whisper_json(str(json_file))
    
    # 2. Chunking
    chunks = create_chunks(segments, chunk_size=4, overlap=2)
    
    # 3. Set default label to 0 (No pre-labeling, user will manually label highlights)
    for chunk in chunks:
        chunk['label'] = 0

    # 4. Save chunks JSON
    chunk_json_path = PROCESSED_CHUNKS_DIR / f"chunks_{match_id}.json"
    with open(chunk_json_path, 'w', encoding='utf-8') as f:
        json.dump(chunks, f, indent=2)
        
    # 5. Save segments JSON for dynamic chunking later
    segments_json_path = PROCESSED_SEGMENTS_DIR / f"segments_{match_id}.json"
    with open(segments_json_path, 'w', encoding='utf-8') as f:
        json.dump(segments, f, indent=2)
                
    print(f"  Saved {len(chunks)} chunks and {len(segments)} segments for Match {match_id}.")
    
    # 5. Automatically update existing dataset CSVs (if they exist) so the UI shows the new text
    for dataset_type in ['ml', 'lexicon']:
        csv_path = PROCESSED_DATASETS_DIR / dataset_type / f"dataset_{match_id}.csv"
        if csv_path.exists():
            try:
                import pandas as pd
                df = pd.read_csv(csv_path)
                text_map = {f"{c['start']}_{c['end']}": c["text_clean"] for c in chunks}
                
                # Use start_time/end_time for ML, t_start/t_end if needed
                start_col = 'start_time' if 'start_time' in df.columns else 't_start'
                end_col = 'end_time' if 'end_time' in df.columns else 't_end'
                
                for idx, row in df.iterrows():
                    key = f"{float(row[start_col])}_{float(row[end_col])}"
                    df.at[idx, 'text'] = text_map.get(key, "")
                    
                df.to_csv(csv_path, index=False)
                print(f"  Updated existing text in {dataset_type} CSV for {match_id}")
            except Exception as e:
                print(f"  Failed to update existing CSV for {match_id}: {e}")

import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-file", type=str, help="Specific VTT file to process")
    args = parser.parse_args()

    if not RAW_DIR.exists():
        print(f"Creating raw dir placeholder at {RAW_DIR}")
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print("Please place vtt files (e.g. match_01.vtt) and highlights.json in the raw directory.")
        return

    if args.target_file:
        json_files = [RAW_DIR / args.target_file]
        if not json_files[0].exists():
            print(f"Target file not found: {json_files[0]}")
            return
    else:
        json_files = list(RAW_DIR.glob("*_full.json"))

    if not json_files:
        print("ERROR: No *_full.json files found in data/raw/. Whisper transcription may have failed.")
        sys.exit(1)

    # Process batch
    for json_file in json_files:
        # e.g., 'match_01_full' -> 'match_01'
        match_id = json_file.stem.replace("_full", "")
        
        process_match(match_id, json_file)
        
    print(f"\nSuccessfully processed {len(json_files)} matches.")

if __name__ == "__main__":
    import sys
    # Adding src folder mapping for easy running
    sys.path.append(str(Path(__file__).parent.parent))
    main()
