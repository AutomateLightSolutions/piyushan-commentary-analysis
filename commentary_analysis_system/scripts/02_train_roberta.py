import pandas as pd
from pathlib import Path
from src.models.roberta_classifier import RobertaClassifier

PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

def main():
    if not PROCESSED_DATASETS_DIR.exists():
        print("No processed datasets found. Run 01_prepare_data.py first.")
        return
        
    # Retrieve distinct CSV file maps
    csv_files = [str(f) for f in PROCESSED_DATASETS_DIR.glob("*.csv")]
        
    if not csv_files:
        print("No match CSV data present.")
        return
    
    print(f"Beginning training strictly parsing {len(csv_files)} specific files from raw disk...")
    
    roberta = RobertaClassifier()
    # Can adjust epochs and batch_size (HuggingFace maps arrow batches efficiently)
    roberta.train(csv_files, output_dir="data/output/roberta_finetuned", epochs=5)
    print("Training finished. Best model checkpoint saved reliably!")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
