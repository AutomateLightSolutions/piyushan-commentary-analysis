import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const JOBS_DIR = path.resolve(SYSTEM_PATH, "data", "predict_jobs");
const JOB_ID_RE = /^[a-zA-Z0-9-]+$/;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId || !JOB_ID_RE.test(jobId)) {
      return NextResponse.json({ message: "Missing or invalid jobId" }, { status: 400 });
    }

    const jobDir = path.join(JOBS_DIR, jobId);

    const predictionsRaw = await readFile(path.join(jobDir, "predictions.json"), "utf-8");
    const predictions = JSON.parse(predictionsRaw);

    let highlightClips = [];
    try {
      const clipsRaw = await readFile(path.join(jobDir, "highlight_clips.json"), "utf-8");
      highlightClips = JSON.parse(clipsRaw);
    } catch {
      // Optional file — fine if not present yet
    }

    return NextResponse.json({ predictions, highlightClips });
  } catch (err) {
    console.error("Predict results read error:", err);
    return NextResponse.json({ message: "Failed to read prediction results" }, { status: 500 });
  }
}
