import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const RAW_DIR = path.resolve(SYSTEM_PATH, "data", "raw");

export async function POST(req) {
  try {
    const data = await req.formData();
    const fullVideo = data.get("fullVideo");
    const matchId = data.get("matchId");

    if (!fullVideo || !matchId) {
      return NextResponse.json({ message: "Missing required MP4 files or match ID" }, { status: 400 });
    }

    // Ensure the raw directory exists before writing files
    await mkdir(RAW_DIR, { recursive: true });

    // Write Full Video
    const fullBuffer = Buffer.from(await fullVideo.arrayBuffer());
    await writeFile(path.join(RAW_DIR, `${matchId}_full.mp4`), fullBuffer);



    return NextResponse.json({ message: "Videos successfully uploaded to data/raw!" });
  } catch (err) {
    console.error("Upload MP4 Error:", err);
    return NextResponse.json({ message: "Upload Error (File might be too large)" }, { status: 500 });
  }
}
