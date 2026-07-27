"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function ManageThresholds() {
  const [settings, setSettings] = useState({
    lexicon_threshold: 0.10,
    ml_threshold: 0.55,
    hybrid_threshold: 0.40,
    merger_threshold: 0.40,
    labeller_threshold: 0.40
  });
  
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResults, setOptimizationResults] = useState(null);
  const [optimizationModel, setOptimizationModel] = useState("roberta-base");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/thresholds");
      if (!res.ok) throw new Error("Failed to load thresholds");
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error(err);
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
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
    try {
      const res = await fetch("/api/optimize-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName: optimizationModel, scoreKey: "hybrid_score" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Optimization failed");
      setOptimizationResults(data);
    } catch (err) {
      setMessage(`Optimization Error: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const applyOptimal = () => {
    if (optimizationResults?.best) {
      handleChange("hybrid_threshold", optimizationResults.best.threshold);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: parseFloat(value)
    }));
  };

  const formatLabel = (key) => {
    return key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="app-container" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <header className="mb-4">
        <h1 className="page-title">Manage Thresholds</h1>
        <p className="page-subtitle">Configure the core parameters of the evaluation and highlight generation pipeline.</p>
      </header>

      <main>
        <section className="glass-card">
          {message && (
            <div className={`alert ${message.startsWith("Error") ? 'alert-error' : 'alert-success'}`}>
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
                    {Object.keys(settings).filter(key => !key.endsWith('_weight')).map((key) => (
                      <tr key={key}>
                        <td>
                          <div style={{ fontWeight: "600", color: "var(--text-main)" }}>
                            {formatLabel(key)}
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
                            {key === 'lexicon_threshold' && 'Evaluation cutoff score for Lexicon matches.'}
                            {key === 'ml_threshold' && 'Evaluation cutoff score for ML Model probabilities.'}
                            {key === 'hybrid_threshold' && 'Evaluation cutoff score for combined Hybrid logic.'}
                            {key === 'merger_threshold' && 'Score required to include a text chunk in final highlight video clip.'}
                            {key === 'labeller_threshold' && 'Overlap ratio required to map ground truth video timestamp to text chunks.'}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <input 
                              type="range" 
                              min="0" 
                              max="1" 
                              step="0.01" 
                              value={settings[key]} 
                              onChange={(e) => handleChange(key, e.target.value)}
                              style={{ flex: 1, accentColor: 'var(--primary-color)' }}
                            />
                            <span style={{ 
                                fontWeight: "bold", 
                                color: "var(--primary-color)", 
                                minWidth: "45px", 
                                textAlign: "right" 
                            }}>
                              {settings[key].toFixed(2)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
                <button 
                  className="btn" 
                  style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}
                  onClick={fetchSettings}
                  disabled={isSaving}
                >
                  Discard Changes
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={handleSave} 
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Configuration"}
                </button>
              </div>

            </div>
          )}
        </section>

        <section className="glass-card" style={{ marginTop: "2rem" }}>
          <header className="mb-4">
            <h2 className="page-subtitle" style={{ fontSize: "1.2rem", fontWeight: "600", color: "var(--text-main)" }}>
              Empirical Tuning (Grid Search)
            </h2>
            <p className="page-subtitle" style={{ fontSize: "0.9rem" }}>
              Run an automated evaluation sweep over the validation chunks to find the mathematically optimal Hybrid Threshold that maximizes the F1-Score.
            </p>
          </header>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
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
             <button 
                className="btn btn-primary" 
                onClick={runOptimization}
                disabled={isOptimizing}
             >
                {isOptimizing ? "Running Sweep..." : "Run Optimization Sweep"}
             </button>
          </div>

          {optimizationResults && optimizationResults.results && (
             <div className="table-container">
                <table className="table-modern">
                  <thead>
                    <tr>
                      <th style={{ width: "100px" }}>Threshold</th>
                      <th>Precision</th>
                      <th>Recall</th>
                      <th>F1-Score</th>
                      <th style={{ width: "150px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimizationResults.results.map((row, idx) => (
                      <tr key={idx} style={{ backgroundColor: row.is_best ? 'rgba(76, 175, 80, 0.1)' : 'transparent' }}>
                        <td style={{ fontWeight: row.is_best ? "bold" : "normal", color: row.is_best ? "var(--primary-color)" : "inherit" }}>
                          {row.threshold.toFixed(2)}
                        </td>
                        <td>{row.precision.toFixed(2)}</td>
                        <td>{row.recall.toFixed(2)}</td>
                        <td style={{ fontWeight: row.is_best ? "bold" : "normal" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ width: "35px" }}>{row.f1.toFixed(2)}</span>
                            <div style={{ flex: 1, backgroundColor: "var(--glass-border)", height: "8px", borderRadius: "4px", overflow: "hidden" }}>
                               <div style={{ width: `${row.f1 * 100}%`, height: "100%", backgroundColor: row.is_best ? "var(--primary-color)" : "rgba(255,255,255,0.3)" }}></div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                           {row.is_best && (
                              <button className="btn" style={{ fontSize: "0.8rem", padding: "4px 8px" }} onClick={applyOptimal}>
                                Apply Best
                              </button>
                           )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          )}
        </section>
      </main>
    </div>
  );
}
