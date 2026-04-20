import re
import json

# -----------------------------
# Convert time (hh:mm:ss.ms) → seconds
# -----------------------------
def time_to_seconds(t):
    parts = t.split(":")
    
    if len(parts) == 3:
        h, m, s = parts
        return int(h)*3600 + int(m)*60 + float(s)
    else:
        m, s = parts
        return int(m)*60 + float(s)


# -----------------------------
# Parse VTT file
# -----------------------------
def parse_vtt(file_path):
    segments = []
    
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        if "-->" in line:
            start, end = line.split(" --> ")
            
            text_lines = []
            i += 1
            
            # collect multi-line subtitle text
            while i < len(lines) and lines[i].strip() != "":
                text_lines.append(lines[i].strip())
                i += 1
            
            text = " ".join(text_lines)
            
            segments.append({
                "start": time_to_seconds(start),
                "end": time_to_seconds(end),
                "text": text
            })
        else:
            i += 1
    
    return segments


# -----------------------------
# Create chunks (fixed window)
# -----------------------------
def create_chunks(segments, chunk_size=5, overlap=0):
    chunks = []
    
    min_time = int(min(seg["start"] for seg in segments))
    max_time = max(seg["end"] for seg in segments)
    
    current_start = min_time
    
    while current_start < max_time:
        current_end = current_start + chunk_size
        chunk_text = []
        
        for seg in segments:
            # check overlap with chunk window
            if seg["start"] < current_end and seg["end"] > current_start:
                chunk_text.append(seg["text"])
        
        if chunk_text:
            chunks.append({
                "start": current_start,
                "end": current_end,
                "text": " ".join(chunk_text)
            })
        
        # move window (with optional overlap)
        current_start += (chunk_size - overlap) if overlap < chunk_size else chunk_size
    
    return chunks


# -----------------------------
# Advanced text cleaning
# -----------------------------
def clean_text(text):
    # 1. Lowercase
    text = text.lower()
    
    # 2. Remove filler words
    filler_words = ["uh", "uhh", "umm", "um", "ah", "oh"]
    for word in filler_words:
        text = re.sub(rf"\b{word}\b", "", text)
    
    # 3. Fix repeated letters (goooal → goal)
    text = re.sub(r'(.)\1{2,}', r'\1', text)
    
    # 4. Remove apostrophes (he's → hes)
    text = re.sub(r"[’']", "", text)
    
    # 5. Remove non-alphanumeric characters
    text = re.sub(r'[^a-z0-9 ]', ' ', text)
    
    # 6. Remove extra spaces
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

# -----------------------------
# Build Rugby Dataset
# -----------------------------

def bulid_dataset():
    with open("chunks.json", "r") as f:
    chunks = json.load(f)

    lines = []

    for c in chunks:
        text = c["text_clean"]
        if len(text.split()) > 2:  # avoid junk
            lines.append(text)

    # remove duplicates
    lines = list(set(lines))

    with open("rugby_corpus.txt", "w") as f:
        for line in lines:
            f.write(line + "\n")
    



# -----------------------------
# MAIN
# -----------------------------
if __name__ == "__main__":
    input_file = "commentary.vtt"
    output_file = "chunks.json"
    
    print("🔹 Parsing VTT file...")
    segments = parse_vtt(input_file)
    print(f"✅ Total segments: {len(segments)}")
    
    print("🔹 Creating chunks...")
    chunks = create_chunks(segments, chunk_size=5, overlap=0)
    print(f"✅ Total chunks: {len(chunks)}")
    
    print("🔹 Cleaning text...")
    for c in chunks:
        c["text_raw"] = c["text"]
        c["text_clean"] = clean_text(c["text"])
        del c["text"]  # remove original field
    
    print("🔹 Saving output...")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2)    
    
    print("🎉 Done! Check chunks.json")

    bulid_dataset()
    print("Dataset ready!")