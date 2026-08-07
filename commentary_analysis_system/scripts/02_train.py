import argparse
import pandas as pd
from pathlib import Path
import os
import time
import requests
import zipfile
import shutil
import json
import sys
import io

PROCESSED_DATASETS_DIR = Path("data/processed/datasets/ml")

def get_colab_url():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r") as f:
            for line in f:
                if line.startswith("COLAB_NGROK_URL="):
                    return line.strip().split("=", 1)[1]
    return None

def download_and_extract(colab_url, headers, task_id, model_name):
    """
    Downloads the trained model zip for an already-completed Colab task and
    extracts it to data/output/{model}_finetuned/best.

    Streams in chunks and retries on connection drops, resuming from where
    it left off via HTTP Range requests instead of restarting from byte 0 -
    ngrok's free tier tunnel is prone to dropping large (~500MB+) transfers
    partway through, and this file is big enough to hit that regularly.
    The partial file is only deleted after a fully successful extraction,
    so an interrupted run can always be resumed later with --resume-task-id.
    """
    print(f"Downloading trained model for task {task_id}...")
    download_endpoint = f"{colab_url.rstrip('/')}/download/{task_id}"

    safe_name = model_name.replace("/", "_")
    output_dir = Path(f"data/output/{safe_name}_finetuned")
    received_zip_path = Path("temp_received_model.zip")

    def give_up():
        print(
            f"Giving up after {max_retries} attempts. The partial download was kept - "
            f"run this again to resume:\n"
            f'  python scripts/02_train.py --resume-task-id {task_id} --model_name "{model_name}" '
            f'--dataset "<same --dataset value you used originally>"'
        )
        sys.exit(1)

    max_retries = 6
    for attempt in range(1, max_retries + 1):
        resume_from = received_zip_path.stat().st_size if received_zip_path.exists() else 0
        req_headers = dict(headers)
        mode = "wb"
        if resume_from > 0:
            req_headers["Range"] = f"bytes={resume_from}-"
            mode = "ab"
            print(f"  Resuming download from byte {resume_from:,}...")

        try:
            with requests.get(download_endpoint, headers=req_headers, stream=True, timeout=(10, 60)) as r:
                if r.status_code not in (200, 206):
                    print(f"  Download failed with status {r.status_code} (attempt {attempt}/{max_retries}).")
                    if attempt == max_retries:
                        give_up()
                    time.sleep(min(5 * attempt, 30))
                    continue

                # Server ignored our Range request and sent the full file again -
                # start the local file over instead of appending to it.
                if resume_from > 0 and r.status_code == 200:
                    mode = "wb"

                with open(received_zip_path, mode) as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)

            print(f"  Download complete ({received_zip_path.stat().st_size / 1_000_000:.1f} MB).")
            break

        except (requests.exceptions.ConnectionError, requests.exceptions.ChunkedEncodingError, requests.exceptions.Timeout) as e:
            print(f"  Download interrupted ({e}). Attempt {attempt}/{max_retries}.")
            if attempt == max_retries:
                give_up()
            time.sleep(min(5 * attempt, 30))

    # Extract to output_dir/best (since Colab zipped the 'best' directory)
    best_dir = output_dir / "best"
    if best_dir.exists():
        shutil.rmtree(best_dir)  # Clear old model
    best_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(received_zip_path, 'r') as z:
        z.extractall(best_dir)

    print(f"Model and training history extracted successfully to {best_dir}")
    os.remove(received_zip_path)

def resolve_csv_files(dataset_arg):
    if dataset_arg != "all":
        match_ids = [d.strip() for d in dataset_arg.split(",") if d.strip()]
        csv_files = []
        for match_id in match_ids:
            csv_path = PROCESSED_DATASETS_DIR / f"dataset_{match_id}.csv"
            if not csv_path.exists():
                print(f"Dataset {match_id} not found.")
                sys.exit(1)
            csv_files.append(str(csv_path))
        return csv_files
    return [str(f) for f in PROCESSED_DATASETS_DIR.glob("*.csv")]

def record_training_round(model_name, dataset_names):
    state_file = Path("data/output/model_states.json")
    states = {}
    if state_file.exists():
        with open(state_file, 'r') as f:
            states = json.load(f)

    model_state = states.get(model_name, {})
    current_round = model_state.get("training_round", 0) + 1

    if "history" not in model_state:
        model_state["history"] = {}

    model_state["history"][str(current_round)] = dataset_names
    model_state["training_round"] = current_round

    states[model_name] = model_state

    with open(state_file, 'w') as f:
        json.dump(states, f, indent=4)

    print(f"Training workflow finished! Recorded as Training Round {current_round}.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--dataset", type=str, default="all", help="Comma-separated dataset(s) to train on, or 'all'")
    parser.add_argument(
        "--resume-task-id", type=str, default=None,
        help="Skip training and just (re)download an already-completed Colab task by its task_id. "
             "Still pass the same --model_name and --dataset used originally, so the training round "
             "gets recorded correctly. Only works if the Colab backend session that trained it is "
             "still running (its in-memory task state and the model zip live on that runtime)."
    )
    args = parser.parse_args()

    colab_url = get_colab_url()
    if not colab_url:
        print("ERROR: COLAB_NGROK_URL not found in .env file.")
        sys.exit(1)

    if not PROCESSED_DATASETS_DIR.exists():
        print("No processed datasets found. Run 01_prepare_data.py first.")
        sys.exit(1)

    csv_files = resolve_csv_files(args.dataset)
    if not csv_files:
        print("No match CSV data present.")
        sys.exit(1)

    dataset_names = [Path(f).stem for f in csv_files]
    headers = {"ngrok-skip-browser-warning": "true"}

    if args.resume_task_id:
        download_and_extract(colab_url, headers, args.resume_task_id, args.model_name)
        record_training_round(args.model_name, dataset_names)
        return

    print(f"Preparing to send {len(csv_files)} files to Colab for training {args.model_name}...")

    # Load split index if available
    split_file = Path("data/config/split_index.json")
    split_index = None
    if split_file.exists():
        with open(split_file, "r", encoding="utf-8") as f:
            split_index = json.load(f)
        print(f"Split index loaded (seed={split_index['seed']}). Only TRAIN rows will be sent to Colab.")
    else:
        print("WARNING: No split_index.json found. Run 00_split_data.py first. Sending all rows (no split applied).")

    # 1. Zip the dataset and events.json
    temp_zip_path = Path("temp_training_data.zip")
    with zipfile.ZipFile(temp_zip_path, 'w') as z:
        for f in csv_files:
            if split_index is not None:
                # Filter to train rows only
                match_id = Path(f).stem.replace("dataset_", "")
                row_assignments = split_index["assignments"].get(match_id, {})
                df = pd.read_csv(f)
                train_indices = [int(idx) for idx, role in row_assignments.items() if role == "train"]
                df_train = df.iloc[sorted(train_indices)]
                csv_bytes = df_train.to_csv(index=False).encode("utf-8")
                z.writestr(Path(f).name, csv_bytes)
                print(f"  {Path(f).name}: {len(df)} rows -> {len(df_train)} train rows included")
            else:
                z.write(f, arcname=Path(f).name)
        events_path = Path("data/events.json")
        if events_path.exists():
            z.write(events_path, arcname=events_path.name)

    # 2. Send to Colab
    api_endpoint = f"{colab_url.rstrip('/')}/train"
    print(f"Uploading data to {api_endpoint} (This will take time as the model trains in Colab)...")

    task_id = None
    try:
        with open(temp_zip_path, "rb") as f:
            files = {"file": ("training_data.zip", f, "application/zip")}
            data = {"model_name": args.model_name}
            response = requests.post(api_endpoint, files=files, data=data, headers=headers)

        if response.status_code != 200:
            print(f"Colab API Error {response.status_code}: {response.text}")
            sys.exit(1)

        task_id = response.json().get("task_id")
        if not task_id:
            print("Did not receive task_id from Colab")
            sys.exit(1)

        print(f"Task started in Colab (ID: {task_id}). Streaming logs...")
        status_endpoint = f"{colab_url.rstrip('/')}/status/{task_id}"

        error_count = 0
        while True:
            time.sleep(2)
            try:
                stat_res = requests.get(status_endpoint, headers=headers)
                if stat_res.status_code == 200:
                    error_count = 0  # reset on success
                    stat_data = stat_res.json()
                    for log_line in stat_data.get("logs", []):
                        print(log_line, flush=True)

                    status = stat_data.get("status")
                    if status == "completed":
                        break
                    elif status == "failed":
                        print("Colab Training Task Failed.")
                        sys.exit(1)
                else:
                    error_count += 1
                    if error_count > 5:
                        print(f"Colab API returned error {stat_res.status_code} multiple times. The Colab session likely crashed.")
                        sys.exit(1)
            except requests.exceptions.ConnectionError:
                error_count += 1
                print("Connection error while polling, retrying...", flush=True)
                if error_count > 5:
                    print("Lost connection to Colab permanently. The Colab session likely crashed.")
                    sys.exit(1)

        # 3. Receive trained model zip
        print("Training complete! Downloading trained model...")
        download_and_extract(colab_url, headers, task_id, args.model_name)

    except Exception as e:
        print(f"Error during training request: {e}")
        if task_id:
            print(
                f"If training itself completed in the Colab logs above, you don't need to retrain - "
                f'resume just the download with:\n'
                f'  python scripts/02_train.py --resume-task-id {task_id} --model_name "{args.model_name}" '
                f'--dataset "{args.dataset}"'
            )
        sys.exit(1)
    finally:
        if temp_zip_path.exists():
            os.remove(temp_zip_path)

    record_training_round(args.model_name, dataset_names)

if __name__ == "__main__":
    main()
