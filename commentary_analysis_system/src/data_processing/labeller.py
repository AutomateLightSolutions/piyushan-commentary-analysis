import json

def load_highlights(file_path: str) -> list[dict]:
    """
    Expected Ground Truth Highlight JSON format:
    [{"start": 16, "end": 25}, ...]
    """
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

def get_overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0, min(a_end, b_end) - max(a_start, b_start))

from src.utils.config import get_threshold

def label_chunks(chunks: list[dict], highlights: list[dict], threshold: float = None) -> list[dict]:
    if threshold is None:
        threshold = get_threshold("labeller_threshold")
    """
    Checks if a chunk overlaps significantly (> threshold) with a known ground truth highlight
    """
    for chunk in chunks:
        chunk_len = chunk["end"] - chunk["start"]
        label = 0

        for h in highlights:
            overlap = get_overlap(
                chunk["start"], chunk["end"],
                h["start"], h["end"]
            )

            ratio = overlap / chunk_len
            if ratio >= threshold:
                label = 1
                break

        chunk["label"] = label

    return chunks
