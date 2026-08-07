import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const OUTPUT_DIR = path.join(SYSTEM_PATH, "data", "output");
const BEST_MODEL_FILE = path.join(OUTPUT_DIR, "best_model.json");

const CANDIDATE_MODELS = [
  { id: "roberta-base", label: "Roberta" },
  { id: "microsoft/deberta-base", label: "DeBERTa" },
  { id: "answerdotai/ModernBERT-base", label: "ModernBERT" },
  { id: "bert-base-uncased", label: "BERT" },
];

export async function GET() {
  let bestModel = null;
  try {
    bestModel = JSON.parse(fs.readFileSync(BEST_MODEL_FILE, "utf-8")).modelName || null;
  } catch (e) {
    // No best model marked yet (see /api/best-model, set from Compare Models) - fine, just no highlight.
  }

  const available = CANDIDATE_MODELS
    .filter((m) => {
      const safeName = m.id.replace(/\//g, "_");
      const checkpointPath = path.join(OUTPUT_DIR, `${safeName}_finetuned`, "best");
      return fs.existsSync(checkpointPath);
    })
    .map((m) => ({ ...m, isBest: m.id === bestModel }));

  return NextResponse.json({ models: available, bestModel });
}
