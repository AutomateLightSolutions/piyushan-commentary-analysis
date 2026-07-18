import argparse
import pandas as pd
from pathlib import Path
from src.models.transformer_classifier import TransformerClassifier

PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--dataset", type=str, default="all", help="Specific dataset to train on, or 'all'")
    args = parser.parse_args()
    
    if not PROCESSED_DATASETS_DIR.exists():
        print("No processed datasets found. Run 01_prepare_data.py first.")
        return
        
    # Retrieve distinct CSV file maps
    if args.dataset != "all":
        csv_files = [str(PROCESSED_DATASETS_DIR / f"dataset_{args.dataset}.csv")]
        if not Path(csv_files[0]).exists():
            print(f"Dataset {args.dataset} not found.")
            return
    else:
        csv_files = [str(f) for f in PROCESSED_DATASETS_DIR.glob("*.csv")]
        
    if not csv_files:
        print("No match CSV data present.")
        return
    
    print(f"Beginning training for {args.model_name} strictly parsing {len(csv_files)} specific files from raw disk...")
    
    classifier = TransformerClassifier(model_name=args.model_name)
    # Output dir based on model name (strip org prefix if any)
    safe_name = args.model_name.replace("/", "_")
    output_dir = f"data/output/{safe_name}_finetuned"
    
    classifier.train(csv_files, output_dir=output_dir, epochs=5)
    
    # Update model state tracking
    import json
    state_file = Path("data/output/model_states.json")
    states = {}
    if state_file.exists():
        with open(state_file, 'r') as f:
            states = json.load(f)
            
    current_round = states.get(args.model_name, {}).get("training_round", 0) + 1
    states[args.model_name] = {"training_round": current_round}
    
    with open(state_file, 'w') as f:
        json.dump(states, f, indent=4)
        
    print(f"Training finished. Best model checkpoint saved reliably! Recorded as Training Round {current_round}.")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
