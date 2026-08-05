export const dynamic = "force-dynamic";

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { registerProc, unregisterProc } from "../process-registry.js";
import { getPythonCommand } from "../python-env.js";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const JOB_ID_RE = /^[a-zA-Z0-9-]+$/;

export async function POST(req) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const modelName = url.searchParams.get("modelName") || "roberta-base";

  if (!jobId || !JOB_ID_RE.test(jobId)) {
    return new Response("data: __ERROR__:Invalid jobId\n\n", {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const jobDir = path.join(SYSTEM_PATH, "data", "predict_jobs", jobId);
  const inputFiles = fs.existsSync(jobDir)
    ? fs.readdirSync(jobDir).filter((f) => f.startsWith("input."))
    : [];

  if (inputFiles.length === 0) {
    return new Response("data: __ERROR__:No uploaded input file found for this job\n\n", {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const inputPath = path.join(jobDir, inputFiles[0]);
  const venvPython = getPythonCommand(SYSTEM_PATH);
  const scriptPath = path.resolve(SYSTEM_PATH, "scripts", "predict_only.py");
  const PROC_ID = `predict-onego-${jobId}`;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (line) => { try { controller.enqueue(enc.encode(`data: ${line}\n\n`)); } catch {} };

      const proc = spawn(
        venvPython,
        [scriptPath, "--job-id", jobId, "--model-name", modelName, "--input", inputPath],
        {
          cwd: SYSTEM_PATH,
          env: { ...process.env, PYTHONPATH: ".", PYTHONUNBUFFERED: "1" },
        }
      );

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

      proc.on("close", (code) => {
        unregisterProc(PROC_ID);
        send(code === 0 ? "__DONE__" : `__ERROR__:Process exited with code ${code}`);
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
