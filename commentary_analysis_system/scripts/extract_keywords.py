import argparse
import sys
from pathlib import Path
import pandas as pd
import json

sys.path.append(str(Path(__file__).parent.parent))
from src.data_processing.lexicon_builder import LexiconBuilder

DATASETS_DIR = Path("data/processed/datasets")

def main():
    parser = argparse.ArgumentParser(description="Extract keywords from a dataset CSV")
    parser.add_argument("--dataset", required=True, help="Filename of the dataset (e.g. dataset_match1.csv)")
    args = parser.parse_args()

    dataset_path = DATASETS_DIR / args.dataset
    if not dataset_path.exists():
        print(json.dumps({"error": f"Dataset {args.dataset} not found in {DATASETS_DIR}"}))
        sys.exit(1)

    try:
        df = pd.read_csv(dataset_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read CSV: {str(e)}"}))
        sys.exit(1)

    if 'text' not in df.columns or 'event_class' not in df.columns:
        print(json.dumps({"error": f"CSV must contain 'text' and 'event_class' columns. Found: {list(df.columns)}"}))
        sys.exit(1)

    # Convert dataframe to list of dicts mapped to what LexiconBuilder expects
    data = []
    for _, row in df.iterrows():
        text = str(row['text'])
        event = str(row['event_class'])
        if pd.isna(row['text']) or pd.isna(row['event_class']) or event == 'nan':
            continue
        data.append({"text": text, "event_label": event})

    if not data:
        print(json.dumps({"error": "No valid data found in dataset."}))
        sys.exit(1)

    try:
        builder = LexiconBuilder()
        
        # Use filename as ID, and a clean version as Name
        source_id = args.dataset.replace('.csv', '')
        source_name = args.dataset.replace('dataset_', '').replace('.csv', '').replace('_', ' ').title()
        
        builder.process_dataset(data, source_id=source_id, source_name=source_name)
        print(json.dumps({"success": True, "source": source_name, "processed_chunks": len(data)}))
    except Exception as e:
        print(json.dumps({"error": f"Failed to extract keywords: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
