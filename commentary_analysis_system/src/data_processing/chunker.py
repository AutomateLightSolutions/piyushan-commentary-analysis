from src.data_processing.parser import clean_text

def create_chunks(segments: list[dict], chunk_size: int = 4, overlap: int = 2) -> list[dict]:
    """
    Groups line segments into overlapping chunks based on time (seconds).
    Default: chunk_size=4s, overlap=2s, step=2s.
    Example (default): 0-4, 2-6, 4-8, 6-10
    For non-overlapping label chunks, call with overlap=0:
    Example (overlap=0): 0-4, 4-8, 8-12
    """
    chunks = []

    if not segments:
        return chunks

    min_time = int(min(s["start"] for s in segments))
    max_time = max(s["end"] for s in segments)

    step = chunk_size - overlap
    current_start = min_time

    while current_start < max_time:
        current_end = current_start + chunk_size

        texts = []
        for seg in segments:
            # Segment overlaps chunk
            if seg["end"] > current_start and seg["start"] < current_end:
                texts.append(seg["text"])

        full_text = " ".join(texts).strip()

        if full_text:
            chunks.append({
                "start": round(current_start, 2),
                "end": round(current_end, 2),
                "text_raw": full_text,
                "text_clean": clean_text(full_text)
            })

        current_start += step

    return chunks
