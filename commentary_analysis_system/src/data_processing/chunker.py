from src.data_processing.parser import clean_text

def create_chunks(segments: list[dict], chunk_size: int = 5, overlap: int = 2) -> list[dict]:
    """
    Groups line segments into overlapping chunks.
    Example: 0-5, 3-8, 6-11
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
