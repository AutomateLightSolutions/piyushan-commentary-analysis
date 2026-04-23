import { NextResponse } from "next/server";
import { exec } from "child_process";
import { readFile } from "fs/promises";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);
const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const OUTPUT_DIR = path.resolve(SYSTEM_PATH, "data", "output");

export async function POST() {
  try {
    const venvPythonPath = path.join("..", ".venv", "Scripts", "python.exe");
    const scriptPath = path.join("scripts", "04_evaluate.py");
    
    await execAsync(`$env:PYTHONPATH="."; & "${path.resolve(SYSTEM_PATH, venvPythonPath)}" "${path.resolve(SYSTEM_PATH, scriptPath)}"`, { shell: "powershell.exe", cwd: SYSTEM_PATH });

    // Read the generated JSON metrics table
    const metricsPath = path.join(OUTPUT_DIR, "final_evaluation_metrics.json");
    const fileData = await readFile(metricsPath, "utf-8");
    const metricsResult = JSON.parse(fileData);

    return NextResponse.json({ message: "Evaluated successfully!", metrics: metricsResult });
  } catch (err) {
    console.error("Evaluation Error:", err);
    return NextResponse.json({ message: "Failed to evaluate pipeline predictions" }, { status: 500 });
  }
}
