"use client";

import React, { useState, useRef, useContext, useEffect } from "react";
import Link from "next/link";
import "./globals.css";
import { PipelineContext } from "./PipelineContext";

function DatasetModal({ isOpen, onClose, existingMatches, selectedDataset, setSelectedDataset }) {
  const [history, setHistory] = useState([]);
  const [expandedMetrics, setExpandedMetrics] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/metrics")
        .then(res => res.json())
        .then(data => setHistory(data))
        .catch(err => console.error(err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const models = [
    { id: "roberta-base", label: "Roberta" },
    { id: "microsoft/deberta-base", label: "DeBERTa" },
    { id: "answerdotai/ModernBERT-base", label: "ModernBERT" },
    { id: "bert-base-uncased", label: "BERT" },
  ];

  const datasetOptions = ["all", ...existingMatches];

  const getHistoryFor = (dataset, modelId) => {
    if (dataset === "all") return [];
    // Find the latest evaluation round for this match_id and model_used
    const records = history.filter(h => h.match_id === dataset && h.model_used === modelId);
    return records.sort((a, b) => b.training_round - a.training_round || b.evaluation_round - a.evaluation_round);
  };

  const toggleMetrics = (dataset, modelId) => {
    const key = `${dataset}-${modelId}`;
    setExpandedMetrics(expandedMetrics === key ? null : key);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, 
      backgroundColor: "rgba(0,0,0,0.7)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: "90%", maxWidth: "900px", maxHeight: "90vh", overflowY: "auto", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: "1rem", right: "1rem", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>×</button>
        <h2 className="card-title">Select Dataset</h2>
        <p className="page-subtitle" style={{ fontSize: "0.9rem" }}>View previous trainings and evaluation metrics for each model.</p>
        
        <div className="table-container mt-3">
          <table className="table-modern">
            <thead>
              <tr>
                <th>Dataset</th>
                {models.map(m => <th key={m.id} style={{ textAlign: "center" }}>{m.label}</th>)}
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {datasetOptions.map(ds => (
                <React.Fragment key={ds}>
                  <tr>
                    <td style={{ fontWeight: "bold" }}>{ds === "all" ? "All Datasets" : ds}</td>
                    {models.map(m => {
                      const records = getHistoryFor(ds, m.id);
                      const hasTrained = records.length > 0;
                      return (
                        <td key={m.id} style={{ textAlign: "center" }}>
                          {ds === "all" ? "-" : hasTrained ? (
                            <button 
                              onClick={() => toggleMetrics(ds, m.id)}
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--primary-color)" }}
                              title="Click to view metrics"
                            >
                              ✅ <small style={{ color: "#a1a1aa" }}>(v{records[0].training_round})</small>
                            </button>
                          ) : (
                            <span style={{ opacity: 0.5 }}>❌</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "right" }}>
                      <button 
                        className={`btn ${selectedDataset === ds ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => { setSelectedDataset(ds); onClose(); }}
                        style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
                      >
                        {selectedDataset === ds ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                  
                  {/* Expanded Metrics Row */}
                  {models.map(m => {
                    const key = `${ds}-${m.id}`;
                    if (expandedMetrics === key) {
                      const records = getHistoryFor(ds, m.id);
                      const latest = records[0];
                      if (!latest) return null;
                      
                      return (
                        <tr key={`metrics-${key}`} style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
                          <td colSpan={6} style={{ padding: "1rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                              <h4 style={{ margin: 0, color: "var(--primary-color)" }}>{m.label} Evaluation (Round {latest.training_round})</h4>
                              <small style={{ color: "#a1a1aa" }}>{new Date(latest.timestamp).toLocaleString()}</small>
                            </div>
                            <table className="table-modern" style={{ fontSize: "0.85rem", background: "rgba(255,255,255,0.02)" }}>
                              <thead>
                                <tr>
                                  <th>Approach</th>
                                  <th>Precision</th>
                                  <th>Recall</th>
                                  <th>F1 Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(latest.metrics).map(([approach, vals]) => (
                                  <tr key={approach}>
                                    <td>{approach}</td>
                                    <td>{vals.precision?.toFixed(2)}</td>
                                    <td>{vals.recall?.toFixed(2)}</td>
                                    <td style={{ color: "var(--success-color)", fontWeight: "bold" }}>{vals.f1?.toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      );
                    }
                    return null;
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StepItem({ step, activeColor, handleMlProcessSkipTrain, isProcessing, isMlProcessing }) {
  const logRef = useRef(null);
  const hasLiveLines = step.lines && step.lines.length > 0;
  const showBox = hasLiveLines || step.log || step.status === "active";

  useEffect(() => {
      if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
      }
  }, [step.lines, step.log]);

  return (
    <div style={{
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
        <div ref={logRef} style={{
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
}

export default function Home() {
  const [matchId, setMatchId] = useState("");
  const [existingMatches, setExistingMatches] = useState([]);
  const [fullVideo, setFullVideo] = useState(null);
  const [highlightVideo, setHighlightVideo] = useState(null);
  const [activeTab, setActiveTab] = useState(1);
  const [showDatasetModal, setShowDatasetModal] = useState(false);

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

  const onStartProcess = () => {
    if (!matchId)        return alert("Please enter a Match Identifier Base Name!");
    if (!fullVideo)      return alert("Please select the Full Match MP4!");
    if (!highlightVideo) return alert("Please select the Highlight MP4!");
    handleProcess(matchId, fullVideo, highlightVideo);
    setActiveTab(2);
  };

  const onResumeProcess = () => {
    if (!matchId) return alert("Please enter the Match Identifier Base Name that you want to resume processing for!");
    handleResume(matchId);
    setActiveTab(2);
  };

  useEffect(() => {
    const labelStep = steps.find(s => s.id === "label");
    if (activeTab === 2 && labelStep && labelStep.status === "done" && !isProcessing) {
      setActiveTab(3);
    }
  }, [steps, isProcessing, activeTab]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <DatasetModal 
        isOpen={showDatasetModal} 
        onClose={() => setShowDatasetModal(false)}
        existingMatches={existingMatches}
        selectedDataset={selectedDataset}
        setSelectedDataset={setSelectedDataset}
      />
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

      <div className="tabs-container">
        <button className={`tab-btn ${activeTab === 1 ? 'active' : ''}`} onClick={() => setActiveTab(1)}>1. Context &amp; Videos</button>
        <button className={`tab-btn ${activeTab === 2 ? 'active' : ''}`} onClick={() => setActiveTab(2)}>2. Pipeline Progress</button>
        <button className={`tab-btn ${activeTab === 3 ? 'active' : ''}`} onClick={() => setActiveTab(3)}>3. ML Execution</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* ── Tab 1 ── */}
        {activeTab === 1 && (
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
        )}

        {/* ── Tab 2 ── */}
        {activeTab === 2 && (
          <section className="glass-card">
            <h2 className="card-title">⚙️ 2. Data Pipeline Progress</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {steps.map(s => <StepItem key={s.id} step={s} activeColor="var(--primary-color)" handleMlProcessSkipTrain={handleMlProcessSkipTrain} isProcessing={isProcessing} isMlProcessing={isMlProcessing} />)}
            </div>
          </section>
        )}

        {/* ── Tab 3 ── */}
        {activeTab === 3 && (
          <>
            <section className="glass-card">
              <div className="flex-between mb-3" style={{ flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
                <h2 className="card-title" style={{ margin: 0, minWidth: "250px" }}>🧠 3. Advanced ML Execution</h2>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", flex: "1", justifyContent: "flex-end" }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => setShowDatasetModal(true)}
                    disabled={isProcessing || isMlProcessing}
                    style={{ maxWidth: "220px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                  >
                    Dataset: {selectedDataset === "all" ? "All Datasets" : selectedDataset}
                  </button>
                  <select 
                    className="form-select" 
                    value={selectedModel} 
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isProcessing || isMlProcessing}
                    style={{ maxWidth: "200px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                    title="Select Model"
                  >
                    <option value="roberta-base">Roberta</option>
                    <option value="microsoft/deberta-base">DeBERTa</option>
                    <option value="answerdotai/ModernBERT-base">ModernBERT</option>
                    <option value="bert-base-uncased">BERT</option>
                  </select>
                  <button className="btn btn-primary" onClick={handleMlProcess} disabled={isProcessing || isMlProcessing} style={{ whiteSpace: "nowrap" }}>
                    {isMlProcessing ? "Executing..." : "Run ML Sequence"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {mlSteps.map(s => <StepItem key={s.id} step={s} activeColor="var(--secondary-color)" handleMlProcessSkipTrain={handleMlProcessSkipTrain} isProcessing={isProcessing} isMlProcessing={isMlProcessing} />)}
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
          </>
        )}
      </div>
    </div>
  );
}
