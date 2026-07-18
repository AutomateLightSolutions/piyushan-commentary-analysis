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
    selectedModel,
    setSelectedModel,
    selectedDataset,
    setSelectedDataset,
    isProcessing,
    isMlProcessing,
    handleProcess,
    handleResume,
    handleMlProcess,
    handleMlProcessSkipTrain,
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

    useEffect(() => {
        const el = logRefs.current[step.id];
        if (el) el.scrollTop = el.scrollHeight;
    }, [step.lines, step.log, step.id]);

    return (
      <div key={step.id} style={{
        opacity: step.status === "idle" ? 0.4 : 1,
        transition: "opacity 0.3s ease",
        borderLeft: `4px solid ${
          step.status === "done"   ? "var(--success-color)" :
          step.status === "active" ? activeColor :
          step.status === "error"  ? "var(--error-color)" : "var(--glass-border)"
        }`,
        paddingLeft: "1rem",
      }}>
        {/* Step header */}
        <div className="flex-between" style={{ fontWeight: "600", fontSize: "1.1rem", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span>{step.name}</span>
            {step.id === "predict" && (
              <button 
                className="btn btn-secondary" 
                onClick={handleMlProcessSkipTrain} 
                disabled={isProcessing || isMlProcessing}
                style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem" }}
              >
                {isMlProcessing ? "Executing..." : "Run Steps 7-12"}
              </button>
            )}
          </div>
          <span style={{ fontSize: "1rem" }}>
            {step.status === "done"   && "✅"}
            {step.status === "active" && <span style={{ display: "inline-block", animation: "pulse 1.2s ease-in-out infinite" }}>⏳</span>}
            {step.status === "error"  && "❌"}
          </span>
        </div>

        {/* Terminal log box */}
        {showBox && (
          <div ref={setRef} style={{
            marginTop: "0.75rem",
            background: "rgba(0,0,0,0.5)",
            padding: "1rem",
            borderRadius: "8px",
            fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "220px",
            overflowY: "auto",
            lineHeight: "1.7",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)"
          }}>
            {/* Static log */}
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

            {/* Blinking cursor */}
            {step.status === "active" && (
              <span style={{ animation: "blink 1s step-end infinite", color: "#a7f3d0" }}>▋</span>
            )}
          </div>
        )}

        {/* Link after label step completes */}
        {step.id === "label" && step.status === "done" && (
          <Link href="/label" className="btn btn-primary mt-2">
            Go to Manual Labeling →
          </Link>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="page-title">Pipeline Dashboard</h1>
          <p className="page-subtitle mb-0">Automated Video Transcription &amp; Chunking Pipeline</p>
        </div>
        {(isProcessing || isMlProcessing) && (
          <button 
            className="btn btn-danger"
            onClick={handleStop}
            style={{ animation: "pulse 1.5s infinite" }}
          >
            🛑 Kill Active Process
          </button>
        )}
      </div>

      <div className="grid-2">
        {/* ── Left Column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          <section className="glass-card">
            <h2 className="card-title">🎥 1. Provide Context &amp; Videos</h2>
            <div className="form-group">
              <label className="form-label">Match Identifier Base Name</label>
              <div className="flex-between" style={{ gap: "0.5rem" }}>
                <input type="text" className="form-input" placeholder="e.g. match_01" value={matchId}
                  onChange={e => setMatchId(e.target.value)} />
                {existingMatches.length > 0 && (
                  <select 
                    className="form-select"
                    onChange={e => { if(e.target.value) setMatchId(e.target.value); e.target.value = ""; }}
                    style={{ width: "auto" }}
                  >
                    <option value="">📋 Existing...</option>
                    {existingMatches.map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Upload Full Match Video (.mp4)</label>
              <input type="file" className="form-file" accept="video/mp4" onChange={e => setFullVideo(e.target.files[0])} />
            </div>
            <div className="form-group">
              <label className="form-label">Upload Highlight Video (.mp4)</label>
              <input type="file" className="form-file" accept="video/mp4" onChange={e => setHighlightVideo(e.target.files[0])} />
            </div>
            <div className="flex-between mt-3" style={{ gap: "1rem" }}>
              <button className="btn btn-primary w-full" onClick={onStartProcess} disabled={isProcessing || isMlProcessing}>
                {isProcessing ? "Pipeline Running..." : "Start Pipeline"}
              </button>
              <button className="btn btn-secondary w-full" onClick={onResumeProcess} disabled={isProcessing || isMlProcessing}>
                Resume (Skip Upload)
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
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          <section className="glass-card">
            <div className="flex-between mb-3" style={{ flexWrap: "wrap", gap: "1rem" }}>
              <h2 className="card-title" style={{ margin: 0 }}>🧠 3. Advanced ML Execution</h2>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <select 
                  className="form-select" 
                  value={selectedDataset} 
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  disabled={isProcessing || isMlProcessing}
                  style={{ width: "auto" }}
                  title="Select Dataset"
                >
                  <option value="all">All Datasets</option>
                  {existingMatches.map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <select 
                  className="form-select" 
                  value={selectedModel} 
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isProcessing || isMlProcessing}
                  style={{ width: "auto" }}
                  title="Select Model"
                >
                  <option value="roberta-base">Roberta</option>
                  <option value="microsoft/deberta-base">DeBERTa</option>
                  <option value="answerdotai/ModernBERT-base">ModernBERT</option>
                  <option value="bert-base-uncased">BERT</option>
                </select>
                <button className="btn btn-primary" onClick={handleMlProcess} disabled={isProcessing || isMlProcessing}>
                  {isMlProcessing ? "Executing..." : "Run ML Sequence"}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {mlSteps.map(s => renderStep(s, "var(--secondary-color)"))}
            </div>
          </section>

          {metricsData && (
            <section className="glass-card">
              <h2 className="card-title">📊 Final Evaluation Metrics</h2>
              <div className="table-container">
                <table className="table-modern">
                  <thead>
                    <tr>
                      <th>Model Approach</th>
                      <th className="text-primary">Precision</th>
                      <th className="text-secondary">Recall</th>
                      <th style={{ color: "var(--success-color)" }}>F1 Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(metricsData).map(([model, metrics]) => (
                      <tr key={model}>
                        <td style={{ fontWeight: "600" }}>{model}</td>
                        <td>{metrics.precision?.toFixed(2) || "0.00"}</td>
                        <td>{metrics.recall?.toFixed(2) || "0.00"}</td>
                        <td style={{ fontWeight: "bold", textShadow: "0 0 10px rgba(16,185,129,0.3)" }}>
                          {metrics.f1?.toFixed(2) || "0.00"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
