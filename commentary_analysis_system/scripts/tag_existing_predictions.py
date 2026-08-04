"""
One-off utility: adds "split" tags to existing prediction JSON files
based on split_index.json, without re-running the full pipeline.

Run this once after generating split_index.json.
"""
import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

OUTPUT_DIR  = Path("data/output")
DATASETS_DIR = Path("data/processed/datasets/ml")
SPLIT_FILE  = Path("data/config/split_index.json")

def main():
    if not SPLIT_FILE.exists():
        print("ERROR: split_index.json not found. Run 00_split_data.py first.")
        sys.exit(1)

    with open(SPLIT_FILE, "r", encoding="utf-8") as f:
        split_index = json.load(f)

    prediction_files = list(OUTPUT_DIR.glob("predictions_*.json"))
    if not prediction_files:
        print("No prediction files found in data/output/. Run 03_run_pipeline.py first.")
        sys.exit(1)

    for pred_file in prediction_files:
        # Derive match_id from filename: predictions_{model}_{match_id}.json
        stem = pred_file.stem  # e.g. predictions_roberta-base_match_1_Geo_vs_POR_WCA_2023
        # Strip leading "predictions_" then strip model name up to first "match_"
        without_prefix = stem[len("predictions_"):]
        match_idx = without_prefix.find("match_")
        if match_idx == -1:
            print(f"  Skipping {pred_file.name} — cannot determine match_id")
            continue
        match_id = without_prefix[match_idx:]

        csv_path = DATASETS_DIR / f"dataset_{match_id}.csv"
        if not csv_path.exists():
            print(f"  Skipping {pred_file.name} — no CSV found at {csv_path}")
            continue

        row_assignments = split_index["assignments"].get(match_id)
        if row_assignments is None:
            print(f"  Skipping {pred_file.name} — match_id '{match_id}' not in split_index.json")
            continue

        # Build (start, end) -> split role lookup from CSV row order
        split_lookup = {}
        with open(csv_path, "r", encoding="utf-8") as f:
            header = f.readline().strip().split(",")
            start_col = "start_time" if "start_time" in header else "start"
            end_col   = "end_time"   if "end_time"   in header else "end"
            start_idx = header.index(start_col)
            end_idx   = header.index(end_col)
            for row_idx, line in enumerate(f):
                cols = line.strip().split(",")
                if len(cols) <= max(start_idx, end_idx):
                    continue
                role = row_assignments.get(str(row_idx), "train")
                key  = f"{cols[start_idx]}_{cols[end_idx]}"
                split_lookup[key] = role

        # Load prediction file and tag each chunk
        with open(pred_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)

        tagged = 0
        for chunk in chunks:
            key = f"{chunk['start']}_{chunk['end']}"
            chunk["split"] = split_lookup.get(key, "train")
            tagged += 1

        # Count by role
        counts = {"train": 0, "val": 0, "test": 0}
        for chunk in chunks:
            counts[chunk.get("split", "train")] += 1

        # Save back
        with open(pred_file, "w", encoding="utf-8") as f:
            json.dump(chunks, f)

        print(f"  {pred_file.name}: {tagged} chunks tagged "
              f"(train={counts['train']}, val={counts['val']}, test={counts['test']})")

    print("\nDone. You can now run the Optimization Sweep.")

if __name__ == "__main__":
    main()
