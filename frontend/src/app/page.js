"use client";

import { useState, useRef, useContext, useEffect } from "react";
import Link from "next/link";
import "./globals.css";
import { PipelineContext } from "./PipelineContext";

export default function Home() {
  const [matchId, setMatchId] = useState("");
  const [existingMatches, setExistingMatches] = useState([]);
  const [fullVideo, setFullVideo] = useState(null);
  const [highlightVideo, setHighlightVideo] = useState(null);

  const {
    steps,
    mlSteps,
    metricsData,
    isProcessing,
    isMlProcessing,
    handleProcess,
    handleResume,
    handleMlProcess,
    handleStop
  } = useContext(PipelineContext);

  useEffect(() => {
    fetch("/api/manage-matches")
      .then(res => res.json())
      .then(data => setExistingMatches(data.matchIds || []))
      .catch(err => console.error("Failed to fetch existing matches", err));
  }, []);

  const logRefs = useRef({});

  const onStartProcess = () => {
    if (!matchId)        return alert("Please enter a Match Identifier Base Name!");
    if (!fullVideo)      return alert("Please select the Full Match MP4!");
    if (!highlightVideo) return alert("Please select the Highlight MP4!");
    handleProcess(matchId, fullVideo, highlightVideo);
  };

  const onResumeProcess = () => {
    if (!matchId) return alert("Please enter the Match Identifier Base Name that you want to resume processing for!");
    handleResume(matchId);
  };

  // ── Step renderer ──────────────────────────────────────────────────────────
  const renderStep = (step, activeColor) => {
    const setRef = (el) => { if (el) logRefs.current[step.id] = el; };
    const hasLiveLines = step.lines && step.lines.length > 0;
    const showBox = hasLiveLines || step.log || step.status === "active";

    // Auto-scroll logic inside component render is typically best done in effects,
    // but React refs allow us to do it imperatively
    useEffect(() => {
        const el = logRefs.current[step.id];
        if (el) el.scrollTop = el.scrollHeight;
    }, [step.lines, step.log, step.id]);

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
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <h1>Rugby Highlight Analyzer</h1>
            {(isProcessing || isMlProcessing) && (
              <button 
                onClick={handleStop}
                style={{
                  background: "#ef4444", color: "white", border: "none", padding: "0.5rem 1rem", 
                  borderRadius: "6px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem",
                  boxShadow: "0 0 10px rgba(239, 68, 68, 0.4)", animation: "pulse 1.5s infinite"
                }}
              >
                🛑 Kill Active Process
              </button>
            )}
          </div>
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
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" placeholder="e.g. match_01" value={matchId}
                    onChange={e => setMatchId(e.target.value)}
                    style={{ flex: 1, padding: "0.8rem", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
                  {existingMatches.length > 0 && (
                    <select 
                      onChange={e => { if(e.target.value) setMatchId(e.target.value); e.target.value = ""; }}
                      style={{ padding: "0.8rem", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.05)", color: "var(--primary-color)", fontWeight: "bold", cursor: "pointer", outline: "none" }}
                    >
                      <option value="">📋 Select Existing...</option>
                      {existingMatches.map(id => (
                        <option key={id} value={id} style={{ background: "#2a2a2a", color: "white" }}>{id}</option>
                      ))}
                    </select>
                  )}
                </div>
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
              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button className="btn" onClick={onStartProcess}
                  disabled={isProcessing || isMlProcessing} style={{ flex: 1, opacity: (isProcessing || isMlProcessing) ? 0.5 : 1 }}>
                  {isProcessing ? "Pipeline Running..." : "Start System Pipeline"}
                </button>
                <button className="btn" onClick={onResumeProcess}
                  disabled={isProcessing || isMlProcessing} style={{ flex: 1, background: "var(--secondary-color)", border: "1px solid rgba(255,255,255,0.2)", opacity: (isProcessing || isMlProcessing) ? 0.5 : 1 }}>
                  Resume Process (Skip Upload)
                </button>
              </div>
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
                style={{ marginTop: 0, padding: "0.6rem 1.2rem", width: "auto", opacity: (isProcessing || isMlProcessing) ? 0.5 : 1 }}>
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
