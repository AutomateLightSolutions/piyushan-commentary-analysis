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

async function safeReaddirDatasets() {
  let files = [];
  try {
      const mlFiles = await fs.readdir(path.join(DATASETS_DIR, 'ml'));
      files = files.concat(mlFiles.map(f => path.join('ml', f)));
  } catch(e) {}
  try {
      const lexFiles = await fs.readdir(path.join(DATASETS_DIR, 'lexicon'));
      files = files.concat(lexFiles.map(f => path.join('lexicon', f)));
  } catch(e) {}
  return files;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get("matchId");

    // If matchId is NOT provided, return aggregate list
    if (!matchId) {
      const rawFiles = await safeReaddir(RAW_DIR);
      const chunkFiles = await safeReaddir(CHUNKS_DIR);
      const datasetFiles = await safeReaddirDatasets();
      
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
        const basename = path.basename(f);
        if (basename.startsWith("dataset_") && basename.endsWith(".csv")) {
          matchIds.add(basename.replace("dataset_", "").replace(".csv", ""));
        }
      });
      
      return NextResponse.json({ matchIds: Array.from(matchIds) });
    }

    // IF matchId IS provided, return specifically existing files
    const expectedFiles = [
      { path: path.join(RAW_DIR, `${matchId}_full.mp4`), name: `${matchId}_full.mp4`, type: "Raw Video", category: "raw" },
      { path: path.join(RAW_DIR, `${matchId}_full.wav`), name: `${matchId}_full.wav`, type: "Raw Audio", category: "raw" },
      { path: path.join(RAW_DIR, `${matchId}_highlights.mp4`), name: `${matchId}_highlights.mp4`, type: "Highlights Video", category: "raw" },
      { path: path.join(RAW_DIR, `${matchId}_highlights.wav`), name: `${matchId}_highlights.wav`, type: "Highlights Audio", category: "raw" },
      { path: path.join(RAW_DIR, `${matchId}.vtt`), name: `${matchId}.vtt`, type: "VTT Subtitles", category: "raw" },
      { path: path.join(RAW_DIR, `highlights_${matchId}.json`), name: `highlights_${matchId}.json`, type: "Raw Highlights", category: "raw" },
      { path: path.join(CHUNKS_DIR, `chunks_${matchId}.json`), name: `chunks_${matchId}.json`, type: "Processed Chunks", category: "chunks" },
      { path: path.join(DATASETS_DIR, "ml", `dataset_${matchId}.csv`), name: `dataset_${matchId}.csv (ML)`, type: "Dataset CSV (ML)", category: "datasets/ml" },
      { path: path.join(DATASETS_DIR, "lexicon", `dataset_${matchId}.csv`), name: `dataset_${matchId}.csv (Lexicon)`, type: "Dataset CSV (Lexicon)", category: "datasets/lexicon" },
    ];

    const existingFiles = [];
    for (const fileDef of expectedFiles) {
      try {
        const stats = await fs.stat(fileDef.path);
        existingFiles.push({
          name: fileDef.name,
          type: fileDef.type,
          category: fileDef.category,
          sizeBytes: stats.size
        });
      } catch (err) {
        // file doesn't exist, ignore
      }
    }

    return NextResponse.json({ files: existingFiles });
  } catch (err) {
    console.error("Manage Matches GET Error:", err);
    return NextResponse.json({ message: "Failed to fetch files" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const { matchId, filesToDelete } = body;

    if (!matchId || !filesToDelete) {
      return NextResponse.json({ message: "Invalid request payload" }, { status: 400 });
    }

    let filesProcess = filesToDelete;
    
    // If "all" is specified, gather all associated files automatically
    if (filesToDelete === "all") {
      const expectedFiles = [
        { path: path.join(RAW_DIR, `${matchId}_full.mp4`), name: `${matchId}_full.mp4`, category: "raw" },
        { path: path.join(RAW_DIR, `${matchId}_full.wav`), name: `${matchId}_full.wav`, category: "raw" },
        { path: path.join(RAW_DIR, `${matchId}_highlights.mp4`), name: `${matchId}_highlights.mp4`, category: "raw" },
        { path: path.join(RAW_DIR, `${matchId}_highlights.wav`), name: `${matchId}_highlights.wav`, category: "raw" },
        { path: path.join(RAW_DIR, `${matchId}.vtt`), name: `${matchId}.vtt`, category: "raw" },
        { path: path.join(RAW_DIR, `highlights_${matchId}.json`), name: `highlights_${matchId}.json`, category: "raw" },
        { path: path.join(CHUNKS_DIR, `chunks_${matchId}.json`), name: `chunks_${matchId}.json`, category: "chunks" },
        { path: path.join(DATASETS_DIR, "ml", `dataset_${matchId}.csv`), name: `dataset_${matchId}.csv`, category: "datasets/ml" },
        { path: path.join(DATASETS_DIR, "lexicon", `dataset_${matchId}.csv`), name: `dataset_${matchId}.csv`, category: "datasets/lexicon" },
      ];
      filesProcess = expectedFiles;
    } else if (!Array.isArray(filesToDelete)) {
      return NextResponse.json({ message: "Invalid request payload" }, { status: 400 });
    }

    let deletedCount = 0;
    for (const file of filesProcess) {
      // Validate string securely to prevent traversal attacks
      if (!file.name.includes(matchId) || file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
        continue;
      }

      let targetDir;
      if (file.category === "raw") targetDir = RAW_DIR;
      else if (file.category === "chunks") targetDir = CHUNKS_DIR;
      else if (file.category.startsWith("datasets")) targetDir = path.join(DATASETS_DIR, file.category.split('/')[1]);
      else continue;

      const filePath = path.join(targetDir, file.name);

      try {
        await fs.unlink(filePath);
        deletedCount++;
      } catch (err) {
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
