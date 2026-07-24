import os
import sys
import subprocess
from pathlib import Path

RAW_DIR = Path("data/raw")
RAW_DIR.mkdir(parents=True, exist_ok=True)

def extract_audio(video_path: Path, output_audio: Path):
    print(f"Extracting audio from {video_path.name} (Compressing to MP3 for faster upload)...")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path), 
        "-vn", "-acodec", "libmp3lame", "-b:a", "32k", "-ac", "1", "-ar", "16000",
        str(output_audio)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

import requests
import json

def format_timestamp(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"

def get_colab_url():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r") as f:
            for line in f:
                if line.startswith("COLAB_NGROK_URL="):
                    return line.strip().split("=", 1)[1]
    return None

import time

def transcribe_audio(audio_path: Path, output_dir: Path, model="large-v3"):
    print(f"Transcribing {audio_path.name} via Google Colab API...")
    colab_url = get_colab_url()
    
    if not colab_url:
        raise ValueError("COLAB_NGROK_URL not found in .env file. Please set it to your Ngrok URL.")
        
    api_endpoint = f"{colab_url.rstrip('/')}/transcribe"
    
    headers = {"ngrok-skip-browser-warning": "true"}
    with open(audio_path, "rb") as f:
        files = {"file": (audio_path.name, f, "audio/mp3")}
        response = requests.post(api_endpoint, files=files, headers=headers)
        
    if response.status_code != 200:
        raise RuntimeError(f"Colab API Error {response.status_code}: {response.text}")
        
    task_id = response.json().get("task_id")
    if not task_id:
        raise RuntimeError("Did not receive task_id from Colab")
        
    print(f"Task started in Colab (ID: {task_id}). Streaming logs...")
    status_endpoint = f"{colab_url.rstrip('/')}/status/{task_id}"
    
    segments = []
    while True:
        time.sleep(2)
        try:
            stat_res = requests.get(status_endpoint, headers=headers)
            if stat_res.status_code == 200:
                stat_data = stat_res.json()
                for log_line in stat_data.get("logs", []):
                    print(log_line, flush=True) # Send directly to local stdout
                    
                status = stat_data.get("status")
                if status == "completed":
                    segments = stat_data.get("result_data", [])
                    break
                elif status == "failed":
                    raise RuntimeError("Colab Transcription Task Failed.")
        except requests.exceptions.ConnectionError:
            print("Connection error while polling, retrying...", flush=True)
            
    # Format to VTT
    vtt_content = "WEBVTT\n\n"
    for seg in segments:
        start_time = format_timestamp(seg.get("start", 0))
        end_time = format_timestamp(seg.get("end", 0))
        text = seg.get("text", "").strip()
        vtt_content += f"{start_time} --> {end_time}\n{text}\n\n"
        
    # Save VTT file
    vtt_file = output_dir / audio_path.with_suffix(".vtt").name
    with open(vtt_file, "w", encoding="utf-8") as f:
        f.write(vtt_content)
    
    print(f"Transcription saved to {vtt_file}", flush=True)

def main():
    if not RAW_DIR.exists():
        print(f"Raw directory not found at {RAW_DIR}")
        return

    mp4_files = list(RAW_DIR.glob("*.mp4"))
    if not mp4_files:
        print("No .mp4 files found in data/raw/")
        return

    for video_file in mp4_files:
        audio_file = video_file.with_suffix(".mp3")
        vtt_file = video_file.with_suffix(".vtt")

        if not vtt_file.exists():
            try:
                extract_audio(video_file, audio_file)
                transcribe_audio(audio_file, RAW_DIR)
                
                # Check if whisper actually wrote the VTT output or exited 0 quietly
                if not vtt_file.exists():
                    raise FileNotFoundError(f"Whisper executed but failed to save {vtt_file.name}. Review Whisper's error logs.")
                
                # Cleanup the .mp3 file since Whisper is done
                if audio_file.exists():
                    os.remove(audio_file)
            except Exception as e:
                import traceback
                print(f"Error processing {video_file.name}: {e}")
                print(traceback.format_exc())
                sys.exit(1) # Halt the entire extraction step immediately
        else:
            print(f"Transcript already exists for {video_file.name}")
            
    print("Video extraction checks completed.")

if __name__ == "__main__":
    main()
