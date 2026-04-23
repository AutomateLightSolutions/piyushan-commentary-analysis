import re
from src.utils.time_utils import time_to_seconds

def clean_text(text: str) -> str:
    """Cleans up raw whisper transcript text for modeling."""
    text = text.lower()
    
    # remove filler words
    fillers = ["uh", "umm", "um", "ah", "oh"]
    for w in fillers:
        text = re.sub(rf"\b{w}\b", "", text)

    # remove repeated letters
    text = re.sub(r'(.)\1{2,}', r'\1', text)

    # remove apostrophe
    text = re.sub(r"[’']", "", text)

    # remove punctuation
    text = re.sub(r"[^a-z0-9 ]", " ", text)

    # extra spaces
    text = re.sub(r"\s+", " ", text).strip()

    return text

def parse_vtt(file_path: str) -> list[dict]:
    """Parses a whisper output VTT file into list of word segments"""
    segments = []

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        if "-->" in line:
            start, end = line.split(" --> ")
            start = start.split(" ")[0]
            end = end.split(" ")[0]

            text_lines = []
            i += 1

            while i < len(lines) and lines[i].strip() != "":
                text_lines.append(lines[i].strip())
                i += 1

            text = " ".join(text_lines)

            if text:
                segments.append({
                    "start": time_to_seconds(start),
                    "end": time_to_seconds(end),
                    "text": text
                })
        else:
            i += 1

    return segments
