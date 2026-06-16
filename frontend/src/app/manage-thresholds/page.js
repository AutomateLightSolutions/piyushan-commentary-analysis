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
                    {Object.keys(settings).map((key) => (
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
      </main>
    </div>
  );
}
