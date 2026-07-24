import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { getPythonCommand } from '../python-env';

const execPromise = util.promisify(exec);

const BACKEND_DIR = path.join(process.cwd(), '..', 'commentary_analysis_system');
const DATASETS_DIR = path.join(BACKEND_DIR, 'data', 'processed', 'datasets', 'lexicon');

// We use the Python executable in the virtual environment
const PYTHON_EXEC = getPythonCommand(BACKEND_DIR);
const SCRIPT_PATH = path.join(BACKEND_DIR, 'scripts', 'extract_keywords.py');

export async function GET() {
  try {
    if (!fs.existsSync(DATASETS_DIR)) {
      return NextResponse.json({ datasets: [] });
    }

    const files = fs.readdirSync(DATASETS_DIR).filter(f => f.endsWith('.csv'));
    return NextResponse.json({ datasets: files });
  } catch (error) {
    console.error('Error listing datasets:', error);
    return NextResponse.json({ error: 'Failed to list datasets' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { dataset } = await request.json();
    
    if (!dataset) {
      return NextResponse.json({ error: 'dataset filename is required' }, { status: 400 });
    }

    // Safety check: ensure the dataset actually exists
    const datasetPath = path.join(DATASETS_DIR, dataset);
    if (!fs.existsSync(datasetPath)) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }

    // Execute the Python script
    const command = `"${PYTHON_EXEC}" "${SCRIPT_PATH}" --dataset "${dataset}"`;
    
    const { stdout, stderr } = await execPromise(command, { cwd: BACKEND_DIR });
    
    // Parse the JSON output from the python script
    let result;
    try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1]; // The JSON payload should be printed last
        result = JSON.parse(lastLine);
    } catch(e) {
        console.error("Python output:", stdout);
        console.error("Python error:", stderr);
        throw new Error("Failed to parse python script output");
    }

    if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...result });

  } catch (error) {
    console.error('Error running extraction:', error);
    return NextResponse.json({ error: error.message || 'Failed to run extraction' }, { status: 500 });
  }
}
