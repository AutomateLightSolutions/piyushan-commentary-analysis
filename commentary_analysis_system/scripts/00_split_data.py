import json
import argparse
import random
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))

DATASETS_DIR = Path("data/processed/datasets/ml")
CONFIG_DIR = Path("data/config")
SPLIT_FILE = CONFIG_DIR / "split_index.json"

def main():
    parser = argparse.ArgumentParser(description="Generate a reproducible random train/val/test split across all labelled CSV datasets.")
    parser.add_argument("--seed",  type=int,   default=42,   help="Random seed for reproducibility")
    parser.add_argument("--train", type=float, default=0.70, help="Fraction for training (default 0.70)")
    parser.add_argument("--val",   type=float, default=0.15, help="Fraction for validation (default 0.15)")
    parser.add_argument("--test",  type=float, default=0.15, help="Fraction for test (default 0.15)")
    args = parser.parse_args()

    if abs(args.train + args.val + args.test - 1.0) > 1e-6:
        print("ERROR: train + val + test must sum to 1.0")
        sys.exit(1)

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    csv_files = sorted(DATASETS_DIR.glob("*.csv"))
    if not csv_files:
        print("ERROR: No CSV files found in data/processed/datasets/ml/")
        sys.exit(1)

    assignments = {}
    total_train = total_val = total_test = 0

    for csv_file in csv_files:
        match_id = csv_file.stem.replace("dataset_", "")

        # Read rows (skip header)
        with open(csv_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        num_rows = len(lines) - 1  # exclude header

        # Shuffle row indices with fixed seed
        indices = list(range(num_rows))
        rng = random.Random(args.seed)
        rng.shuffle(indices)

        # Compute split boundaries
        n_train = int(num_rows * args.train)
        n_val   = int(num_rows * args.val)
        # test gets the remainder to avoid rounding gaps
        n_test  = num_rows - n_train - n_val

        row_assignments = {}
        for i, idx in enumerate(indices):
            if i < n_train:
                row_assignments[str(idx)] = "train"
            elif i < n_train + n_val:
                row_assignments[str(idx)] = "val"
            else:
                row_assignments[str(idx)] = "test"

        assignments[match_id] = row_assignments

        total_train += n_train
        total_val   += n_val
        total_test  += n_test

        print(f"  {match_id}: {num_rows} rows -> train={n_train}, val={n_val}, test={n_test}")

    split_config = {
        "seed":        args.seed,
        "train_ratio": args.train,
        "val_ratio":   args.val,
        "test_ratio":  args.test,
        "assignments": assignments
    }

    with open(SPLIT_FILE, "w", encoding="utf-8") as f:
        json.dump(split_config, f, indent=2)

    total = total_train + total_val + total_test
    print(f"\nSplit index saved to {SPLIT_FILE}")
    print(f"Total: {total} rows — train={total_train} ({total_train/total:.0%}), "
          f"val={total_val} ({total_val/total:.0%}), "
          f"test={total_test} ({total_test/total:.0%})")

if __name__ == "__main__":
    main()
