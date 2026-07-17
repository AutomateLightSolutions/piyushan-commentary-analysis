export const dynamic = "force-dynamic";

import path from "path";
import { exec } from "child_process";
import { getPythonCommand } from "../python-env.js";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST(req) {
  try {
    const { modelName = "roberta-base" } = await req.json();

    const venvPython = getPythonCommand(SYSTEM_PATH);
    const scriptPath = path.resolve(SYSTEM_PATH, "scripts", "06_optimize_weights.py");

    return new Promise((resolve) => {
      exec(
        `"${venvPython}" "${scriptPath}" --model_name "${modelName}"`,
        { cwd: SYSTEM_PATH, env: { ...process.env, PYTHONPATH: "." } },
        (error, stdout, stderr) => {
          if (error) {
            console.error("Optimization script error:", stderr);
            return resolve(new Response(JSON.stringify({ error: "Optimization script failed", details: stderr }), { status: 500 }));
          }
          try {
            // The python script might output regular text before the JSON dump
            const jsonStart = stdout.indexOf('{');
            const jsonEnd = stdout.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
                const result = JSON.parse(jsonStr);
                resolve(new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } }));
            } else {
                throw new Error("No JSON object found in script output");
            }
          } catch (parseError) {
            console.error("Failed to parse script output:", stdout);
            resolve(new Response(JSON.stringify({ error: "Failed to parse script output" }), { status: 500 }));
          }
        }
      );
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
