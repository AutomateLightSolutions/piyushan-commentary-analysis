"use client";

import React, { useState, useRef, useContext, useEffect } from "react";
import Link from "next/link";
import "./globals.css";
import { PipelineContext } from "./PipelineContext";

function DatasetModal({ isOpen, onClose, existingMatches, selectedDataset, setSelectedDataset, refreshMatches }) {
  const [history, setHistory] = useState([]);
  const [expandedMetrics, setExpandedMetrics] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingDataset, setViewingDataset] = useState(null);
  const [datasetRows, setDatasetRows] = useState([]);
  // Datasets checked but not yet confirmed - lets the user pick several
  // specific matches to train on together, rather than one at a time.
  const [pendingSelection, setPendingSelection] = useState([]);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/metrics")
        .then(res => res.json())
        .then(data => setHistory(data))
        .catch(err => console.error(err));
      // Re-seed the checkboxes from the current selection every time the
      // modal opens, so it reflects what's actually active.
      setPendingSelection(selectedDataset === "all" ? [] : selectedDataset.split(",").filter(Boolean));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleDataset = (ds) => {
    setPendingSelection(prev =>
      prev.includes(ds) ? prev.filter(d => d !== ds) : [...prev, ds]
    );
  };

  const confirmSelection = () => {
    if (pendingSelection.length === 0) return;
    setSelectedDataset(pendingSelection.join(","));
    onClose();
  };

  const models = [
    { id: "roberta-base", label: "Roberta" },
    { id: "microsoft/deberta-base", label: "DeBERTa" },
    { id: "answerdotai/ModernBERT-base", label: "ModernBERT" },
    { id: "bert-base-uncased", label: "BERT" },
  ];

  const datasetOptions = ["all", ...existingMatches];
  const filteredDatasets = datasetOptions.filter(ds => 
    ds === "all" ? "all datasets".includes(searchQuery.toLowerCase()) : ds.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getHistoryFor = (dataset, modelId) => {
    if (dataset === "all") return [];
    const records = history.filter(h => h.match_id === dataset && h.model_used === modelId);
    return records.sort((a, b) => b.training_round - a.training_round || b.evaluation_round - a.evaluation_round);
  };

  const toggleMetrics = (dataset, modelId) => {
    const key = `${dataset}-${modelId}`;
    setExpandedMetrics(expandedMetrics === key ? null : key);
  };

  const handleDelete = async (ds) => {
    if (ds === "all") return;
    if (!window.confirm(`Are you sure you want to completely delete dataset "${ds}"? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/manage-matches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: ds, filesToDelete: "all" })
      });
      if (res.ok) {
        if (selectedDataset !== "all" && selectedDataset.split(",").includes(ds)) {
          const remaining = selectedDataset.split(",").filter(d => d !== ds);
          setSelectedDataset(remaining.length > 0 ? remaining.join(",") : "all");
        }
        setPendingSelection(prev => prev.filter(d => d !== ds));
        if (refreshMatches) refreshMatches();
      } else {
        alert("Failed to delete dataset.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting dataset.");
    }
  };

  const handleViewDataset = async (ds) => {
    if (ds === "all") return;
    try {
      const res = await fetch(`/api/dataset-csv?matchId=${ds}`);
      const data = await res.json();
      setDatasetRows(data.rows || []);
      setViewingDataset(ds);
    } catch (err) {
      console.error(err);
      alert("Error loading dataset");
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, 
      backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: "95%", maxWidth: "1200px", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative", backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: "1.5rem", right: "1.5rem", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer", padding: "0.5rem", zIndex: 20 }}>×</button>
        
        <h2 className="card-title mb-1">Choose a dataset to execute the ML pipeline.</h2>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <p className="page-subtitle" style={{ fontSize: "1rem", margin: 0 }}>
            Showing {filteredDatasets.length} of {datasetOptions.length} datasets
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ fontSize: "0.85rem", display: "flex", gap: "1rem", color: "#a1a1aa" }}>
              <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "var(--success-color)", marginRight: "4px" }}></span>Trained</span>
              <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#52525b", marginRight: "4px" }}></span>Not Trained</span>
            </div>
            <input 
              type="text" 
              className="form-input" 
              placeholder="🔍 Search Dataset..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ padding: "0.4rem 0.8rem", maxWidth: "250px" }}
            />
          </div>
        </div>
        
        <div className="table-container" style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          {filteredDatasets.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#a1a1aa" }}>No datasets available matching your search.</div>
          ) : (
            <table className="table-modern" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(15, 23, 42, 0.95)", backdropFilter: "blur(4px)" }}>
                <tr>
                  <th style={{ padding: "1rem", textAlign: "left" }}>Dataset</th>
                  {models.map(m => <th key={m.id} style={{ padding: "1rem", textAlign: "center" }}>{m.label}</th>)}
                  <th style={{ padding: "1rem", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDatasets.map(ds => {
                  const isSelected = ds === "all" ? selectedDataset === "all" : pendingSelection.includes(ds);
                  return (
                    <React.Fragment key={ds}>
                      <tr style={{ 
                        backgroundColor: isSelected ? "rgba(139, 92, 246, 0.15)" : "transparent",
                        borderLeft: isSelected ? "4px solid var(--primary-color)" : "4px solid transparent",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        transition: "background-color 0.2s"
                      }}>
                        <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", maxWidth: "250px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={ds === "all" ? "All Datasets" : ds}>
                          {ds === "all" ? (
                            "All Datasets"
                          ) : (
                            <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", fontWeight: "inherit" }}>
                              <input
                                type="checkbox"
                                checked={pendingSelection.includes(ds)}
                                onChange={() => toggleDataset(ds)}
                                style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
                              />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ds}</span>
                            </label>
                          )}
                        </td>
                        {models.map(m => {
                          const records = getHistoryFor(ds, m.id);
                          const hasTrained = records.length > 0;
                          return (
                            <td key={m.id} style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                              {ds === "all" ? <span style={{ color: "#52525b" }}>-</span> : hasTrained ? (
                                <button 
                                  onClick={() => toggleMetrics(ds, m.id)}
                                  style={{ 
                                    background: "rgba(16, 185, 129, 0.1)", 
                                    border: "1px solid rgba(16, 185, 129, 0.3)", 
                                    color: "var(--success-color)",
                                    borderRadius: "12px",
                                    padding: "0.2rem 0.6rem",
                                    fontSize: "0.8rem",
                                    cursor: "pointer",
                                    transition: "all 0.2s"
                                  }}
                                  title="Click to view evaluation metrics"
                                >
                                  v{records[0].training_round} Available
                                </button>
                              ) : (
                                <span style={{ 
                                  background: "rgba(82, 82, 91, 0.1)", 
                                  border: "1px solid rgba(82, 82, 91, 0.3)", 
                                  color: "#a1a1aa",
                                  borderRadius: "12px",
                                  padding: "0.2rem 0.6rem",
                                  fontSize: "0.8rem",
                                  display: "inline-block"
                                }}>
                                  Not Trained
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
                            {ds === "all" && (
                              <button
                                className={`btn ${isSelected ? "btn-primary" : "btn-secondary"}`}
                                onClick={() => { setSelectedDataset("all"); onClose(); }}
                                style={{ padding: "0.4rem 0", width: "80px", fontSize: "0.85rem", fontWeight: isSelected ? "bold" : "normal" }}
                              >
                                {isSelected ? "Selected ✓" : "Select"}
                              </button>
                            )}
                            {ds !== "all" && (
                              <>
                                <button 
                                  className="btn"
                                  onClick={() => handleViewDataset(ds)}
                                  style={{ padding: "0.4rem 0", width: "40px", fontSize: "0.85rem", background: "rgba(59, 130, 246, 0.2)", border: "1px solid rgba(59, 130, 246, 0.4)", color: "#60a5fa", cursor: "pointer", borderRadius: "8px" }}
                                  title="View Dataset"
                                >
                                  👁️
                                </button>
                                <button 
                                  className="btn"
                                  onClick={() => handleDelete(ds)}
                                  style={{ padding: "0.4rem 0", width: "40px", fontSize: "0.85rem", background: "rgba(239, 68, 68, 0.2)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#f87171", cursor: "pointer", borderRadius: "8px" }}
                                  title="Delete Dataset"
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
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
                            <tr key={`metrics-${key}`} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
                              <td colSpan={6} style={{ padding: "1.5rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                                  <h4 style={{ margin: 0, color: "var(--primary-color)", fontSize: "1.1rem" }}>{m.label} Evaluation (Round {latest.training_round})</h4>
                                  <small style={{ color: "#a1a1aa", fontSize: "0.9rem" }}>{new Date(latest.timestamp).toLocaleString()}</small>
                                </div>
                                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                                  <div style={{ flex: "1 1 45%" }}>
                                    <h5 style={{ margin: "0 0 0.5rem 0", color: "#e2e8f0" }}>🎯 Event Detection (Classification)</h5>
                                    <table className="table-modern" style={{ fontSize: "0.95rem", background: "rgba(255,255,255,0.03)", width: "100%" }}>
                                      <thead>
                                        <tr>
                                          <th style={{ padding: "0.75rem" }}>Approach</th>
                                          <th style={{ padding: "0.75rem" }}>Precision</th>
                                          <th style={{ padding: "0.75rem" }}>Recall</th>
                                          <th style={{ padding: "0.75rem" }}>F1 Score</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {latest.metrics?.Classification && Object.entries(latest.metrics.Classification).map(([approach, vals]) => (
                                          <tr key={approach}>
                                            <td style={{ padding: "0.75rem" }}>{approach}</td>
                                            <td style={{ padding: "0.75rem" }}>{vals.precision?.toFixed(2)}</td>
                                            <td style={{ padding: "0.75rem" }}>{vals.recall?.toFixed(2)}</td>
                                            <td style={{ padding: "0.75rem", color: "var(--success-color)", fontWeight: "bold" }}>{vals.f1?.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  
                                  <div style={{ flex: "1 1 45%" }}>
                                    <h5 style={{ margin: "0 0 0.5rem 0", color: "#e2e8f0" }}>📈 Highlight Scoring (Regression)</h5>
                                    <table className="table-modern" style={{ fontSize: "0.95rem", background: "rgba(255,255,255,0.03)", width: "100%" }}>
                                      <thead>
                                        <tr>
                                          <th style={{ padding: "0.75rem" }}>Approach</th>
                                          <th style={{ padding: "0.75rem" }}>MSE</th>
                                          <th style={{ padding: "0.75rem" }}>MAE</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {latest.metrics?.Regression && Object.entries(latest.metrics.Regression).map(([approach, vals]) => (
                                          <tr key={approach}>
                                            <td style={{ padding: "0.75rem" }}>{approach}</td>
                                            <td style={{ padding: "0.75rem", color: "#fca5a5" }}>{vals.mse?.toFixed(4)}</td>
                                            <td style={{ padding: "0.75rem", color: "#fca5a5" }}>{vals.mae?.toFixed(4)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }
                        return null;
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)"
        }}>
          <span style={{ fontSize: "0.9rem", color: "#a1a1aa" }}>
            {pendingSelection.length === 0
              ? "Check one or more datasets above to train on a specific combination."
              : `${pendingSelection.length} dataset${pendingSelection.length > 1 ? "s" : ""} checked`}
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {pendingSelection.length > 0 && (
              <button className="btn btn-secondary" onClick={() => setPendingSelection([])} style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
                Clear
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={confirmSelection}
              disabled={pendingSelection.length === 0}
              style={{ padding: "0.5rem 1.2rem", fontSize: "0.9rem", opacity: pendingSelection.length === 0 ? 0.5 : 1, cursor: pendingSelection.length === 0 ? "not-allowed" : "pointer" }}
            >
              Train on {pendingSelection.length === 0 ? "Selected" : `${pendingSelection.length} Dataset${pendingSelection.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>

        {viewingDataset && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div className="glass-card" style={{ width: "90%", maxWidth: "900px", maxHeight: "85vh", display: "flex", flexDirection: "column", position: "relative", backgroundColor: "#1e293b", padding: "1.5rem" }}>
              <button onClick={() => setViewingDataset(null)} style={{ position: "absolute", top: "1rem", right: "1rem", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>×</button>
              <h3 style={{ margin: "0 0 1rem 0" }}>Dataset: {viewingDataset}</h3>
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table className="table-modern" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#0f172a" }}>
                    <tr>
                      <th style={{ padding: "0.5rem" }}>Start</th>
                      <th style={{ padding: "0.5rem" }}>End</th>
                      <th style={{ padding: "0.5rem" }}>Text</th>
                      <th style={{ padding: "0.5rem" }}>Event</th>
                      <th style={{ padding: "0.5rem" }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasetRows.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>No data found</td></tr>
                    ) : (
                      datasetRows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                          <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>{row.start}</td>
                          <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>{row.end}</td>
                          <td style={{ padding: "0.5rem", maxWidth: "400px", whiteSpace: "normal" }}>{row.text}</td>
                          <td style={{ padding: "0.5rem", whiteSpace: "nowrap", color: row.event && row.event !== "no_event" && row.event !== "" ? "var(--success-color)" : "inherit" }}>{row.event}</td>
                          <td style={{ padding: "0.5rem" }}>{row.score}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
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
  const [activeTab, setActiveTab] = useState(1);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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

  const fetchMatches = () => {
    fetch("/api/manage-matches")
      .then(res => res.json())
      .then(data => setExistingMatches(data.matchIds || []))
      .catch(err => console.error("Failed to fetch existing matches", err));
  };

  useEffect(() => {
    fetchMatches();
  }, []);

  const onStartProcess = () => {
    if (!matchId)        return alert("Please enter a Match Identifier Base Name!");
    if (!fullVideo)      return alert("Please select the Full Match MP4!");
    handleProcess(matchId, fullVideo);
    setActiveTab(2);
  };

  const onResumeProcess = () => {
    if (!matchId) return alert("Please enter the Match Identifier Base Name that you want to resume processing for!");
    handleResume(matchId);
    setActiveTab(2);
  };

  useEffect(() => {
    if (isMlProcessing) {
      setActiveTab(3);
    } else if (isProcessing) {
      setActiveTab(2);
    }
  }, []);

  useEffect(() => {
    const labelStep = steps.find(s => s.id === "label");
    if (labelStep && labelStep.status === "done" && !isProcessing) {
      setActiveTab(prev => (prev === 2 ? 3 : prev));
    }
  }, [steps, isProcessing]);

  const handleDownloadModel = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/download-model?modelName=${encodeURIComponent(selectedModel)}&checkOnly=true`);
      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to download model');
        setIsDownloading(false);
        return;
      }
      
      // If check passes, trigger browser native download 
      window.location.href = `/api/download-model?modelName=${encodeURIComponent(selectedModel)}`;
      
      // Revert button text after a short delay
      setTimeout(() => {
        setIsDownloading(false);
      }, 3000);
    } catch (error) {
      console.error(error);
      alert("An error occurred while downloading the model.");
      setIsDownloading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <DatasetModal 
        isOpen={showDatasetModal} 
        onClose={() => setShowDatasetModal(false)}
        existingMatches={existingMatches}
        selectedDataset={selectedDataset}
        setSelectedDataset={setSelectedDataset}
        refreshMatches={fetchMatches}
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
        <button className={`tab-btn ${activeTab === 4 ? 'active' : ''}`} onClick={() => setActiveTab(4)}>4. Download Model</button>
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
                    title={selectedDataset === "all" ? "All Datasets" : selectedDataset.split(",").join(", ")}
                    style={{ maxWidth: "220px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                  >
                    Dataset: {selectedDataset === "all"
                      ? "All Datasets"
                      : selectedDataset.split(",").length > 1
                        ? `${selectedDataset.split(",").length} Datasets`
                        : selectedDataset}
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

            {metricsData && metricsData.Classification && (
              <section className="glass-card">
                <h2 className="card-title">📊 Final Evaluation Metrics</h2>
                
                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 45%" }}>
                    <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", color: "#e2e8f0", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem" }}>
                      🎯 Event Detection (Classification)
                    </h3>
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
                          {Object.entries(metricsData.Classification).map(([model, metrics]) => (
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
                  </div>

                  <div style={{ flex: "1 1 45%" }}>
                    <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", color: "#e2e8f0", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem" }}>
                      📈 Highlight Scoring (Regression)
                    </h3>
                    <div className="table-container">
                      <table className="table-modern">
                        <thead>
                          <tr>
                            <th>Model Approach</th>
                            <th style={{ color: "#fca5a5" }}>MSE (Mean Squared Error)</th>
                            <th style={{ color: "#fca5a5" }}>MAE (Mean Absolute Error)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(metricsData.Regression).map(([model, metrics]) => (
                            <tr key={model}>
                              <td style={{ fontWeight: "600" }}>{model}</td>
                              <td style={{ color: "#fca5a5" }}>{metrics.mse?.toFixed(4) || "0.0000"}</td>
                              <td style={{ color: "#fca5a5" }}>{metrics.mae?.toFixed(4) || "0.0000"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Tab 4 ── */}
        {activeTab === 4 && (
          <section className="glass-card">
            <h2 className="card-title">📥 4. Download Trained Model</h2>
            <p className="page-subtitle" style={{ marginBottom: "1.5rem" }}>
              Download the fully fine-tuned model package as a zip archive.
            </p>
            <div className="form-group" style={{ maxWidth: "400px" }}>
              <label className="form-label">Select Model</label>
              <select 
                className="form-select mb-3" 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="roberta-base">Roberta</option>
                <option value="microsoft/deberta-base">DeBERTa</option>
                <option value="answerdotai/ModernBERT-base">ModernBERT</option>
                <option value="bert-base-uncased">BERT</option>
              </select>
              
              <button 
                onClick={handleDownloadModel}
                disabled={isDownloading}
                className="btn btn-primary w-full"
                style={{ textDecoration: 'none', textAlign: 'center', display: 'block', padding: '0.75rem' }}
              >
                {isDownloading ? "⏳ Preparing Download..." : "📥 Download Model (.zip)"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
