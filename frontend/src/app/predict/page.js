"use client";

import React, { useState, useRef, useEffect } from "react";
import { streamSSE } from "../../lib/sse";

function scoreColor(score) {
  if (score >= 0.66) return "#f87171"; // high excitement — red
  if (score >= 0.33) return "#fbbf24"; // medium — amber
  return "#34d399"; // low — green
}

function LogPanel({ lines, active }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  if (lines.length === 0 && !active) return null;

  return (
    <div ref={logRef} style={{
      marginTop: "1rem",
      background: "rgba(0,0,0,0.5)",
      padding: "1rem",
      borderRadius: "8px",
      fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
      fontSize: "0.85rem",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      maxHeight: "260px",
      overflowY: "auto",
      lineHeight: "1.7",
      border: "1px solid rgba(255,255,255,0.07)",
      boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)",
    }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.type === "stderr" ? "#fbbf24" : "#a7f3d0" }}>{l.text}</div>
      ))}
      {active && <span style={{ animation: "blink 1s step-end infinite", color: "#a7f3d0" }}>▋</span>}
    </div>
  );
}

function Timeline({ predictions }) {
  if (!predictions.length) return null;
  const totalEnd = predictions[predictions.length - 1].end || 1;

  return (
    <div style={{
      display: "flex",
      width: "100%",
      height: "28px",
      borderRadius: "6px",
      overflow: "hidden",
      border: "1px solid var(--glass-border)",
    }}>
      {predictions.map((p, i) => (
        <div
          key={i}
          title={`${p.start}s - ${p.end}s | ${p.predicted_event} | score ${(p.hybrid_score ?? 0).toFixed(2)}`}
          style={{
            width: `${((p.end - p.start) / totalEnd) * 100}%`,
            background: scoreColor(p.hybrid_score ?? 0),
            opacity: p.predicted_event === "normal_play" ? 0.25 : 0.9,
          }}
        />
      ))}
    </div>
  );
}

export default function PredictPage() {
  const [file, setFile] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [showClips, setShowClips] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const abortControllerRef = useRef(null);

  const refreshHistory = () => {
    setHistoryLoading(true);
    fetch("/api/predict-jobs")
      .then((res) => res.json())
      .then((data) => setJobHistory(data.jobs || []))
      .catch((err) => console.error("Failed to fetch predict job history", err))
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => {
    fetch("/api/predict-models")
      .then((res) => res.json())
      .then((data) => {
        const models = data.models || [];
        setAvailableModels(models);
        if (models.length > 0) {
          // Default to the model marked "best" on the Compare Models page,
          // if one is set and still has a checkpoint on disk; otherwise
          // fall back to the first available model.
          const best = models.find((m) => m.isBest);
          setSelectedModel((best || models[0]).id);
        }
      })
      .catch((err) => console.error("Failed to fetch available models", err))
      .finally(() => setModelsLoading(false));

    refreshHistory();
  }, []);

  const uploadFile = (jobId, signal) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("jobId", jobId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/predict-upload", true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed. File may be too large.")));
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.onabort = () => reject(new Error("Upload aborted."));
      signal.addEventListener("abort", () => xhr.abort());
      xhr.send(fd);
    });

  const handlePredict = async () => {
    if (!file) return alert("Please select an audio or video clip first.");
    if (!selectedModel) return alert("No trained model available to run predictions with.");

    setIsProcessing(true);
    setUploadPct(0);
    setLogLines([]);
    setError(null);
    setResults(null);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const newJobId = crypto.randomUUID();
    setJobId(newJobId);

    try {
      await uploadFile(newJobId, signal);

      const url = `/api/predict-run?jobId=${newJobId}&modelName=${encodeURIComponent(selectedModel)}`;
      await streamSSE(url, (text, type) => setLogLines((prev) => [...prev, { text, type }]), signal);

      const res = await fetch(`/api/predict-results?jobId=${newJobId}`);
      if (!res.ok) throw new Error("Failed to load prediction results.");
      const data = await res.json();
      setResults(data);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setIsProcessing(false);
      refreshHistory();
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setIsProcessing(false);
  };

  const handleLoadJob = async (job) => {
    if (job.status !== "done") return;
    setError(null);
    setLogLines([]);
    setJobId(job.jobId);
    try {
      const res = await fetch(`/api/predict-results?jobId=${job.jobId}`);
      if (!res.ok) throw new Error("Failed to load prediction results.");
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadCsv = () => {
    if (!results?.predictions.length) return;

    const headers = ["start", "end", "predicted_event", "confidence", "hybrid_score", "roberta_score", "lexicon_score"];
    const rows = results.predictions.map((p) => [
      p.start,
      p.end,
      p.predicted_event,
      ((p.predicted_event_prob ?? 0) * 100).toFixed(1),
      (p.hybrid_score ?? 0).toFixed(3),
      (p.roberta_score ?? 0).toFixed(3),
      (p.lexicon_score ?? 0).toFixed(3),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `predictions_${jobId || "result"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="page-title">Predict</h1>
          <p className="page-subtitle mb-0">Upload a match clip and run hybrid event/highlight prediction with a trained model.</p>
        </div>
        {isProcessing && (
          <button className="btn btn-danger" onClick={handleStop} style={{ animation: "pulse 1.5s infinite" }}>
            🛑 Stop
          </button>
        )}
      </div>

      <section className="glass-card mb-2">
        <h2 className="card-title">🎙️ Upload &amp; Configure</h2>

        <div className="form-group">
          <label className="form-label">Match Audio/Video Clip</label>
          <input
            type="file"
            className="form-file"
            accept="audio/*,video/*"
            onChange={(e) => setFile(e.target.files[0])}
            disabled={isProcessing}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Model</label>
          {modelsLoading ? (
            <p className="mb-0">Checking for trained models...</p>
          ) : availableModels.length === 0 ? (
            <div className="alert alert-error">No fine-tuned models found. Train a model on the Dashboard first.</div>
          ) : (
            <select
              className="form-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isProcessing}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{m.isBest ? " ★ Best" : ""}</option>
              ))}
            </select>
          )}
        </div>

        <button
          className="btn btn-primary w-full"
          onClick={handlePredict}
          disabled={isProcessing || availableModels.length === 0}
        >
          {isProcessing ? (uploadPct < 100 && logLines.length === 0 ? `Uploading… ${uploadPct}%` : "Predicting…") : "Predict"}
        </button>

        {error && <div className="alert alert-error mt-2">{error}</div>}

        <LogPanel lines={logLines} active={isProcessing} />
      </section>

      <section className="glass-card mb-2">
        <div className="flex-between mb-2">
          <h2 className="card-title" style={{ margin: 0 }}>🕘 Past Predictions</h2>
          <button type="button" className="btn btn-secondary" onClick={refreshHistory} disabled={historyLoading}>
            {historyLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {historyLoading && <p className="mb-0">Loading history...</p>}
        {!historyLoading && jobHistory.length === 0 && <p className="mb-0">No predictions run yet.</p>}
        {!historyLoading && jobHistory.length > 0 && (
          <div className="table-container">
            <table className="table-modern">
              <thead>
                <tr>
                  <th>Clip</th>
                  <th>Model</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                  <th>Windows</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobHistory.map((job) => (
                  <tr key={job.jobId} style={{ opacity: job.jobId === jobId ? 1 : 0.85 }}>
                    <td style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job.originalName || job.jobId}
                    </td>
                    <td>{availableModels.find((m) => m.id === job.modelName)?.label || job.modelName || "-"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{job.uploadedAt ? new Date(job.uploadedAt).toLocaleString() : "-"}</td>
                    <td>
                      {job.status === "done" && <span style={{ color: "var(--success-color)" }}>✅ Done</span>}
                      {job.status === "running" && <span style={{ color: "var(--primary-color)" }}>⏳ Running</span>}
                      {job.status === "failed" && <span style={{ color: "var(--error-color)" }} title={job.error}>❌ Failed</span>}
                      {job.status === "uploaded" && <span>📤 Uploaded</span>}
                    </td>
                    <td>{job.status === "done" ? job.windowCount : "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleLoadJob(job)}
                        disabled={job.status !== "done"}
                        style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {results && (
        <section className="glass-card">
          <div className="flex-between mb-2">
            <h2 className="card-title" style={{ margin: 0 }}>📊 Results</h2>
            {results.predictions.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={handleDownloadCsv}>
                ⬇ Download CSV
              </button>
            )}
          </div>

          {results.predictions.length === 0 ? (
            <p>No speech/events detected in this clip.</p>
          ) : (
            <>
              <div className="mb-2">
                <Timeline predictions={results.predictions} />
              </div>

              <div className="table-container mb-2">
                <table className="table-modern">
                  <thead>
                    <tr>
                      <th>Window (s)</th>
                      <th>Predicted Event</th>
                      <th>Confidence</th>
                      <th>Highlight Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.predictions.map((p, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>{p.start}–{p.end}</td>
                        <td style={{
                          color: p.predicted_event !== "normal_play" ? "var(--success-color)" : "inherit",
                          fontWeight: p.predicted_event !== "normal_play" ? 600 : 400,
                        }}>
                          {p.predicted_event}
                        </td>
                        <td>{Math.min(100, (p.predicted_event_prob ?? 0) * 100).toFixed(1)}%</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div style={{ width: "100px", height: "8px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min(100, (p.hybrid_score ?? 0) * 100)}%`,
                                height: "100%",
                                background: scoreColor(p.hybrid_score ?? 0),
                              }} />
                            </div>
                            <span>{(p.hybrid_score ?? 0).toFixed(2)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {results.highlightClips && results.highlightClips.length > 0 && (
                <div>
                  <button className="btn btn-secondary" onClick={() => setShowClips((v) => !v)}>
                    {showClips ? "Hide" : "Show"} Merged Highlight Clips ({results.highlightClips.length})
                  </button>
                  {showClips && (
                    <div className="table-container mt-2">
                      <table className="table-modern">
                        <thead>
                          <tr>
                            <th>Start (s)</th>
                            <th>End (s)</th>
                            <th>Primary Event</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.highlightClips.map((c, i) => (
                            <tr key={i}>
                              <td>{c.start}</td>
                              <td>{c.end}</td>
                              <td>{c.primary_event}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
