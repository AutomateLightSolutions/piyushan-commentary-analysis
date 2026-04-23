import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const OUTPUT_DIR = path.resolve(SYSTEM_PATH, "data", "output");

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json({ message: "Missing matchId" }, { status: 400 });
    }

    const timestampFile = path.join(OUTPUT_DIR, `highlights_timestamps_${matchId}.json`);
    const fileData = await readFile(timestampFile, "utf-8");
    const json = JSON.parse(fileData);

    return NextResponse.json(json);
  } catch (err) {
    console.error("Results Read Error:", err);
    return NextResponse.json({ message: "Failed to read results" }, { status: 500 });
  }
}
