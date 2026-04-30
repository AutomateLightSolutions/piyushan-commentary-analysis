import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const RAW_DIR = path.resolve(SYSTEM_PATH, "data", "raw");
const CHUNKS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "chunks");
const DATASETS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "datasets");

// Helper to safely read directory (returns empty array if not exists)
async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    return [];
  }
}

export async function GET() {
  try {
    const rawFiles = await safeReaddir(RAW_DIR);
    const chunkFiles = await safeReaddir(CHUNKS_DIR);
    const datasetFiles = await safeReaddir(DATASETS_DIR);
    
    let matchIds = new Set();

    // Extract from raw
    rawFiles.forEach(f => {
      const match = f.match(/^(.*?)_full\.(mp4|wav)$/) 
                 || f.match(/^(.*?)_highlights\.(mp4|wav)$/)
                 || f.match(/^highlights_(.*?)\.json$/);
      if (match) matchIds.add(match[1]);
      else if (f.endsWith(".vtt")) matchIds.add(f.replace(".vtt", ""));
    });

    // Extract from chunks
    chunkFiles.forEach(f => {
      if (f.startsWith("chunks_") && f.endsWith(".json")) {
        matchIds.add(f.replace("chunks_", "").replace(".json", ""));
      }
    });

    // Extract from datasets
    datasetFiles.forEach(f => {
      if (f.startsWith("dataset_") && f.endsWith(".csv")) {
        matchIds.add(f.replace("dataset_", "").replace(".csv", ""));
      }
    });

    return NextResponse.json({ matchIds: Array.from(matchIds) });
  } catch (err) {
    console.error("Manage Matches GET Error:", err);
    return NextResponse.json({ message: "Failed to fetch match IDs" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get("matchId");
    const deleteDatasets = searchParams.get("deleteDatasets") === "true";

    if (!matchId) {
      return NextResponse.json({ message: "Match ID is required" }, { status: 400 });
    }

    const filesToDelete = [
      path.join(RAW_DIR, `${matchId}_full.mp4`),
      path.join(RAW_DIR, `${matchId}_full.wav`),
      path.join(RAW_DIR, `${matchId}_highlights.mp4`),
      path.join(RAW_DIR, `${matchId}_highlights.wav`),
      path.join(RAW_DIR, `${matchId}.vtt`),
      path.join(RAW_DIR, `highlights_${matchId}.json`),
      path.join(CHUNKS_DIR, `chunks_${matchId}.json`)
    ];

    if (deleteDatasets) {
      filesToDelete.push(path.join(DATASETS_DIR, `dataset_${matchId}.csv`));
    }

    let deletedCount = 0;
    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
        deletedCount++;
      } catch (err) {
        // Ignore ENOENT (file doesn't exist)
        if (err.code !== "ENOENT") {
          console.warn(`Failed to delete ${filePath}:`, err);
        }
      }
    }

    return NextResponse.json({ message: "Deletion successful", deletedCount });
  } catch (err) {
    console.error("Manage Matches DELETE Error:", err);
    return NextResponse.json({ message: "Failed to delete files" }, { status: 500 });
  }
}
