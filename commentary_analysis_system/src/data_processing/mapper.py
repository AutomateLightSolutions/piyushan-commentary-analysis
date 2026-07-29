def get_overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0, min(a_end, b_end) - max(a_start, b_start))

def map_labels(our_chunks: list[dict], imported_data: list[dict]) -> list[dict]:
    """
    Maps event_class and highlight_score from imported_data to our_chunks based on max time overlap.
    our_chunks: list of dicts with 'start', 'end', 'text_clean', etc.
    imported_data: list of dicts with 'start', 'end', 'event', 'score'
    Returns a new list of mapped chunks.
    """
    mapped_chunks = []
    
    for chunk in our_chunks:
        c_start = chunk["start"]
        c_end = chunk["end"]
        
        max_overlap = 0
        best_event = "normal_play"
        best_score = 0.0
        
        for imp in imported_data:
            overlap = get_overlap(c_start, c_end, imp["start"], imp["end"])
            
            if overlap > max_overlap:
                max_overlap = overlap
                best_event = imp.get("event", "normal_play")
                try:
                    best_score = float(imp.get("score", 0.0))
                except (ValueError, TypeError):
                    best_score = 0.0
                    
        new_chunk = {
            "start_time": c_start,
            "end_time": c_end,
            "text": chunk.get("text_clean", chunk.get("text_raw", "")),
            "event_class": best_event,
            "highlight_score": best_score
        }
        mapped_chunks.append(new_chunk)
        
    return mapped_chunks
