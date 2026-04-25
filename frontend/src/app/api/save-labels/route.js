import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const PROCESSED_CHUNKS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "chunks");
const PROCESSED_DATA_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "datasets");

export async function POST(req) {
  try {
    const { matchId, chunks } = await req.json();

    if (!matchId || !chunks) {
      return NextResponse.json({ message: "Missing matchId or chunks payload" }, { status: 400 });
    }

    // 1. Overwrite the JSON payload
    const chunkFile = path.join(PROCESSED_CHUNKS_DIR, `chunks_${matchId}.json`);
    await writeFile(chunkFile, JSON.stringify(chunks, null, 2), "utf-8");

    // 2. Generate the CSV file properly mapping what RoBERTa expects
    const csvFile = path.join(PROCESSED_DATA_DIR, `dataset_${matchId}.csv`);
    
    // Build CSV Content
    let csvContent = "start,end,text,label\n";
    for (const c of chunks) {
        if (c.text_clean && c.text_clean.trim() !== "") {
            // Encode CSV safely
            const safeText = c.text_clean.replace(/"/g, '""');
            csvContent += `${c.start},${c.end},"${safeText}",${c.label || 0}\n`;
        }
    }

    await writeFile(csvFile, csvContent, "utf-8");

    return NextResponse.json({ message: "Labels correctly updated and Dataset CSV regenerated!" });
  } catch (err) {
    console.error("Save Label Error:", err);
    return NextResponse.json({ message: "Internal Error persisting manual labels" }, { status: 500 });
  }
}
