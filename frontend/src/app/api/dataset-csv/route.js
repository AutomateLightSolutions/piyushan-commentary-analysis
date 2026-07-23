import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId");
  const type = searchParams.get("type") || "ml"; // 'ml' or 'lexicon'

  const datasetsDir = path.resolve(SYSTEM_PATH, "data", "processed", "datasets", type);

  try {
    if (!matchId) {
        // List datasets mode
        try {
            const files = await readdir(datasetsDir);
            const matchIds = files
              .filter(f => f.startsWith("dataset_") && f.endsWith(".csv"))
              .map(f => f.replace("dataset_", "").replace(".csv", ""));
            return NextResponse.json({ matchIds });
        } catch (e) {
            if (e.code === "ENOENT") return NextResponse.json({ matchIds: [] });
            throw e;
        }
    }

    // Retrieve specific dataset CSV mode
    const csvPath = path.resolve(datasetsDir, `dataset_${matchId}.csv`);
    const csvData = await readFile(csvPath, "utf-8");
    
    // Naive CSV parsing strictly for viewer logic
    const lines = csvData.trim().split(/\r?\n/);
    
    const rows = lines.slice(1).map(line => {
      // Regex to parse: start_time,end_time,"Text",event_class,highlight_score
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
