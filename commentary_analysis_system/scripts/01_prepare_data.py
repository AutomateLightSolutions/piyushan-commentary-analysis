import os
import csv
import json
from pathlib import Path

from src.data_processing.parser import parse_vtt
from src.data_processing.chunker import create_chunks


RAW_DIR = Path("data/raw")
PROCESSED_CHUNKS_DIR = Path("data/processed/chunks")
PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

# Create required directories
PROCESSED_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DATASETS_DIR.mkdir(parents=True, exist_ok=True)

def process_match(match_id: str, vtt_file: Path):
    print(f"Processing Match {match_id}...")
    
    # 1. Parse VTT
    segments = parse_vtt(str(vtt_file))
    
    # 2. Chunking
    chunks = create_chunks(segments, chunk_size=5, overlap=2)
    
    # 3. Set default label to 0 (No pre-labeling, user will manually label highlights)
    for chunk in chunks:
        chunk['label'] = 0

    # 4. Save chunks JSON
    chunk_json_path = PROCESSED_CHUNKS_DIR / f"chunks_{match_id}.json"
    with open(chunk_json_path, 'w', encoding='utf-8') as f:
        json.dump(chunks, f, indent=2)
        
    # 5. Save dataset CSV
    dataset_csv_path = PROCESSED_DATASETS_DIR / f"dataset_{match_id}.csv"
    with open(dataset_csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["start", "end", "text", "label"])
        for c in chunks:
            if c["text_clean"]:
                writer.writerow([c["start"], c["end"], c["text_clean"], c.get("label", 0)])
                
    print(f"  Saved {len(chunks)} chunks for Match {match_id}.")

def main():
    if not RAW_DIR.exists():
        print(f"Creating raw dir placeholder at {RAW_DIR}")
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print("Please place vtt files (e.g. match_01.vtt) and highlights.json in the raw directory.")
        return

    vtt_files = list(RAW_DIR.glob("*_full.vtt"))
    if not vtt_files:
        print("ERROR: No *_full.vtt files found in data/raw/. Whisper transcription may have failed.")
        sys.exit(1)

    # Process batch
    for vtt_file in vtt_files:
        # e.g., 'match_01_full' -> 'match_01'
        match_id = vtt_file.stem.replace("_full", "")
        
        process_match(match_id, vtt_file)
        
    print(f"\nSuccessfully processed {len(vtt_files)} matches.")

if __name__ == "__main__":
    import sys
    # Adding src folder mapping for easy running
    sys.path.append(str(Path(__file__).parent.parent))
    main()
