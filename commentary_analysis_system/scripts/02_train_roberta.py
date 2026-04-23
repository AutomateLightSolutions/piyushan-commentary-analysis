import pandas as pd
from pathlib import Path
from src.models.roberta_classifier import RobertaClassifier

PROCESSED_DATASETS_DIR = Path("data/processed/datasets")

def main():
    if not PROCESSED_DATASETS_DIR.exists():
        print("No processed datasets found. Run 01_prepare_data.py first.")
        return
        
    # Example logic to aggregate up to 25 matches for training
    all_dfs = []
    for csv_file in PROCESSED_DATASETS_DIR.glob("*.csv"):
        df = pd.read_csv(csv_file)
        all_dfs.append(df)
        
    if not all_dfs:
        print("No match CSV data present.")
        return

    master_df = pd.concat(all_dfs, ignore_index=True)
    master_df.dropna(subset=['text'], inplace=True)
    
    # Train test split simply
    train_df = master_df.sample(frac=0.8, random_state=42)
    val_df = master_df.drop(train_df.index)
    
    print(f"Training on {len(train_df)} chunks, validating on {len(val_df)} chunks...")
    
    roberta = RobertaClassifier()
    # Can adjust epochs and batch_size
    roberta.train(train_df, val_df, output_dir="data/output/roberta_finetuned")
    print("Training finished. Best model saved.")

if __name__ == "__main__":
    import sys
    sys.path.append(str(Path(__file__).parent.parent))
    main()
