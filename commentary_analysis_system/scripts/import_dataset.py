import os
import sys
import json
import csv
from pathlib import Path
import argparse

SYSTEM_PATH = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(str(SYSTEM_PATH))

from src.data_processing.chunker import create_chunks
from src.data_processing.mapper import map_labels
PROCESSED_SEGMENTS_DIR = SYSTEM_PATH / "data" / "processed" / "segments"
DATASETS_ML_DIR = SYSTEM_PATH / "data" / "processed" / "datasets" / "ml"
DATASETS_LEXICON_DIR = SYSTEM_PATH / "data" / "processed" / "datasets" / "lexicon"

DATASETS_ML_DIR.mkdir(parents=True, exist_ok=True)
DATASETS_LEXICON_DIR.mkdir(parents=True, exist_ok=True)

def parse_imported_csv(csv_path: str) -> list[dict]:
    imported_data = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        # Normalize column names for case-insensitivity and whitespace
        fieldnames = {k.strip().lower(): k for k in reader.fieldnames if k}
        
        # Check required columns
        required = ['t_start', 't_end', 'event_class', 'highlight_score']
        for req in required:
            if req not in fieldnames:
                raise ValueError(f"Missing required column in imported dataset: {req}")
        
        for row in reader:
            try:
                start = float(row[fieldnames['t_start']])
                end = float(row[fieldnames['t_end']])
                event = row[fieldnames['event_class']].strip()
                score = float(row[fieldnames['highlight_score']])
                imported_data.append({
                    "start": start,
                    "end": end,
                    "event": event,
                    "score": score
                })
            except (ValueError, TypeError):
                continue # Skip invalid rows
    return imported_data

def save_dataset(chunks: list[dict], path: Path):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["start_time", "end_time", "Text", "event_class", "highlight_score"])
        for c in chunks:
            if c.get("Text"):
                writer.writerow([
                    c["start_time"], 
                    c["end_time"], 
                    c["Text"], 
                    c.get("event_class", "normal_play"), 
                    c.get("highlight_score", 0.0)
                ])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--match_id", required=True)
    parser.add_argument("--csv_path", required=True)
    args = parser.parse_args()

    match_id = args.match_id
    csv_path = args.csv_path

    # 1. Load segments
    segments_path = PROCESSED_SEGMENTS_DIR / f"segments_{match_id}.json"
    if not segments_path.exists():
        print(f"Error: Segments file not found at {segments_path}. Run 01_prepare_data.py first.")
        sys.exit(1)
        
    with open(segments_path, 'r', encoding='utf-8') as f:
        segments = json.load(f)

    # 2. Parse imported CSV
    try:
        imported_data = parse_imported_csv(csv_path)
    except Exception as e:
        print(f"Error parsing CSV: {e}")
        sys.exit(1)

    # 3. Create ML chunks (5s size, 2s overlap) and map labels
    ml_chunks_raw = create_chunks(segments, chunk_size=5, overlap=2)
    ml_chunks_mapped = map_labels(ml_chunks_raw, imported_data)
    save_dataset(ml_chunks_mapped, DATASETS_ML_DIR / f"dataset_{match_id}.csv")

    # 4. Create Lexicon chunks (5s size, 0.5s overlap) and map labels
    lexicon_chunks_raw = create_chunks(segments, chunk_size=5, overlap=0.5)
    lexicon_chunks_mapped = map_labels(lexicon_chunks_raw, imported_data)
    save_dataset(lexicon_chunks_mapped, DATASETS_LEXICON_DIR / f"dataset_{match_id}.csv")
    
    print("SUCCESS")

if __name__ == "__main__":
    main()
