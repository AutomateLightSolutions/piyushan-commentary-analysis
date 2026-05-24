import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const PROCESSED_CHUNKS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "chunks");
const RAW_DIR = path.resolve(SYSTEM_PATH, "data", "raw");

const PROCESSED_DATA_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "datasets");
import { parse } from "csv-parse/sync";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json({ message: "Missing matchId" }, { status: 400 });
    }

    // Load full match chunks (needs to be prepared initially via 01_prepare_data.py)
    const chunkFile = path.join(PROCESSED_CHUNKS_DIR, `chunks_${matchId}.json`);
    let chunks = [];
    try {
        const fileData = await readFile(chunkFile, "utf-8");
        chunks = JSON.parse(fileData);
    } catch {
        return NextResponse.json({ message: `Full match chunks not found. Run prepare_data first for ${matchId}` }, { status: 404 });
    }

    // Overlay CSV data if it exists, so manual CSV edits reflect in UI
    const csvFile = path.join(PROCESSED_DATA_DIR, `dataset_${matchId}.csv`);
    try {
        const csvData = await readFile(csvFile, "utf-8");
        const records = parse(csvData, { columns: true, skip_empty_lines: true });
        
        const recordMap = {};
        for (const r of records) {
            recordMap[`${r.start}_${r.end}`] = r;
        }

        for (const c of chunks) {
            const key = `${c.start}_${c.end}`;
            if (recordMap[key]) {
                if (recordMap[key].event) c.event = recordMap[key].event;
                if (recordMap[key].score) c.score = recordMap[key].score;
            }
        }
    } catch (csvErr) {
        // If CSV doesn't exist, we just ignore and continue with raw JSON chunks
    }

    // Attempt to load associated highlight vtt
    const highlightVttFile = path.join(RAW_DIR, `${matchId}_highlights.vtt`);
    let highlightText = "";
    try {
        highlightText = await readFile(highlightVttFile, "utf-8");
    } catch {
        highlightText = "No attached highlight .vtt transcript found in raw directory for reference.";
    }

    return NextResponse.json({ chunks, highlightText });
  } catch (err) {
    console.error("Chunks Read Error:", err);
    return NextResponse.json({ message: "Internal Error loading labeling data" }, { status: 500 });
  }
}
