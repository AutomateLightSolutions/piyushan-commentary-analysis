/**
 * Shared SSE-over-fetch consumer for the Python subprocess streaming routes.
 * Protocol: server sends `data: <line>\n\n`; sentinels are `__DONE__`,
 * `__ERROR__:<msg>`, and `__METRICS__:<json>` (attached to the returned extraData).
 * stdout/stderr lines are distinguished by a `STDERR:` prefix.
 */
export async function streamSSE(url, onLine, signal) {
  const res = await fetch(url, { method: "POST", signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let extraData = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop(); // keep incomplete tail

      for (const event of events) {
        const line = event.replace(/^data: /, "").trim();
        if (!line) continue;
        if (line === "__DONE__")           return { ok: true, extraData };
        if (line.startsWith("__ERROR__:")) throw new Error(line.slice(10));
        if (line.startsWith("__METRICS__:")) { extraData = JSON.parse(line.slice(12)); continue; }
        onLine(line.startsWith("STDERR:") ? line.slice(7) : line,
               line.startsWith("STDERR:") ? "stderr" : "stdout");
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, extraData };
}
