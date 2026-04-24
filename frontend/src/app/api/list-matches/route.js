import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const CHUNKS_DIR = path.resolve(SYSTEM_PATH, "data", "processed", "chunks");

export async function GET() {
  try {
    const files = await readdir(CHUNKS_DIR);
    // files look like chunks_match 1.json
    const matchIds = files
      .filter(f => f.startsWith("chunks_") && f.endsWith(".json"))
      .map(f => f.replace("chunks_", "").replace(".json", ""));
      
    return NextResponse.json({ matchIds });
  } catch (err) {
    if (err.code === "ENOENT") {
        return NextResponse.json({ matchIds: [] });
    }
    console.error("List Matches Error:", err);
    return NextResponse.json({ message: "Failed to list match IDs" }, { status: 500 });
  }
}
