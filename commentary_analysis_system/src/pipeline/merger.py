def merge_chunks(chunks_with_predictions: list[dict], threshold: float = 0.65, padding_before: int = 2, padding_after: int = 3) -> list[dict]:
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
                    "end": chunk["end"]
                }
            else:
                # Extend current clip
                current_clip["end"] = chunk["end"]
        else:
            if current_clip is not None:
                # Close the clip, apply padding
                current_clip["start"] = max(0, current_clip["start"] - padding_before)
                current_clip["end"] = current_clip["end"] + padding_after
                merged_clips.append(current_clip)
                current_clip = None

    # Append if still open at the end
    if current_clip is not None:
        current_clip["start"] = max(0, current_clip["start"] - padding_before)
        current_clip["end"] = current_clip["end"] + padding_after
        merged_clips.append(current_clip)

    return merged_clips
