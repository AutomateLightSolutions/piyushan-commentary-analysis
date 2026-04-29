import path from "path";
import { spawn } from "child_process";

const SYSTEM_PATH = path.resolve(process.cwd(), "..", "commentary_analysis_system");

export async function POST() {
  const venvPython = path.resolve(SYSTEM_PATH, "..", ".venv", "Scripts", "python.exe");
  const scriptPath = path.resolve(SYSTEM_PATH, "scripts", "01_prepare_data.py");

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (line) => controller.enqueue(enc.encode(`data: ${line}\n\n`));

      const proc = spawn(venvPython, [scriptPath], {
        cwd: SYSTEM_PATH,
        env: { ...process.env, PYTHONPATH: ".", PYTHONUNBUFFERED: "1" },
      });

      proc.stdout.on("data", (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) send(line); });
      });

      proc.stderr.on("data", (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) send(`STDERR:${line}`); });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          send("__DONE__");
        } else {
          send(`__ERROR__:Process exited with code ${code}`);
        }
        controller.close();
      });

      proc.on("error", (err) => {
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
