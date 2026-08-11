import re
import json
from src.utils.time_utils import time_to_seconds

# ── Rugby-specific correction map ─────────────────────────────────────────────
# Maps common Whisper misrecognitions → correct rugby terms.
# Keys are lowercase, matched as whole words before punctuation is stripped.
RUGBY_CORRECTIONS = {
    # Scoring
    "tries": "try",
    "trys": "try",
    "tri": "try",
    "touchdown": "try",
    "tryed": "try",

    # Set piece
    "lineouts": "lineout",
    "scrums": "scrum",
    "scrummage": "scrum",
    "malls": "maul",
    "mauling": "maul",
    "rucks": "ruck",
    "rucking": "ruck",

    # Breakdown / play
    "offloads": "offload",
    "offloaded": "offload",
    "tackled": "tackle",
    "tackles": "tackle",
    "turnovers": "turnover",
    "knockon": "knock on",
    "knock-on": "knock on",
    "forward-pass": "forward pass",
    "linebreak": "line break",
    "line-break": "line break",
    "counterattack": "counter attack",
    "counter-attack": "counter attack",
    "breakdown": "breakdown",

    # Referee
    "penalty's": "penalty",
    "penalties": "penalty",
    "penalised": "penalty",
    "penalized": "penalty",
    "tmo": "tmo",
    "t.m.o": "tmo",
    "yellow-card": "yellow card",
    "red-card": "red card",
    "sin-bin": "sin bin",
    "sinbin": "sin bin",

    # Kicking
    "conversions": "conversion",
    "converting": "conversion",
    "converted": "conversion",
    "dropgoal": "drop goal",
    "drop-goal": "drop goal",
    "grubbers": "grubber kick",
    "garryowen": "garryowen",
    "boxkick": "box kick",
    "box-kick": "box kick",

    # Excitement / commentary phrases (common mishearings)
    "sensational": "sensational",
    "unbelieveable": "unbelievable",
    "magnificant": "magnificent",
    "incredable": "incredible",
    "brillient": "brilliant",

    # Common player name fixes observed in this match
    "bundee": "Bundee Aki",
    "aki": "Bundee Aki",
    "kolisi": "Siya Kolisi",
    "kolbe": "Cheslin Kolbe",
    "sexton": "Johnny Sexton",
    "furlong": "Tadhg Furlong",
    "keenan": "Hugo Keenan",
    "pollard": "Handre Pollard",
    "etzebeth": "Eben Etzebeth",
}

def apply_rugby_corrections(text: str) -> str:
    """Replaces known Whisper misrecognitions with correct rugby terms."""
    for wrong, correct in RUGBY_CORRECTIONS.items():
        # Match whole word, case-insensitive
        text = re.sub(rf"\b{re.escape(wrong)}\b", correct, text, flags=re.IGNORECASE)
    return text

def clean_text(text: str) -> str:
    """Cleans up raw whisper transcript text for modeling."""
    # Apply rugby corrections first, before lowercasing strips context
    text = apply_rugby_corrections(text)

    text = text.lower()
    
    # remove filler words
    fillers = [
        "uh", "umm", "um", "ah", "oh",
        "erm", "err", "uhh", "ahh",
        "hmm", "hm", "mm", "mmm", "mhm",
        "huh", "eh",
    ]
    for w in fillers:
        text = re.sub(rf"\b{w}\b", "", text)

    # remove repeated letters
    text = re.sub(r'(.)\1{2,}', r'\1', text)

    # remove apostrophe
    text = re.sub(r"['\u2019]", "", text)

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

def parse_whisper_json(file_path: str) -> list[dict]:
    """Parses a Whisper JSON file (with word_timestamps=True) into a list of word segments"""
    segments = []
    
    with open(file_path, "r", encoding="utf-8") as f:
        json_data = json.load(f)
        
    for segment in json_data:
        for word_info in segment.get("words", []):
            text = word_info.get("word", "").strip()
            if text:
                segments.append({
                    "start": word_info.get("start", 0.0),
                    "end": word_info.get("end", 0.0),
                    "text": text
                })
                
    return segments
