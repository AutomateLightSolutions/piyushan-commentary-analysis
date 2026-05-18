import os
import sys
import subprocess
from pathlib import Path

RAW_DIR = Path("data/raw")
RAW_DIR.mkdir(parents=True, exist_ok=True)

def extract_audio(video_path: Path, output_audio: Path):
    print(f"Extracting audio from {video_path.name}...")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path), 
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", 
        str(output_audio)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def transcribe_audio(audio_path: Path, output_dir: Path, model="small"):
    print(f"Transcribing {audio_path.name} with Whisper...")
    cmd = [
        "whisper", str(audio_path),
        "--model", model,
        "--output_dir", str(output_dir),
        "--output_format", "vtt",
        "--language", "en",
        "--initial_prompt", "Rugby commentary, match highlights, scoring a try, scrum, tackle, conversion."
    ]
    # Enforce UTF-8 to prevent cp1252 charmap crashes on Windows when Whisper prints exotic characters
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    subprocess.run(cmd, env=env, check=True)

def main():
    if not RAW_DIR.exists():
        print(f"Raw directory not found at {RAW_DIR}")
        return

    mp4_files = list(RAW_DIR.glob("*.mp4"))
    if not mp4_files:
        print("No .mp4 files found in data/raw/")
        return

    for video_file in mp4_files:
        audio_file = video_file.with_suffix(".wav")
        vtt_file = video_file.with_suffix(".vtt")

        if not vtt_file.exists():
            try:
                extract_audio(video_file, audio_file)
                transcribe_audio(audio_file, RAW_DIR)
                
                # Check if whisper actually wrote the VTT output or exited 0 quietly
                if not vtt_file.exists():
                    raise FileNotFoundError(f"Whisper executed but failed to save {vtt_file.name}. Review Whisper's error logs.")
                
                # Cleanup the .wav file since Whisper is done
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
