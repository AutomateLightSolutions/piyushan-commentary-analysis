import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const RAW_DIR = path.resolve(SYSTEM_PATH, "data", "raw");

export async function POST(req) {
  try {
    const data = await req.formData();
    const fullVideo = data.get("fullVideo");
    const highlightVideo = data.get("highlightVideo");
    const matchId = data.get("matchId");

    if (!fullVideo || !highlightVideo || !matchId) {
      return NextResponse.json({ message: "Missing required MP4 files or match ID" }, { status: 400 });
    }

    // Write Full Video
    const fullBuffer = Buffer.from(await fullVideo.arrayBuffer());
    await writeFile(path.join(RAW_DIR, `${matchId}_full.mp4`), fullBuffer);

    // Write Highlight Video
    const hlBuffer = Buffer.from(await highlightVideo.arrayBuffer());
    await writeFile(path.join(RAW_DIR, `${matchId}_highlights.mp4`), hlBuffer);

    return NextResponse.json({ message: "Videos successfully uploaded to data/raw!" });
  } catch (err) {
    console.error("Upload MP4 Error:", err);
    return NextResponse.json({ message: "Upload Error (File might be too large)" }, { status: 500 });
  }
}
