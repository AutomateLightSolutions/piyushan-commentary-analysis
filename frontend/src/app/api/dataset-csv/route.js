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

export async function POST(req) {
  try {
    const { matchId, type, rows } = await req.json();
    if (!matchId || !type || !rows) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    const datasetsDir = path.resolve(SYSTEM_PATH, "data", "processed", "datasets", type);
    const csvPath = path.resolve(datasetsDir, `dataset_${matchId}.csv`);

    // Create CSV header
    let csvContent = "start_time,end_time,text,event_class,highlight_score\n";
    
    // Append rows
    for (const row of rows) {
      // Escape text, wrapping in quotes if it contains quotes or commas
      let text = row.text || "";
      if (text.includes(",") || text.includes('"')) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      
      csvContent += `${row.start},${row.end},${text},${row.event},${row.score}\n`;
    }

    await require("fs/promises").writeFile(csvPath, csvContent, "utf-8");

    return NextResponse.json({ message: "Dataset updated successfully" });
  } catch (err) {
    console.error("Dataset Save Error:", err);
    return NextResponse.json({ message: "Failed to save dataset" }, { status: 500 });
  }
}
