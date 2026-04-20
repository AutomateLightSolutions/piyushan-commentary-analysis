import re
import json
import csv
from pathlib import Path

# =====================================================
# CONFIG (according to your project plan)
# =====================================================
TRANSCRIPT_FILE = "commentary.vtt"          # Whisper VTT output
HIGHLIGHTS_FILE = "highlights.json"        # Ground truth highlight timestamps
CHUNKS_JSON = "chunks.json"
DATASET_CSV = "dataset.csv"

CHUNK_SIZE = 5        # 5 sec windows
OVERLAP = 2           # overlap windows (5 sec + 2 overlap = strong for highlights)
LABEL_OVERLAP_RATIO = 0.40   # if chunk overlaps highlight >= 40% => label=1


# =====================================================
# TIME CONVERSION
# =====================================================
def time_to_seconds(t):
    """
    Supports:
    hh:mm:ss.ms
    mm:ss.ms
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


# =====================================================
# PARSE VTT
# =====================================================
def parse_vtt(file_path):
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


# =====================================================
# CLEAN TEXT
# =====================================================
def clean_text(text):
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


# =====================================================
# CREATE OVERLAPPING CHUNKS
# Example:
# 0-5
# 3-8
# 6-11
# =====================================================
def create_chunks(segments, chunk_size=5, overlap=2):
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
            # segment overlaps chunk
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


# =====================================================
# LOAD HIGHLIGHTS
# Example highlights.json
# [
#   {"start":16,"end":25},
#   {"start":44,"end":52}
# ]
# =====================================================
def load_highlights(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


# =====================================================
# OVERLAP CHECK
# =====================================================
def get_overlap(a_start, a_end, b_start, b_end):
    return max(0, min(a_end, b_end) - max(a_start, b_start))


# =====================================================
# LABEL CHUNKS USING GROUND TRUTH
# =====================================================
def label_chunks(chunks, highlights, threshold=0.40):
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


# =====================================================
# SAVE CHUNKS JSON
# =====================================================
def save_chunks_json(chunks, file_path):
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2)


# =====================================================
# SAVE DATASET CSV
# Final training file for RoBERTa
# =====================================================
def save_dataset_csv(chunks, file_path):
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        writer.writerow([
            "start",
            "end",
            "text",
            "label"
        ])

        for c in chunks:
            if c["text_clean"]:
                writer.writerow([
                    c["start"],
                    c["end"],
                    c["text_clean"],
                    c["label"]
                ])


# =====================================================
# SUMMARY
# =====================================================
def print_summary(chunks):
    total = len(chunks)
    positive = sum(c["label"] for c in chunks)
    negative = total - positive

    print("\n📊 DATASET SUMMARY")
    print("-" * 30)
    print("Total Chunks :", total)
    print("Highlight    :", positive)
    print("NonHighlight :", negative)


# =====================================================
# MAIN PIPELINE
# =====================================================
if __name__ == "__main__":

    print("🔹 Step 1: Parse Whisper transcript")
    segments = parse_vtt(TRANSCRIPT_FILE)
    print("✅ Segments:", len(segments))

    print("\n🔹 Step 2: Create overlapping chunks")
    chunks = create_chunks(
        segments,
        chunk_size=CHUNK_SIZE,
        overlap=OVERLAP
    )
    print("✅ Chunks:", len(chunks))

    print("\n🔹 Step 3: Load official highlights")
    highlights = load_highlights(HIGHLIGHTS_FILE)
    print("✅ Highlight clips:", len(highlights))

    print("\n🔹 Step 4: Auto label chunks")
    chunks = label_chunks(
        chunks,
        highlights,
        threshold=LABEL_OVERLAP_RATIO
    )

    print("\n🔹 Step 5: Save chunks.json")
    save_chunks_json(chunks, CHUNKS_JSON)

    print("🔹 Step 6: Save dataset.csv")
    save_dataset_csv(chunks, DATASET_CSV)

    print_summary(chunks)

    print("\n🎉 DATASET CREATION COMPLETED")
    print("Next Step = Train RoBERTa")