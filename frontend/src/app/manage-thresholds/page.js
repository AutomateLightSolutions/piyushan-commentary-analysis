"use client";

import { useState, useEffect } from "react";
import "../globals.css";

// Thresholds that can be empirically optimised via grid search
const OPTIMIZABLE_THRESHOLDS = [
  {
    key: "lexicon_threshold",
    label: "Lexicon Threshold",
    scoreLabel: "lexicon_score",
    description: "Cutoff for lexicon keyword match scores.",
  },
  {
    key: "ml_threshold",
    label: "ML (RoBERTa) Threshold",
    scoreLabel: "roberta_score",
    description: "Cutoff for ML model sigmoid probabilities.",
  },
  {
    key: "hybrid_threshold",
    label: "Hybrid Threshold",
    scoreLabel: "hybrid_score",
    description: "Cutoff for the combined hybrid score (evaluation).",
  },
  {
    key: "merger_threshold",
    label: "Merger Threshold",
    scoreLabel: "hybrid_score",
    description: "Cutoff for including a chunk in the final video clip.",
  },
];

// Labeller threshold cannot be optimised (it defines ground truth)
const MANUAL_ONLY_THRESHOLDS = ["labeller_threshold"];

export default function ManageThresholds() {
  const [settings, setSettings] = useState({
    lexicon_threshold:  0.10,
    ml_threshold:       0.55,
    hybrid_threshold:   0.40,
    merger_threshold:   0.40,
    labeller_threshold: 0.40,
  });

  const [isFetching,   setIsFetching]   = useState(true);
  const [isSaving,     setIsSaving]     = useState(false);
  const [message,      setMessage]      = useState("");

  const [isOptimizing,       setIsOptimizing]       = useState(false);
  const [optimizationResults, setOptimizationResults] = useState(null); // keyed by threshold_key
  const [optimizationModel,   setOptimizationModel]   = useState("roberta-base");
  const [expandedKey,         setExpandedKey]         = useState(null);

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/thresholds");
      if (!res.ok) throw new Error("Failed to load thresholds");
      setSettings(await res.json());
    } catch (err) {
      setMessage(`Error loading thresholds: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/thresholds", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save thresholds");
      setMessage("Thresholds saved successfully!");
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const runOptimization = async () => {
    setIsOptimizing(true);
    setOptimizationResults(null);
    setExpandedKey(null);
    try {
      const res = await fetch("/api/optimize-thresholds", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ modelName: optimizationModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Optimization failed");
      setOptimizationResults(data);
      // Auto-expand first result
      setExpandedKey(OPTIMIZABLE_THRESHOLDS[0].key);
    } catch (err) {
      setMessage(`Optimization Error: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const applyBest = (thresholdKey) => {
    const best = optimizationResults?.[thresholdKey]?.best;
    if (!best) return;
    handleChange(thresholdKey, best.threshold);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyAllBest = () => {
    if (!optimizationResults) return;
    const updates = {};
    for (const { key } of OPTIMIZABLE_THRESHOLDS) {
      const best = optimizationResults[key]?.best;
      if (best) updates[key] = best.threshold;
    }
    setSettings((prev) => ({ ...prev, ...updates }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleChange = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: parseFloat(value) }));
  };

  const formatLabel = (key) =>
    key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const thresholdDescription = (key) => {
    const found = OPTIMIZABLE_THRESHOLDS.find((t) => t.key === key);
    if (found) return found.description;
    if (key === "labeller_threshold")
      return "Overlap ratio to map ground truth timestamps to text chunks. (Manual only — cannot be grid-searched)";
    return "";
  };

  return (
    <div className="app-container" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <header className="mb-4">
        <h1 className="page-title">Manage Thresholds</h1>
        <p className="page-subtitle">
          Configure the core parameters of the evaluation and highlight generation pipeline.
        </p>
      </header>

      <main>
        {/* ── Threshold Sliders ─────────────────────────────────────── */}
        <section className="glass-card">
          {message && (
            <div className={`alert ${message.startsWith("Error") ? "alert-error" : "alert-success"}`}>
              {message}
            </div>
          )}

          {isFetching ? (
            <div className="text-center text-muted py-4">Loading configuration...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div className="table-container">
                <table className="table-modern">
                  <thead>
                    <tr>
                      <th>Threshold Parameter</th>
                      <th style={{ width: "300px" }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(settings)
                      .filter((key) => !key.endsWith("_weight"))
                      .map((key) => {
                        const isManualOnly = MANUAL_ONLY_THRESHOLDS.includes(key);
                        return (
                          <tr key={key}>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontWeight: "600", color: "var(--text-main)" }}>
                                  {formatLabel(key)}
                                </span>
                                {isManualOnly && (
                                  <span style={{
                                    fontSize: "0.7rem",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    backgroundColor: "rgba(255,180,0,0.15)",
                                    color: "#f0a500",
                                    border: "1px solid rgba(255,180,0,0.3)",
                                    fontWeight: "600",
                                  }}>
                                    MANUAL ONLY
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
                                {thresholdDescription(key)}
                              </div>
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={settings[key]}
                                  onChange={(e) => handleChange(key, e.target.value)}
                                  style={{ flex: 1, accentColor: "var(--primary-color)" }}
                                />
                                <span style={{
                                  fontWeight: "bold",
                                  color: "var(--primary-color)",
                                  minWidth: "45px",
                                  textAlign: "right",
                                }}>
                                  {settings[key].toFixed(2)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
                <button
                  className="btn"
                  style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--glass-border)" }}
                  onClick={fetchSettings}
                  disabled={isSaving}
                >
                  Discard Changes
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Empirical Tuning ──────────────────────────────────────── */}
        <section className="glass-card" style={{ marginTop: "2rem" }}>
          <header className="mb-4">
            <h2 className="page-subtitle" style={{ fontSize: "1.2rem", fontWeight: "600", color: "var(--text-main)" }}>
              Empirical Tuning (Grid Search)
            </h2>
            <p className="page-subtitle" style={{ fontSize: "0.9rem" }}>
              Run an automated sweep over validation chunks to find the optimal threshold for each
              score that maximises F1. <strong>Lexicon, ML, Hybrid,</strong> and <strong>Merger</strong> thresholds
              are all optimised in one pass. The <em>Labeller</em> threshold is excluded — it
              defines ground truth and cannot be grid-searched.
            </p>
          </header>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            <select
              className="form-select"
              style={{ maxWidth: "250px" }}
              value={optimizationModel}
              onChange={(e) => setOptimizationModel(e.target.value)}
            >
              <option value="roberta-base">roberta-base</option>
              <option value="bert-base-uncased">bert-base-uncased</option>
              <option value="answerdotai/ModernBERT-base">answerdotai/ModernBERT-base</option>
              <option value="microsoft/deberta-base">microsoft/deberta-base</option>
            </select>

            <button className="btn btn-primary" onClick={runOptimization} disabled={isOptimizing}>
              {isOptimizing ? "Running Sweep..." : "Run Optimization Sweep"}
            </button>

            {optimizationResults && (
              <button
                className="btn"
                style={{ backgroundColor: "rgba(76,175,80,0.15)", border: "1px solid rgba(76,175,80,0.4)", color: "#4caf50" }}
                onClick={applyAllBest}
              >
                ✓ Apply All Best Values
              </button>
            )}
          </div>

          {/* Results accordion — one card per threshold */}
          {optimizationResults && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {OPTIMIZABLE_THRESHOLDS.map(({ key, label, scoreLabel }) => {
                const data  = optimizationResults[key];
                const best  = data?.best;
                const isOpen = expandedKey === key;

                return (
                  <div
                    key={key}
                    style={{
                      border: "1px solid var(--glass-border)",
                      borderRadius: "10px",
                      overflow: "hidden",
                      backgroundColor: "rgba(255,255,255,0.03)",
                    }}
                  >
                    {/* Accordion header */}
                    <button
                      onClick={() => setExpandedKey(isOpen ? null : key)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.85rem 1.2rem",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-main)",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontWeight: "600", fontSize: "0.95rem" }}>{label}</span>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          score: <code>{scoreLabel}</code>
                        </span>
                        {best && (
                          <span style={{
                            fontSize: "0.8rem",
                            padding: "2px 8px",
                            borderRadius: "20px",
                            backgroundColor: "rgba(76,175,80,0.15)",
                            color: "#4caf50",
                            border: "1px solid rgba(76,175,80,0.3)",
                          }}>
                            Best: {best.threshold.toFixed(2)} (F1 {best.f1.toFixed(2)})
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {best && (
                          <button
                            className="btn"
                            style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                            onClick={(e) => { e.stopPropagation(); applyBest(key); }}
                          >
                            Apply Best
                          </button>
                        )}
                        <span style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
                          {isOpen ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>

                    {/* Accordion body */}
                    {isOpen && data?.results && (
                      <div style={{ padding: "0 1.2rem 1.2rem" }}>
                        <div className="table-container">
                          <table className="table-modern">
                            <thead>
                              <tr>
                                <th style={{ width: "110px" }}>Threshold</th>
                                <th>Precision</th>
                                <th>Recall</th>
                                <th>F1-Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.results.map((row, idx) => (
                                <tr
                                  key={idx}
                                  style={{ backgroundColor: row.is_best ? "rgba(76,175,80,0.08)" : "transparent" }}
                                >
                                  <td style={{
                                    fontWeight: row.is_best ? "bold" : "normal",
                                    color: row.is_best ? "#4caf50" : "inherit",
                                  }}>
                                    {row.threshold.toFixed(2)}
                                    {row.is_best && (
                                      <span style={{ marginLeft: "6px", fontSize: "0.7rem" }}>★</span>
                                    )}
                                  </td>
                                  <td>{row.precision.toFixed(2)}</td>
                                  <td>{row.recall.toFixed(2)}</td>
                                  <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{
                                        width: "35px",
                                        fontWeight: row.is_best ? "bold" : "normal",
                                      }}>
                                        {row.f1.toFixed(2)}
                                      </span>
                                      <div style={{
                                        flex: 1,
                                        backgroundColor: "var(--glass-border)",
                                        height: "8px",
                                        borderRadius: "4px",
                                        overflow: "hidden",
                                      }}>
                                        <div style={{
                                          width: `${row.f1 * 100}%`,
                                          height: "100%",
                                          backgroundColor: row.is_best
                                            ? "#4caf50"
                                            : "rgba(255,255,255,0.25)",
                                          transition: "width 0.3s ease",
                                        }} />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
