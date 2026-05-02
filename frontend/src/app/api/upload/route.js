import { NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFile } from "fs/promises";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

// Assuming standard path since frontend is at `d:\Test FYP\frontend`
// and system is at `d:\Test FYP\commentary_analysis_system`
const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const RAW_DIR = path.resolve(SYSTEM_PATH, "data", "raw");

export async function POST(req) {
  try {
    const data = await req.formData();
    const file = data.get("file");

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    // 1. Write the Uploaded File to System's Raw Dir
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(RAW_DIR, file.name);
    await writeFile(filePath, buffer);

    // 2. Run the Preparation Python Script
    const { getPythonCommand } = await import("../python-env.js");
    const venvPython = getPythonCommand(SYSTEM_PATH);
    const scriptPath = path.join("scripts", "01_prepare_data.py");
    
    const isWindows = process.platform === "win32";
    if (isWindows) {
      await execAsync(`$env:PYTHONPATH="."; & "${venvPython}" "${path.resolve(SYSTEM_PATH, scriptPath)}"`, { shell: "powershell.exe", cwd: SYSTEM_PATH });
    } else {
      await execAsync(`PYTHONPATH="." "${venvPython}" "${path.resolve(SYSTEM_PATH, scriptPath)}"`, { cwd: SYSTEM_PATH });
    }

    return NextResponse.json({ message: `Successfully uploaded ${file.name}` });
  } catch (err) {
    console.error("Upload Error:", err);
    return NextResponse.json({ message: "Upload or Chunking Error" }, { status: 500 });
  }
}
