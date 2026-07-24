import argparse
import pandas as pd
from pathlib import Path
import os
import requests
import zipfile
import shutil
import json

PROCESSED_DATASETS_DIR = Path("data/processed/datasets/ml")

def get_colab_url():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r") as f:
            for line in f:
                if line.startswith("COLAB_NGROK_URL="):
                    return line.strip().split("=", 1)[1]
    return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--dataset", type=str, default="all", help="Specific dataset to train on, or 'all'")
    args = parser.parse_args()
    
    colab_url = get_colab_url()
    if not colab_url:
        print("ERROR: COLAB_NGROK_URL not found in .env file.")
        return
        
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
    
    print(f"Preparing to send {len(csv_files)} files to Colab for training {args.model_name}...")
    
    # 1. Zip the dataset and events.json
    temp_zip_path = Path("temp_training_data.zip")
    with zipfile.ZipFile(temp_zip_path, 'w') as z:
        for f in csv_files:
            z.write(f, arcname=Path(f).name)
        events_path = Path("data/events.json")
        if events_path.exists():
            z.write(events_path, arcname=events_path.name)
            
    # 2. Send to Colab
    api_endpoint = f"{colab_url.rstrip('/')}/train"
    print(f"Uploading data to {api_endpoint} (This will take time as the model trains in Colab)...")
    
    try:
        headers = {"ngrok-skip-browser-warning": "true"}
        with open(temp_zip_path, "rb") as f:
            files = {"file": ("training_data.zip", f, "application/zip")}
            data = {"model_name": args.model_name}
            response = requests.post(api_endpoint, files=files, data=data, headers=headers)
            
        if response.status_code != 200:
            print(f"Colab API Error {response.status_code}: {response.text}")
            return
            
        task_id = response.json().get("task_id")
        if not task_id:
            print("Did not receive task_id from Colab")
            return
            
        print(f"Task started in Colab (ID: {task_id}). Streaming logs...")
        status_endpoint = f"{colab_url.rstrip('/')}/status/{task_id}"
        
        import time
        while True:
            time.sleep(2)
            try:
                stat_res = requests.get(status_endpoint, headers=headers)
                if stat_res.status_code == 200:
                    stat_data = stat_res.json()
                    for log_line in stat_data.get("logs", []):
                        print(log_line, flush=True)
                        
                    status = stat_data.get("status")
                    if status == "completed":
                        break
                    elif status == "failed":
                        print("Colab Training Task Failed.")
                        return
            except requests.exceptions.ConnectionError:
                print("Connection error while polling, retrying...", flush=True)
                
        # 3. Receive trained model zip
        print("Training complete! Downloading trained model...")
        download_endpoint = f"{colab_url.rstrip('/')}/download/{task_id}"
        download_res = requests.get(download_endpoint, headers=headers)
        
        safe_name = args.model_name.replace("/", "_")
        output_dir = Path(f"data/output/{safe_name}_finetuned")
        
        # Save received zip
        received_zip_path = Path(f"temp_received_model.zip")
        with open(received_zip_path, "wb") as f:
            f.write(download_res.content)
            
        # Extract to output_dir/best (since Colab zipped the 'best' directory)
        best_dir = output_dir / "best"
        if best_dir.exists():
            shutil.rmtree(best_dir) # Clear old model
        best_dir.mkdir(parents=True, exist_ok=True)
            
        with zipfile.ZipFile(received_zip_path, 'r') as z:
            z.extractall(best_dir)
            
        print(f"Model and training history extracted successfully to {best_dir}")
        
    except Exception as e:
        print(f"Error during training request: {e}")
        return
    finally:
        # Cleanup temp zips
        if temp_zip_path.exists():
            os.remove(temp_zip_path)
        if Path("temp_received_model.zip").exists():
            os.remove(Path("temp_received_model.zip"))
            
    # Update model state tracking
    state_file = Path("data/output/model_states.json")
    states = {}
    if state_file.exists():
        with open(state_file, 'r') as f:
            states = json.load(f)
            
    current_round = states.get(args.model_name, {}).get("training_round", 0) + 1
    states[args.model_name] = {"training_round": current_round}
    
    with open(state_file, 'w') as f:
        json.dump(states, f, indent=4)
        
    print(f"Training workflow finished! Recorded as Training Round {current_round}.")

if __name__ == "__main__":
    main()
