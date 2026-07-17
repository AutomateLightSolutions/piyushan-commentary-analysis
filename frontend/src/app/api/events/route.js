import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const DATA_DIR = path.resolve(SYSTEM_PATH, "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");

// Default events if file doesn't exist
const DEFAULT_EVENTS = ["Try", "Penalty", "Conversion", "Red Card", "Yellow Card"];

async function getEvents() {
  try {
    const data = await readFile(EVENTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      // Create data dir if not exists (though it should exist)
      try {
        await mkdir(DATA_DIR, { recursive: true });
      } catch (e) {}
      
      await writeFile(EVENTS_FILE, JSON.stringify(DEFAULT_EVENTS, null, 2), "utf-8");
      return DEFAULT_EVENTS;
    }
    throw err;
  }
}

export async function GET() {
  try {
    const events = await getEvents();
    return NextResponse.json({ events });
  } catch (err) {
    console.error("Failed to read events:", err);
    return NextResponse.json({ message: "Failed to load events" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { events } = await req.json();
    if (!Array.isArray(events)) {
      return NextResponse.json({ message: "Invalid payload, expecting an array of events" }, { status: 400 });
    }
    
    await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await writeFile(EVENTS_FILE, JSON.stringify(events, null, 2), "utf-8");
    
    return NextResponse.json({ message: "Events updated successfully", events });
  } catch (err) {
    console.error("Failed to save events:", err);
    return NextResponse.json({ message: "Failed to save events" }, { status: 500 });
  }
}
