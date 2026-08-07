export const dynamic = "force-dynamic";

import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { NextResponse } from "next/server";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const OUTPUT_DIR = path.resolve(SYSTEM_PATH, "data", "output");
const BEST_MODEL_FILE = path.resolve(OUTPUT_DIR, "best_model.json");

export async function GET() {
  try {
    const fileData = await readFile(BEST_MODEL_FILE, "utf-8");
    return NextResponse.json(JSON.parse(fileData));
  } catch (err) {
    if (err.code === "ENOENT") {
      return NextResponse.json({ modelName: null });
    }
    return NextResponse.json({ error: "Failed to read best model marker", details: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { modelName, trainingRound } = await req.json();
    if (!modelName) {
      return NextResponse.json({ error: "modelName is required" }, { status: 400 });
    }

    await mkdir(OUTPUT_DIR, { recursive: true });
    const record = {
      modelName,
      trainingRound: trainingRound ?? null,
      setAt: new Date().toISOString(),
    };
    await writeFile(BEST_MODEL_FILE, JSON.stringify(record, null, 2), "utf-8");

    return NextResponse.json({ success: true, ...record });
  } catch (err) {
    return NextResponse.json({ error: "Failed to set best model", details: err.message }, { status: 500 });
  }
}
