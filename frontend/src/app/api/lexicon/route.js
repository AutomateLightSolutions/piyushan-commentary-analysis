import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define the path to lexicon.json
const LEXICON_PATH = path.join(process.cwd(), '..', 'commentary_analysis_system', 'data', 'lexicon.json');

export async function GET() {
  try {
    if (!fs.existsSync(LEXICON_PATH)) {
      return NextResponse.json({ categories: [] });
    }
    const data = fs.readFileSync(LEXICON_PATH, 'utf8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading lexicon:', error);
    return NextResponse.json({ error: 'Failed to read lexicon configuration' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const config = await request.json();
    
    // Basic validation
    if (!config.categories || !Array.isArray(config.categories)) {
      return NextResponse.json({ error: 'Invalid configuration format' }, { status: 400 });
    }

    // Ensure directory exists
    const dir = path.dirname(LEXICON_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(LEXICON_PATH, JSON.stringify(config, null, 2), 'utf8');
    return NextResponse.json({ message: 'Lexicon configuration updated successfully' });
  } catch (error) {
    console.error('Error updating lexicon:', error);
    return NextResponse.json({ error: 'Failed to update lexicon configuration' }, { status: 500 });
  }
}
