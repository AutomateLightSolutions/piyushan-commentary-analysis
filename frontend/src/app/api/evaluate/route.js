export const dynamic = "force-dynamic";

import path from "path";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { registerProc, unregisterProc } from "../process-registry.js";
import { getPythonCommand } from "../python-env.js";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const OUTPUT_DIR = path.resolve(SYSTEM_PATH, "data", "output");
const PROC_ID = "evaluate";

export async function POST(req) {
  const url = new URL(req.url);
  const modelName = url.searchParams.get("modelName") || "roberta-base";
  const dataset = url.searchParams.get("dataset") || "all";
  const split = url.searchParams.get("split") || "all";

  const venvPython = getPythonCommand(SYSTEM_PATH);
  const scriptPath = path.resolve(SYSTEM_PATH, "scripts", "04_evaluate.py");

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (line) => { try { controller.enqueue(enc.encode(`data: ${line}\n\n`)); } catch {} };

      const proc = spawn(venvPython, [scriptPath, "--model_name", modelName, "--dataset", dataset, "--split", split], {
        cwd: SYSTEM_PATH,
        env: { ...process.env, PYTHONPATH: ".", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      });

      registerProc(PROC_ID, proc);

      req.signal.addEventListener("abort", () => {
        proc.kill("SIGTERM");
        unregisterProc(PROC_ID);
      });

      proc.stdout.on("data", (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) send(line); });
      });

      proc.stderr.on("data", (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) send(`STDERR:${line}`); });
      });

      proc.on("close", async (code) => {
        unregisterProc(PROC_ID);
        if (code === 0) {
          send("__DONE__");
        } else {
          send(`__ERROR__:Process exited with code ${code}`);
        }
        controller.close();
      });

      proc.on("error", (err) => {
        unregisterProc(PROC_ID);
        send(`__ERROR__:${err.message}`);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
