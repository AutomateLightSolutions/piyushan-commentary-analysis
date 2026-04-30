"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import "./globals.css";

const INITIAL_STEPS = [
  { id: "upload",  name: "1. Upload Videos to Backend",                  status: "idle", log: "", lines: [] },
  { id: "extract", name: "2. Audio Extraction & Whisper Transcription",   status: "idle", log: "", lines: [] },
  { id: "chunk",   name: "3. Chunking Timestamped Text",                  status: "idle", log: "", lines: [] },
  { id: "label",   name: "4. Proceed to Manual Labeling module",          status: "idle", log: "", lines: [] },
];

const INITIAL_ML_STEPS = [
  { id: "train",    name: "6. Train RoBERTa Highlight Classifier",              status: "idle", log: "", lines: [] },
  { id: "predict",  name: "7-11. Build Lexicon, Hybrid Score & Merge Predict",  status: "idle", log: "", lines: [] },
  { id: "evaluate", name: "12. Generate Evaluation Metrics",                    status: "idle", log: "", lines: [] },
];

export default function Home() {
  const [matchId, setMatchId] = useState("");
  const [fullVideo, setFullVideo] = useState(null);
  const [highlightVideo, setHighlightVideo] = useState(null);

  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [mlSteps, setMlSteps] = useState(INITIAL_ML_STEPS);

  const [metricsData, setMetricsData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMlProcessing, setIsMlProcessing] = useState(false);

  const logRefs = useRef({});

  // ── State helpers ──────────────────────────────────────────────────────────
  const resetSteps    = () => setSteps(INITIAL_STEPS.map(s => ({ ...s, lines: [] })));
  const resetMlSteps  = () => setMlSteps(INITIAL_ML_STEPS.map(s => ({ ...s, lines: [] })));

  const mutateStep = useCallback((setter, id, patch) => {
    setter(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const appendLine = useCallback((setter, id, text, type) => {
    setter(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, lines: [...s.lines, { text, type }] };
    }));
    // auto-scroll
    requestAnimationFrame(() => {
      const el = logRefs.current[id];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // ── SSE stream consumer ────────────────────────────────────────────────────
  const streamSSE = async (url, onLine) => {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let extraData = null;

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
    return { ok: true, extraData };
  };

  // ── Run one SSE step ───────────────────────────────────────────────────────
  const runStreamStep = async (url, id, setter) => {
    mutateStep(setter, id, { status: "active", log: "", lines: [] });
    const result = await streamSSE(url, (text, type) => appendLine(setter, id, text, type));
    mutateStep(setter, id, { status: "done" });
    return result;
  };

  // ── Pipeline handlers ──────────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!matchId)        return alert("Please enter a Match Identifier Base Name!");
    if (!fullVideo)      return alert("Please select the Full Match MP4!");
    if (!highlightVideo) return alert("Please select the Highlight MP4!");

    setIsProcessing(true);
    resetSteps();

    // STEP 1: Upload via XHR
    mutateStep(setSteps, "upload", { status: "active", log: "Uploading .mp4 files → 0%", lines: [] });
    try {
      await new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append("fullVideo", fullVideo);
        fd.append("highlightVideo", highlightVideo);
        fd.append("matchId", matchId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload-video", true);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            mutateStep(setSteps, "upload", {
              log: `Uploading .mp4 files → ${pct}%\n(${(e.loaded/1048576).toFixed(1)} MB / ${(e.total/1048576).toFixed(1)} MB)`
            });
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? (mutateStep(setSteps, "upload", { status: "done", log: "Upload successful!" }), resolve())
          : reject(new Error("Upload failed. Files may be too large."));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(fd);
      });
    } catch (err) {
      mutateStep(setSteps, "upload", { status: "error", log: err.message });
      setIsProcessing(false); return;
    }

    // STEP 2: Extract (SSE)
    try { await runStreamStep("/api/extract-videos", "extract", setSteps); }
    catch (err) { mutateStep(setSteps, "extract", { status: "error", log: err.message }); setIsProcessing(false); return; }

    // STEP 3: Chunk (SSE)
    try { await runStreamStep("/api/prepare", "chunk", setSteps); }
    catch (err) { mutateStep(setSteps, "chunk", { status: "error", log: err.message }); setIsProcessing(false); return; }

    mutateStep(setSteps, "label", { status: "done", log: "Pipeline completely successful! You may now navigate to the Data Annotation Center." });
    setIsProcessing(false);
  };

  const handleMlProcess = async () => {
    setIsMlProcessing(true);
    setMetricsData(null);
    resetMlSteps();

    // Train
    try { await runStreamStep("/api/train", "train", setMlSteps); }
    catch (err) { mutateStep(setMlSteps, "train", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    // Pipeline
    try { await runStreamStep("/api/pipeline", "predict", setMlSteps); }
    catch (err) { mutateStep(setMlSteps, "predict", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    // Evaluate
    try {
      const result = await runStreamStep("/api/evaluate", "evaluate", setMlSteps);
      if (result?.extraData) setMetricsData(result.extraData);
    } catch (err) { mutateStep(setMlSteps, "evaluate", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    setIsMlProcessing(false);
  };

  // ── Step renderer ──────────────────────────────────────────────────────────
  const renderStep = (step, activeColor) => {
    const setRef = (el) => { if (el) logRefs.current[step.id] = el; };
    const hasLiveLines = step.lines && step.lines.length > 0;
    const showBox = hasLiveLines || step.log || step.status === "active";

    return (
      <div key={step.id} style={{
        opacity: step.status === "idle" ? 0.4 : 1,
        transition: "opacity 0.3s ease",
        borderLeft: `4px solid ${
          step.status === "done"   ? "#10b981" :
          step.status === "active" ? activeColor :
          step.status === "error"  ? "#ef4444" : "var(--glass-border)"
        }`,
        paddingLeft: "1rem",
      }}>
        {/* Step header */}
        <div style={{ fontWeight: "bold", fontSize: "1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{step.name}</span>
          <span style={{ fontSize: "1rem" }}>
            {step.status === "done"   && "✅"}
            {step.status === "active" && <span style={{ display: "inline-block", animation: "pulse 1.2s ease-in-out infinite" }}>⏳</span>}
            {step.status === "error"  && "❌"}
          </span>
        </div>

        {/* Terminal log box */}
        {showBox && (
          <div ref={setRef} style={{
            marginTop: "0.5rem",
            background: "rgba(0,0,0,0.4)",
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
            fontSize: "0.8rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "220px",
            overflowY: "auto",
            lineHeight: "1.7",
            border: "1px solid rgba(255,255,255,0.07)",
            scrollbarWidth: "thin",
          }}>
            {/* Static log (upload progress etc.) */}
            {!hasLiveLines && step.log && (
              <span style={{ color: step.status === "error" ? "#fca5a5" : "#a7f3d0" }}>{step.log}</span>
            )}

            {/* Live streamed lines */}
            {hasLiveLines && step.lines.map((l, i) => (
              <div key={i} style={{
                color: l.type === "stderr" ? "#fbbf24" :
                       step.status === "error" ? "#fca5a5" : "#a7f3d0",
              }}>{l.text}</div>
            ))}

            {/* Blinking cursor while active */}
            {step.status === "active" && (
              <span style={{ animation: "blink 1s step-end infinite", color: "#a7f3d0" }}>▋</span>
            )}
          </div>
        )}

        {/* Link after label step completes */}
        {step.id === "label" && step.status === "done" && (
          <Link href="/label" style={{
            display: "inline-block", marginTop: "1rem",
            background: "var(--primary-color)", color: "white",
            padding: "0.6rem 1rem", borderRadius: "6px",
            textDecoration: "none", fontWeight: "bold",
          }}>
            Go to Manual Labeling →
          </Link>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container" style={{ maxWidth: "1400px" }}>
      <style>{`
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar       { width: 5px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,0.15); border-radius: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
      `}</style>

      <header className="flex-between">
        <div>
          <h1>Rugby Highlight Analyzer</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>Automated Video Transcription &amp; Chunking Pipeline</p>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <Link href="/lexicon" style={{ color: "white", textDecoration: "none", fontWeight: "bold", background: "rgba(255,255,255,0.1)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)" }}>
            Manage Lexicon
          </Link>
          <Link href="/manage-matches" style={{ color: "white", textDecoration: "none", fontWeight: "bold", background: "rgba(255,255,255,0.1)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)" }}>
            Manage Matches
          </Link>
          <Link href="/datasets" style={{ color: "white", textDecoration: "none", fontWeight: "bold", background: "rgba(255,255,255,0.1)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)" }}>
            View Final Datasets CSV
          </Link>
          <Link href="/label" style={{ color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold" }}>
            Go to Manual Labeling Center →
          </Link>
        </div>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", alignItems: "start" }}>

        {/* ── Left Column ── */}
        <div>
          <section className="glass-card" style={{ marginBottom: "2rem" }}>
            <h2 className="card-title">🎥 1. Provide Context &amp; Videos</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Match Identifier Base Name</label>
                <input type="text" placeholder="e.g. match_01" value={matchId}
                  onChange={e => setMatchId(e.target.value)}
                  style={{ width: "100%", padding: "0.8rem", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Upload Full Match Video (.mp4)</label>
                <input type="file" accept="video/mp4" onChange={e => setFullVideo(e.target.files[0])}
                  style={{ width: "100%", padding: "0.8rem", borderRadius: "8px", border: "1px dashed var(--primary-color)", color: "white" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Upload Highlight Video (.mp4)</label>
                <input type="file" accept="video/mp4" onChange={e => setHighlightVideo(e.target.files[0])}
                  style={{ width: "100%", padding: "0.8rem", borderRadius: "8px", border: "1px dashed var(--secondary-color)", color: "white" }} />
              </div>
              <button className="btn" onClick={handleProcess}
                disabled={isProcessing || isMlProcessing} style={{ marginTop: "1rem" }}>
                {isProcessing ? "Pipeline Running..." : "Start System Pipeline (Step 1-4)"}
              </button>
            </div>
          </section>

          <section className="glass-card">
            <h2 className="card-title">⚙️ 2. Data Pipeline Progress</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {steps.map(s => renderStep(s, "var(--primary-color)"))}
            </div>
          </section>
        </div>

        {/* ── Right Column ── */}
        <div>
          <section className="glass-card" style={{ marginBottom: "2rem" }}>
            <div className="flex-between">
              <h2 className="card-title" style={{ margin: 0 }}>🧠 3. Advanced ML Execution</h2>
              <button className="btn" onClick={handleMlProcess}
                disabled={isProcessing || isMlProcessing}
                style={{ marginTop: 0, padding: "0.6rem 1.2rem", width: "auto" }}>
                {isMlProcessing ? "Executing Sequence..." : "Run ML Sequence (Step 6-12)"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1.5rem" }}>
              {mlSteps.map(s => renderStep(s, "var(--secondary-color)"))}
            </div>
          </section>

          {metricsData && (
            <section className="glass-card" style={{ animation: "fadeIn 0.5s ease" }}>
              <h2 className="card-title">📊 Final Evaluation Metrics</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--glass-border)", color: "white" }}>
                    <th style={{ padding: "1rem" }}>Model Approach</th>
                    <th style={{ padding: "1rem", color: "var(--primary-color)" }}>Precision</th>
                    <th style={{ padding: "1rem", color: "var(--secondary-color)" }}>Recall</th>
                    <th style={{ padding: "1rem", color: "#10b981" }}>F1 Score</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metricsData).map(([model, metrics]) => (
                    <tr key={model} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "1rem", fontWeight: "bold" }}>{model}</td>
                      <td style={{ padding: "1rem" }}>{metrics.precision?.toFixed(2) || "0.00"}</td>
                      <td style={{ padding: "1rem" }}>{metrics.recall?.toFixed(2) || "0.00"}</td>
                      <td style={{ padding: "1rem", fontWeight: "bold", textShadow: "0 0 10px rgba(16,185,129,0.3)" }}>{metrics.f1?.toFixed(2) || "0.00"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
