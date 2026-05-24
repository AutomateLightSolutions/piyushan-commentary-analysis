export const dynamic = "force-dynamic";

import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const DB_FILE = path.resolve(SYSTEM_PATH, "data", "output", "evaluation_metrics.json");

export async function GET(req) {
  try {
    const fileData = await readFile(DB_FILE, "utf-8");
    const metrics = JSON.parse(fileData);
    return NextResponse.json(metrics);
  } catch (err) {
    if (err.code === "ENOENT") {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: "Failed to read metrics database", details: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    let fileData = "[]";
    try {
      fileData = await readFile(DB_FILE, "utf-8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    let metrics = JSON.parse(fileData);
    const initialLength = metrics.length;
    metrics = metrics.filter(m => m.id !== id);

    if (metrics.length === initialLength) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const { writeFile } = await import("fs/promises");
    await writeFile(DB_FILE, JSON.stringify(metrics, null, 2), "utf-8");

    return NextResponse.json({ success: true, message: "Record deleted successfully" });
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete metric record", details: err.message }, { status: 500 });
  }
}
