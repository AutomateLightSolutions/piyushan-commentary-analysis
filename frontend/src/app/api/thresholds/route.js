import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

// Resolve the path to the backend config file
// This assumes the frontend and commentary_analysis_system are siblings
const configPath = path.resolve(process.cwd(), '../commentary_analysis_system/data/config/settings.json');

const defaultSettings = {
    lexicon_threshold: 0.10,
    ml_threshold: 0.55,
    hybrid_threshold: 0.40,
    merger_threshold: 0.40,
    labeller_threshold: 0.40,
    highlight_lexicon_weight: 0.30,
    event_lexicon_weight: 0.30
};

export async function GET() {
    try {
        const fileExists = await fs.access(configPath).then(() => true).catch(() => false);
        if (fileExists) {
            const fileContents = await fs.readFile(configPath, 'utf8');
            const settings = JSON.parse(fileContents);
            return NextResponse.json(settings);
        }
        // Return defaults if file doesn't exist
        return NextResponse.json(defaultSettings);
    } catch (error) {
        console.error("Error reading thresholds config:", error);
        return NextResponse.json({ error: "Failed to read configuration." }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const newSettings = await request.json();
        
        // Ensure directory exists
        const dir = path.dirname(configPath);
        await fs.mkdir(dir, { recursive: true });

        // Save new settings
        await fs.writeFile(configPath, JSON.stringify(newSettings, null, 4), 'utf8');
        
        return NextResponse.json({ success: true, settings: newSettings });
    } catch (error) {
        console.error("Error writing thresholds config:", error);
        return NextResponse.json({ error: "Failed to save configuration." }, { status: 500 });
    }
}
