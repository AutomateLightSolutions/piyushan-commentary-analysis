export const dynamic = "force-dynamic";

import path from "path";
import { spawn } from "child_process";
import { registerProc, unregisterProc } from "../process-registry.js";
import { getPythonCommand } from "../python-env.js";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");
const PROC_ID = "chunk";

export async function POST(req) {
  const venvPython = getPythonCommand(SYSTEM_PATH);
  const scriptPath = path.resolve(SYSTEM_PATH, "scripts", "01_prepare_data.py");

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (line) => { try { controller.enqueue(enc.encode(`data: ${line}\n\n`)); } catch {} };

      const proc = spawn(venvPython, [scriptPath], {
        cwd: SYSTEM_PATH,
        env: { ...process.env, PYTHONPATH: ".", PYTHONUNBUFFERED: "1" },
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
