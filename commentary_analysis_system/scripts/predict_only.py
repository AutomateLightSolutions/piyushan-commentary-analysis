import argparse
import json
import re
import sys
import importlib.util
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from src.data_processing.parser import parse_whisper_json
from src.data_processing.chunker import create_chunks
from src.models.hybrid_model import HybridModel
from src.pipeline.merger import merge_chunks
from src.utils.config import get_threshold

SCRIPTS_DIR = Path(__file__).parent
JOBS_DIR = Path("data/predict_jobs")


def _load_extract_module():
    """
    scripts/00_extract_transcripts.py can't be `import`ed normally (its name
    starts with a digit), so load it by file path to reuse its extract_audio()
    and transcribe_audio() (same ffmpeg + Colab/ngrok Whisper flow) unchanged.
    """
    spec = importlib.util.spec_from_file_location(
        "extract_transcripts", SCRIPTS_DIR / "00_extract_transcripts.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _update_meta(job_dir: Path, **fields):
    """Merge fields into job_dir/meta.json (created by the upload route) so the
    frontend can list past jobs and their status after a page refresh."""
    meta_path = job_dir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
    meta.update(fields)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


def run(job_id: str, model_name: str, input_path: Path):
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    _update_meta(job_dir, modelName=model_name, status="running",
                 startedAt=datetime.now(timezone.utc).isoformat())

    extract_mod = _load_extract_module()

    # 1. Normalize to mono/16k mp3 for transcription (ffmpeg -i handles video or audio input alike)
    audio_path = job_dir / "audio.mp3"
    print(f"Preparing audio from {input_path.name}...")
    extract_mod.extract_audio(input_path, audio_path)

    # 2. Transcribe via the Colab Whisper backend (writes job_dir/audio.json)
    extract_mod.transcribe_audio(audio_path, job_dir)
    whisper_json = job_dir / "audio.json"
    if not whisper_json.exists():
        raise FileNotFoundError("Transcription finished but no output JSON was produced.")

    # 3. Parse word-level segments and chunk into sequential, non-overlapping windows
    # (unlike the training pipeline's overlapping ML chunks, the Predict view shows
    # one prediction per window, so windows must not overlap: 0-4, 4-8, 8-12, ...)
    print("Chunking transcript...")
    segments = parse_whisper_json(str(whisper_json))
    chunk_size = get_threshold("chunk_size", 4)
    chunks = create_chunks(segments, chunk_size=chunk_size, overlap=0)

    if not chunks:
        print("No speech detected in the provided clip.")
        with open(job_dir / "predictions.json", "w", encoding="utf-8") as f:
            json.dump([], f)
        with open(job_dir / "highlight_clips.json", "w", encoding="utf-8") as f:
            json.dump([], f)
        _update_meta(job_dir, status="done", completedAt=datetime.now(timezone.utc).isoformat(),
                     windowCount=0, highlightClipCount=0)
        return

    # 4. Predict using the selected fine-tuned model
    safe_name = model_name.replace("/", "_")
    model_path = Path("data/output") / f"{safe_name}_finetuned" / "best"
    if not model_path.exists():
        print(f"WARNING: No fine-tuned checkpoint found for {model_name} at {model_path}. "
              f"Predictions will use an untrained model head.")

    print(f"Running hybrid prediction with {model_name}...")
    hybrid_model = HybridModel(
        roberta_model_path=str(model_path) if model_path.exists() else None,
        model_name=model_name,
    )

    texts = [c["text_clean"] for c in chunks]
    predictions = hybrid_model.predict(
        texts,
        roberta_weight=1.0,
        highlight_lexicon_weight=get_threshold("highlight_lexicon_weight", 0.3),
        event_lexicon_weight=get_threshold("event_lexicon_weight", 0.3),
    )

    for chunk, pred in zip(chunks, predictions):
        chunk.update(pred)
        # Per-label raw arrays are large and unused by the results UI
        chunk.pop("raw_roberta_probs", None)
        chunk.pop("raw_lexicon_features", None)

    with open(job_dir / "predictions.json", "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2)

    # 5. Bonus: merged highlight clip ranges (padded, contiguous non-normal_play windows)
    highlight_clips = merge_chunks(chunks)
    with open(job_dir / "highlight_clips.json", "w", encoding="utf-8") as f:
        json.dump(highlight_clips, f, indent=2)

    _update_meta(job_dir, status="done", completedAt=datetime.now(timezone.utc).isoformat(),
                 windowCount=len(chunks), highlightClipCount=len(highlight_clips))

    print(f"Prediction complete. {len(chunks)} windows, {len(highlight_clips)} highlight clips.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True, help="Unique id for this prediction job")
    parser.add_argument("--model-name", default="roberta-base", help="HuggingFace model string")
    parser.add_argument("--input", required=True, help="Path to the uploaded audio/video file")
    args = parser.parse_args()

    if not re.fullmatch(r"[a-zA-Z0-9\-]+", args.job_id):
        print(f"Invalid job id: {args.job_id}")
        sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        sys.exit(1)

    try:
        run(args.job_id, args.model_name, input_path)
    except Exception as e:
        print(f"Error during prediction: {e}")
        print(traceback.format_exc())
        _update_meta(JOBS_DIR / args.job_id, status="failed", error=str(e),
                     failedAt=datetime.now(timezone.utc).isoformat())
        sys.exit(1)


if __name__ == "__main__":
    main()
