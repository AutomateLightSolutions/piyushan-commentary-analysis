import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const DATASETS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "datasets");

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId");

  try {
    if (!matchId) {
        // List datasets mode
        const files = await readdir(DATASETS_DIR);
        const matchIds = files
          .filter(f => f.startsWith("dataset_") && f.endsWith(".csv"))
          .map(f => f.replace("dataset_", "").replace(".csv", ""));
        return NextResponse.json({ matchIds });
    }

    // Retrieve specific dataset CSV mode
    const csvPath = path.resolve(DATASETS_DIR, `dataset_${matchId}.csv`);
    const csvData = await readFile(csvPath, "utf-8");
    
    // Naive CSV parsing strictly for viewer logic (assumes headers: match_id,start,end,text,label)
    const lines = csvData.trim().split(/\r?\n/);
    const headers = lines[0].split(",");
    
    const rows = lines.slice(1).map(line => {
      // Very basic comma split holding text (assuming text doesn't contain unescaped commas that break schema natively, 
      // or we handle safely via regex if needed. For rugby transcripts we'll do simple split up to fixed columns)
      // Since 'text' might have commas natively from VTT, let's parse safely:
      // We expect: match_id,start,end,text,label
      const idIdx = line.indexOf(",");
      const match_id = line.substring(0, idIdx);
      
      const startIdx = line.indexOf(",", idIdx + 1);
      const start = line.substring(idIdx + 1, startIdx);
      
      const endIdx = line.indexOf(",", startIdx + 1);
      const end = line.substring(startIdx + 1, endIdx);
      
      const lastCommaIdx = line.lastIndexOf(",");
      const label = line.substring(lastCommaIdx + 1);
      
      const text = line.substring(endIdx + 1, lastCommaIdx);
      
      return { match_id, start, end, text, label };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    if (err.code === "ENOENT") {
        return NextResponse.json(matchId ? { rows: [] } : { matchIds: [] });
    }
    console.error("Dataset API Error:", err);
    return NextResponse.json({ message: "Failed to read datasets" }, { status: 500 });
  }
}
