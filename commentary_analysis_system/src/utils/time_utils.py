def time_to_seconds(t: str) -> float:
    """
    Converts a time string in format 'hh:mm:ss.ms' or 'mm:ss.ms' into seconds.
    """
    t = t.strip().replace(",", ".")
    parts = t.split(":")

    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    
    return 0.0
