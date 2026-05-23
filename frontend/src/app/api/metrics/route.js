export const dynamic = "force-dynamic";

import path from "path";
import { readFile } from "fs/promises";
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
