import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const JOBS_DIR = path.join(SYSTEM_PATH, "data", "predict_jobs");

export async function GET() {
  if (!fs.existsSync(JOBS_DIR)) {
    return NextResponse.json({ jobs: [] });
  }

  const jobDirs = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  const jobs = jobDirs
    .map((d) => {
      const metaPath = path.join(JOBS_DIR, d.name, "meta.json");
      if (!fs.existsSync(metaPath)) return null;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return { jobId: d.name, ...meta };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

  return NextResponse.json({ jobs });
}
