export const dynamic = "force-dynamic";

import path from "path";
import { readFile, rm, writeFile } from "fs/promises";
import { NextResponse } from "next/server";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const DB_FILE = path.resolve(SYSTEM_PATH, "data", "output", "evaluation_metrics.json");

export async function GET(req) {
  try {
    const fileData = await readFile(DB_FILE, "utf-8");
    const metrics = JSON.parse(fileData);
    return NextResponse.json(metrics);
  } catch (err) {
    if (err.code === "ENOENT") {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: "Failed to read metrics database", details: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    let fileData = "[]";
    try {
      fileData = await readFile(DB_FILE, "utf-8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    let metrics = JSON.parse(fileData);
    const initialLength = metrics.length;
    
    // Find the record to be deleted to know what files to clean up
    const recordToDelete = metrics.find(m => m.id === id);
    
    metrics = metrics.filter(m => m.id !== id);

    if (metrics.length === initialLength) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    await writeFile(DB_FILE, JSON.stringify(metrics, null, 2), "utf-8");

    // Clean up associated files if the record exists
    if (recordToDelete) {
      const matchId = recordToDelete.match_id;
      const modelUsed = recordToDelete.model_used;
      const safeModelName = modelUsed.replace("/", "_");
      
      const outDir = path.resolve(SYSTEM_PATH, "data", "output");
      
      // 1. Delete predictions
      const predictionsFile = path.resolve(outDir, `predictions_${safeModelName}_${matchId}.json`);
      try { await rm(predictionsFile, { force: true }); } catch (e) {}
      
      // 2. Delete highlights timestamps
      const highlightsFile = path.resolve(outDir, `highlights_timestamps_${safeModelName}_${matchId}.json`);
      try { await rm(highlightsFile, { force: true }); } catch (e) {}
      
      // 3. Delete finetuned model directory
      const modelDir = path.resolve(outDir, `${safeModelName}_finetuned`);
      try { await rm(modelDir, { recursive: true, force: true }); } catch (e) {}
      
      // 4. Update model_states.json
      const statesFile = path.resolve(outDir, "model_states.json");
      try {
        const statesData = await readFile(statesFile, "utf-8");
        const states = JSON.parse(statesData);
        if (states[modelUsed]) {
          delete states[modelUsed];
          await writeFile(statesFile, JSON.stringify(states, null, 2), "utf-8");
        }
      } catch (e) {}
    }

    return NextResponse.json({ success: true, message: "Record and associated files deleted successfully" });
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete metric record", details: err.message }, { status: 500 });
  }
}
