/**
 * Module-level singleton process registry.
 * Lives as long as the Next.js server process.
 * All SSE routes register their child_process here so
 * /api/stop and req.signal abort handlers can kill them.
 */

const registry = new Map(); // id → ChildProcess

export function registerProc(id, proc) {
  registry.set(id, proc);
}

export function unregisterProc(id) {
  registry.delete(id);
}

export function killAll() {
  for (const proc of registry.values()) {
    try { proc.kill("SIGTERM"); } catch {}
  }
  registry.clear();
}
