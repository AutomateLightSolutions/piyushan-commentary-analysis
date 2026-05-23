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
    
    // Naive CSV parsing strictly for viewer logic (assumes headers: start,end,text,event,score)
    const lines = csvData.trim().split(/\r?\n/);
    
    const rows = lines.slice(1).map(line => {
      // Regex to parse: start,end,"text",event,score
      // We assume text is quoted.
      // E.g. 0,5,"a referee is ben okeefe from new zealand",Try,0.8
      // or 0,5,a referee is ben okeefe from new zealand,Try,0.8
      // Let's use a robust regex to handle quoted text that might have commas.
      const match = line.match(/^([^,]+),([^,]+),(".*?"|[^,]*),(.*),(.*)$/);
      if (match) {
        return {
          start: match[1].trim(),
          end: match[2].trim(),
          text: match[3].replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
          event: match[4].trim(),
          score: match[5].trim()
        };
      } else {
        // Fallback for broken lines
        return { start: "", end: "", text: line, event: "", score: "" };
      }
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
