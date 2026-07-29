import { NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST(req) {
  try {
    const { matchId, type, isChecked } = await req.json();
    if (!matchId || !type) return NextResponse.json({ message: "Missing fields" }, { status: 400 });

    const datasetsDir = path.resolve(SYSTEM_PATH, "data", "processed", "datasets", type);
    const statusPath = path.resolve(datasetsDir, `dataset_${matchId}.checked`);

    if (isChecked) {
      await writeFile(statusPath, "checked", "utf-8");
    } else {
      try {
        await unlink(statusPath);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }

    return NextResponse.json({ message: "Status updated" });
  } catch (err) {
    console.error("Status Update Error:", err);
    return NextResponse.json({ message: "Failed to update status" }, { status: 500 });
  }
}
