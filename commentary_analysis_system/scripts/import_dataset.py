import os
import sys
import json
import csv
from pathlib import Path
import argparse

SYSTEM_PATH = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(str(SYSTEM_PATH))

from src.data_processing.chunker import create_chunks
from src.data_processing.mapper import map_labels, propagate_labels
PROCESSED_SEGMENTS_DIR = SYSTEM_PATH / "data" / "processed" / "segments"
DATASETS_ML_DIR = SYSTEM_PATH / "data" / "processed" / "datasets" / "ml"
DATASETS_LEXICON_DIR = SYSTEM_PATH / "data" / "processed" / "datasets" / "lexicon"
EVENTS_PATH = SYSTEM_PATH / "data" / "events.json"

DATASETS_ML_DIR.mkdir(parents=True, exist_ok=True)
DATASETS_LEXICON_DIR.mkdir(parents=True, exist_ok=True)

def load_valid_events() -> set[str]:
    # normal_play is the implicit background label and isn't listed in events.json
    valid = {"normal_play"}
    try:
        with open(EVENTS_PATH, 'r', encoding='utf-8') as f:
            valid.update(json.load(f))
    except (OSError, json.JSONDecodeError):
        pass
    return valid

def parse_imported_csv(csv_path: str, valid_events: set[str]) -> tuple[list[dict], dict[str, int]]:
    imported_data = []
    skipped_events = {}
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
            except (ValueError, TypeError):
                continue # Skip invalid rows

            # Reject event_class values outside our defined event vocabulary
            # (e.g. a misaligned column dumping a probability score in here)
            # rather than silently creating a bogus category downstream.
            if event not in valid_events:
                skipped_events[event] = skipped_events.get(event, 0) + 1
                continue

            imported_data.append({
                "start": start,
                "end": end,
                "event": event,
                "score": score
            })
    return imported_data, skipped_events

def save_dataset(chunks: list[dict], path: Path):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["start_time", "end_time", "text", "event_class", "highlight_score"])
        for c in chunks:
            if c.get("text"):
                writer.writerow([
                    c["start_time"], 
                    c["end_time"], 
                    c["text"], 
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
    valid_events = load_valid_events()
    try:
        imported_data, skipped_events = parse_imported_csv(csv_path, valid_events)
    except Exception as e:
        print(f"Error parsing CSV: {e}")
        sys.exit(1)

    if skipped_events:
        total_skipped = sum(skipped_events.values())
        print(f"WARNING: Skipped {total_skipped} row(s) with event_class values outside {sorted(valid_events)}: {skipped_events}")

    if not imported_data:
        print("Error: No valid labeled rows found after filtering. Check that event_class values match the defined events.")
        sys.exit(1)

    # STEP A: Non-overlapping 4s label chunks — aligned with video 8s base windows
    # (4 divides 8 evenly, so every 4s boundary is also an 8s boundary)
    # These are NOT used for training — only for clean label assignment from video data.
    label_chunks_raw = create_chunks(segments, chunk_size=4, overlap=0)
    label_chunks = map_labels(label_chunks_raw, imported_data)

    # STEP B: Overlapping 4s ML training chunks — inherit labels from Step A
    # overlap=2s on a 4s window = 50% overlap, giving model good boundary context
    ml_chunks_raw = create_chunks(segments, chunk_size=4, overlap=2)
    ml_chunks_mapped = propagate_labels(ml_chunks_raw, label_chunks)
    save_dataset(ml_chunks_mapped, DATASETS_ML_DIR / f"dataset_{match_id}.csv")

    # STEP C: Lexicon chunks — inherit labels from Step A
    lexicon_chunks_raw = create_chunks(segments, chunk_size=4, overlap=0.5)
    lexicon_chunks_mapped = propagate_labels(lexicon_chunks_raw, label_chunks)
    save_dataset(lexicon_chunks_mapped, DATASETS_LEXICON_DIR / f"dataset_{match_id}.csv")
    
    print("SUCCESS")

if __name__ == "__main__":
    main()
