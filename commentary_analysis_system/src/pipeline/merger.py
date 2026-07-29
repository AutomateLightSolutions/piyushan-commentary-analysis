from src.utils.config import get_threshold

def merge_chunks(chunks_with_predictions: list[dict], threshold: float = None, padding_before: int = 4, padding_after: int = 2) -> list[dict]:
    if threshold is None:
        threshold = get_threshold("merger_threshold")
    """
    Takes chunks with 'hybrid_score', applies threshold, merges contiguous positives.
    """
    merged_clips = []
    current_clip = None

    for chunk in chunks_with_predictions:
        is_highlight = chunk.get("hybrid_score", 0.0) >= threshold
        
        if is_highlight:
            if current_clip is None:
                # Start new clip
                current_clip = {
                    "start": chunk["start"],
                    "end": chunk["end"],
                    "primary_event": chunk.get("predicted_event", "normal_play"),
                    "max_score": chunk.get("hybrid_score", 0.0)
                }
            else:
                # Extend current clip
                current_clip["end"] = chunk["end"]
                # Update primary event if this chunk has a higher score
                score = chunk.get("hybrid_score", 0.0)
                if score > current_clip.get("max_score", 0.0):
                    current_clip["max_score"] = score
                    if "predicted_event" in chunk:
                        current_clip["primary_event"] = chunk["predicted_event"]
        else:
            if current_clip is not None:
                # Close the clip, apply padding
                current_clip["start"] = max(0, current_clip["start"] - padding_before)
                current_clip["end"] = current_clip["end"] + padding_after
                if "max_score" in current_clip:
                    del current_clip["max_score"] # Clean up internal tracking
                merged_clips.append(current_clip)
                current_clip = None

    # Append if still open at the end
    if current_clip is not None:
        current_clip["start"] = max(0, current_clip["start"] - padding_before)
        current_clip["end"] = current_clip["end"] + padding_after
        if "max_score" in current_clip:
            del current_clip["max_score"]
        merged_clips.append(current_clip)

    return merged_clips
