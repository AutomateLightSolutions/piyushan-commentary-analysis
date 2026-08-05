import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const JOBS_DIR = path.join(SYSTEM_PATH, "data", "predict_jobs");

const JOB_ID_RE = /^[a-zA-Z0-9-]+$/;

export async function POST(req) {
  try {
    const data = await req.formData();
    const file = data.get("file");
    const jobId = data.get("jobId");

    if (!file || !jobId) {
      return NextResponse.json({ message: "Missing required file or jobId" }, { status: 400 });
    }
    if (!JOB_ID_RE.test(jobId)) {
      return NextResponse.json({ message: "Invalid jobId" }, { status: 400 });
    }

    const jobDir = path.join(JOBS_DIR, jobId);
    await mkdir(jobDir, { recursive: true });

    const ext = path.extname(file.name || "") || ".bin";
    const buffer = Buffer.from(await file.arrayBuffer());
    const inputPath = path.join(jobDir, `input${ext}`);
    await writeFile(inputPath, buffer);

    const meta = {
      jobId,
      originalName: file.name || "unknown",
      uploadedAt: new Date().toISOString(),
      status: "uploaded",
    };
    await writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta, null, 2));

    return NextResponse.json({ message: "Upload successful", inputPath: `input${ext}` });
  } catch (err) {
    console.error("Predict upload error:", err);
    return NextResponse.json({ message: "Upload Error (file might be too large)" }, { status: 500 });
  }
}
