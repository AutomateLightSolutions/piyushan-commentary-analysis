import { NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);
const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST() {
  try {
    const venvPythonPath = path.join("..", ".venv", "Scripts", "python.exe");
    const scriptPath = path.join("scripts", "01_prepare_data.py");
    
    await execAsync(`$env:PYTHONPATH="."; & "${path.resolve(SYSTEM_PATH, venvPythonPath)}" "${path.resolve(SYSTEM_PATH, scriptPath)}"`, { shell: "powershell.exe", cwd: SYSTEM_PATH });

    return NextResponse.json({ message: `Successfully chunked transcript ready for labeling!` });
  } catch (err) {
    console.error("Prepare Data Error:", err);
    return NextResponse.json({ message: "Chunking Error" }, { status: 500 });
  }
}
