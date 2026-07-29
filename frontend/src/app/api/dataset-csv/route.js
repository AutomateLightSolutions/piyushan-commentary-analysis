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
    const statusPath = path.resolve(datasetsDir, `dataset_${matchId}.checked`);
    
    let isChecked = false;
    try {
      await require("fs/promises").access(statusPath);
      isChecked = true;
    } catch(e) {}

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

    return NextResponse.json({ rows, isChecked });
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

    // Sync ML changes to Lexicon
    if (type === "ml") {
      const fs = require("fs/promises");
      const lexiconDir = path.resolve(SYSTEM_PATH, "data", "processed", "datasets", "lexicon");
      const lexiconCsvPath = path.resolve(lexiconDir, `dataset_${matchId}.csv`);
      
      try {
        const lexiconData = await fs.readFile(lexiconCsvPath, "utf-8");
        const lines = lexiconData.trim().split(/\r?\n/);
        
        let newLexiconContent = "start_time,end_time,text,event_class,highlight_score\n";
        const mlEvents = rows.filter(r => r.event && r.event !== "normal_play");
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(/^([^,]+),([^,]+),(".*?"|[^,]*),(.*),(.*)$/);
          if (match) {
            let startStr = match[1].trim();
            let endStr = match[2].trim();
            let start = parseFloat(startStr);
            let end = parseFloat(endStr);
            let text = match[3];
            
            let matchedMlEvent = null;
            for (const mlRow of mlEvents) {
              const mlStart = parseFloat(mlRow.start);
              const mlEnd = parseFloat(mlRow.end);
              // Calculate overlap
              const overlapStart = Math.max(start, mlStart);
              const overlapEnd = Math.min(end, mlEnd);
              if (overlapStart < overlapEnd) {
                matchedMlEvent = mlRow;
                break;
              }
            }
            
            let event = matchedMlEvent ? matchedMlEvent.event : "normal_play";
            let score = matchedMlEvent ? matchedMlEvent.score : "0.0054";
            
            newLexiconContent += `${startStr},${endStr},${text},${event},${score}\n`;
          } else {
            newLexiconContent += `${line}\n`;
          }
        }
        
        await fs.writeFile(lexiconCsvPath, newLexiconContent, "utf-8");
      } catch (e) {
        if (e.code !== "ENOENT") {
          console.error("Failed to sync to lexicon dataset:", e);
        }
      }
    }

    return NextResponse.json({ message: "Dataset updated successfully" });
  } catch (err) {
    console.error("Dataset Save Error:", err);
    return NextResponse.json({ message: "Failed to save dataset" }, { status: 500 });
  }
}
