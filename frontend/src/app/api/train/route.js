import { NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);
const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST() {
  try {
    const venvPythonPath = path.join("..", ".venv", "Scripts", "python.exe");
    const scriptPath = path.join("scripts", "02_train_roberta.py");
    
    await execAsync(`$env:PYTHONPATH="."; & "${path.resolve(SYSTEM_PATH, venvPythonPath)}" "${path.resolve(SYSTEM_PATH, scriptPath)}"`, { shell: "powershell.exe", cwd: SYSTEM_PATH });

    return NextResponse.json({ message: "RoBERTa fine-tuning sequence executed successfully!" });
  } catch (err) {
    console.error("Training Error:", err);
    return NextResponse.json({ message: "Failed to train RoBERTa model" }, { status: 500 });
  }
}
