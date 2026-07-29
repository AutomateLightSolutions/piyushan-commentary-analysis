import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getPythonCommand } from '../python-env';

const execPromise = util.promisify(exec);
const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST(request) {
  try {
    const formData = await request.formData();
    const matchId = formData.get('matchId');
    const file = formData.get('file');

    if (!matchId) {
      return NextResponse.json({ message: "Missing matchId" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ message: "Missing CSV file" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save uploaded file temporarily
    const tempDir = join(os.tmpdir(), 'rugby_highlight_imports');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = join(tempDir, `${matchId}_${Date.now()}.csv`);
    await writeFile(tempFilePath, buffer);

    // Execute Python script to process the dataset
    const scriptPath = path.join(SYSTEM_PATH, "scripts", "import_dataset.py");
    const pythonExecutable = getPythonCommand(SYSTEM_PATH);
    
    // Check if python executable exists, fallback to just 'python' if not in venv
    const pythonCmd = existsSync(pythonExecutable) ? `"${pythonExecutable}"` : "python";

    const { stdout, stderr } = await execPromise(`${pythonCmd} "${scriptPath}" --match_id "${matchId}" --csv_path "${tempFilePath}"`, {
        cwd: SYSTEM_PATH
    });

    if (stdout.includes("SUCCESS")) {
        return NextResponse.json({ message: "Labels successfully imported and mapped for both ML and Lexicon." });
    } else {
        console.error("Python script failed:", stderr || stdout);
        return NextResponse.json({ message: "Failed to map labels.", error: stderr || stdout }, { status: 500 });
    }

  } catch (error) {
    console.error("Import Labels API Error:", error);
    return NextResponse.json({ message: "Internal Server Error", error: error.message }, { status: 500 });
  }
}
