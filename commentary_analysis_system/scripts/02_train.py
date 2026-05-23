import argparse
import pandas as pd
from pathlib import Path
from src.models.transformer_classifier import TransformerClassifier

PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    args = parser.parse_args()
    
    if not PROCESSED_DATASETS_DIR.exists():
        print("No processed datasets found. Run 01_prepare_data.py first.")
        return
        
    # Retrieve distinct CSV file maps
    csv_files = [str(f) for f in PROCESSED_DATASETS_DIR.glob("*.csv")]
        
    if not csv_files:
        print("No match CSV data present.")
        return
    
    print(f"Beginning training for {args.model_name} strictly parsing {len(csv_files)} specific files from raw disk...")
    
    classifier = TransformerClassifier(model_name=args.model_name)
    # Output dir based on model name (strip org prefix if any)
    safe_name = args.model_name.replace("/", "_")
    output_dir = f"data/output/{safe_name}_finetuned"
    
    # Can adjust epochs and batch_size (HuggingFace maps arrow batches efficiently)
    classifier.train(csv_files, output_dir=output_dir, epochs=5)
    print("Training finished. Best model checkpoint saved reliably!")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
