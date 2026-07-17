import os
import pandas as pd
import glob

dataset_dir = r"d:\Test FYP\commentary_analysis_system\data\processed\datasets"
csv_files = glob.glob(os.path.join(dataset_dir, "*.csv"))

for file in csv_files:
    try:
        df = pd.read_csv(file)
        if 'event' in df.columns:
            # Replace 'No Event' with 'normal_play'
            df['event'] = df['event'].replace('No Event', 'normal_play')
            df.to_csv(file, index=False)
            print(f"Updated {os.path.basename(file)}")
    except Exception as e:
        print(f"Error processing {file}: {e}")
