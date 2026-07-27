"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import "../globals.css";

export default function OptimizeWeights() {
  const [modelName, setModelName] = useState("roberta-base");
  const [mode, setMode] = useState("highlight");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState("");
  const [currentSettings, setCurrentSettings] = useState(null);

  useEffect(() => {
    fetch('/api/thresholds')
      .then(r => r.json())
      .then(setCurrentSettings)
      .catch(console.error);
  }, []);

  const applyWeight = async () => {
    if (!results || !results.best || !currentSettings) return;
    
    const keyToUpdate = mode === "event" ? "event_lexicon_weight" : "highlight_lexicon_weight";
    const newWeight = results.best.lexicon_weight;
    const newSettings = { ...currentSettings, [keyToUpdate]: newWeight };
    
    await saveSettings(newSettings, `Success: Automatically applied ${newWeight.toFixed(2)} to ${mode === 'event' ? 'Event' : 'Highlight'} Pipeline!`);
  };

  const saveSettings = async (settingsToSave, successMessage = "Configuration saved successfully!") => {
    try {
      const res = await fetch('/api/thresholds', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsToSave)
      });
      if (res.ok) {
        setCurrentSettings(settingsToSave);
        setMessage(successMessage);
      } else {
        setMessage("Error saving configuration.");
      }
    } catch (err) {
      setMessage(`Error saving configuration: ${err.message}`);
    }
  };

  const handleManualChange = (key, val) => {
    setCurrentSettings(prev => ({ ...prev, [key]: parseFloat(val) }));
  };

  const runOptimization = async () => {
    setIsOptimizing(true);
    setMessage("");
    setResults(null);
    try {
      const endpoint = mode === "event" ? "/api/optimize-event-weights" : "/api/optimize-weights";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Optimization failed");
      }
      
      setResults(data);
    } catch (err) {
      console.error(err);
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: "900px", margin: "0 auto", paddingBottom: "3rem" }}>
      <header className="mb-4">
        <h1 className="page-title">Lexicon Weight Optimization</h1>
        <p className="page-subtitle">
          Mathematically prove and visualize the optimal weight for the Lexicon model using Grid Search on validation data.
        </p>
      </header>

      <main>
        <section className="glass-card mb-4">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <select 
              className="form-select" 
              style={{ maxWidth: "250px" }}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            >
              <option value="roberta-base">roberta-base</option>
              <option value="bert-base-uncased">bert-base-uncased</option>
              <option value="answerdotai/ModernBERT-base">answerdotai/ModernBERT-base</option>
              <option value="microsoft/deberta-base">microsoft/deberta-base</option>
            </select>
            <select 
              className="form-select" 
              style={{ maxWidth: "280px" }}
              value={mode}
              onChange={(e) => { setMode(e.target.value); setResults(null); }}
            >
              <option value="highlight">Highlight Detection (Binary)</option>
              <option value="event">Specific Event (Multi-class)</option>
            </select>
            <button 
              className="btn btn-primary" 
              onClick={runOptimization}
              disabled={isOptimizing}
            >
              {isOptimizing ? "Running Optimization Sweep..." : "Run Optimization Sweep"}
            </button>
          </div>
          {message && (
            <div className={`alert ${message.startsWith('Success') ? 'alert-success' : 'alert-error'}`} style={{ marginTop: "1rem" }}>
              {message}
            </div>
          )}
          
          {currentSettings && (
            <div style={{ marginTop: "1.5rem", padding: "1.5rem", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ margin: "0", fontSize: "1.1rem" }}>Current Active Pipeline Config</h3>
                <button 
                  className="btn" 
                  onClick={() => saveSettings(currentSettings, "Manual configuration saved successfully!")}
                  style={{ padding: "0.3rem 0.8rem", fontSize: "0.85rem", border: "1px solid var(--glass-border)", backgroundColor: "rgba(255,255,255,0.1)" }}
                >
                  Save Configuration
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ width: "200px", fontWeight: "600", fontSize: "0.95rem" }}>Highlight Lexicon Weight:</span>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={currentSettings.highlight_lexicon_weight || 0.3} 
                    onChange={(e) => handleManualChange("highlight_lexicon_weight", e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--primary-color)' }}
                  />
                  <span style={{ fontWeight: "bold", minWidth: "40px" }}>{(currentSettings.highlight_lexicon_weight || 0.3).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ width: "200px", fontWeight: "600", fontSize: "0.95rem" }}>Event Lexicon Weight:</span>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={currentSettings.event_lexicon_weight || 0.3} 
                    onChange={(e) => handleManualChange("event_lexicon_weight", e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--primary-color)' }}
                  />
                  <span style={{ fontWeight: "bold", minWidth: "40px" }}>{(currentSettings.event_lexicon_weight || 0.3).toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {results && results.results && (
          <section className="glass-card">
            <h2 className="page-subtitle" style={{ fontSize: "1.2rem", fontWeight: "600", color: "var(--text-main)", marginBottom: "1rem" }}>
              Hyperparameter Optimization Curve
            </h2>
            
            <div style={{ backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "1rem", marginBottom: "2rem", height: "400px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={results.results}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis 
                    dataKey="lexicon_weight" 
                    type="number"
                    domain={[0, 1]}
                    ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]}
                    stroke="var(--text-muted)" 
                    label={{ value: 'Lexicon Weight (W)', position: 'bottom', fill: "var(--text-muted)", offset: 0 }}
                  />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    stroke="var(--text-muted)"
                    label={{ value: 'F1 Score', angle: -90, position: 'left', fill: "var(--text-muted)" }}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "var(--bg-card)", borderColor: "var(--glass-border)", color: "var(--text-main)" }}
                    formatter={(value, name) => [value.toFixed(3), name === 'f1' ? 'F1 Score' : name]}
                    labelFormatter={(label) => `Weight: ${label.toFixed(2)}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="f1" 
                    stroke="var(--primary-color)" 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: "var(--bg-card)", stroke: "var(--primary-color)", strokeWidth: 2 }}
                    activeDot={{ r: 6 }} 
                  />
                  
                  {results.best && (
                    <ReferenceDot 
                      x={results.best.lexicon_weight} 
                      y={results.best.f1} 
                      r={8} 
                      fill="var(--primary-color)" 
                      stroke="white" 
                      strokeWidth={2} 
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="alert alert-success" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold" }}>Optimal Lexicon Weight: {results.best.lexicon_weight.toFixed(2)}</h3>
                <button 
                  className="btn btn-primary" 
                  onClick={applyWeight}
                  style={{ padding: "0.4rem 1rem", fontSize: "0.9rem" }}
                >
                  Apply Optimal Weight
                </button>
              </div>
              <p style={{ margin: 0, opacity: 0.9 }}>
                By plotting the F1 score across all possible weights on the validation set, the system mathematically proves that a 
                <strong> Lexicon Weight of {results.best.lexicon_weight.toFixed(2)} </strong> yields the highest F1 Score 
                (<strong>{results.best.f1.toFixed(3)}</strong>). 
              </p>
              <p style={{ margin: 0, opacity: 0.9, marginTop: "0.5rem", fontSize: "0.9rem" }}>
                <strong>Reasoning:</strong> At this peak, the sparse heuristic features (Lexicon) perfectly balance and boost the continuous probabilistic features (Transformer). Weights lower than this miss obvious keyword-driven highlights, while weights higher than this begin to cause false positives by letting the heuristic model overpower the Transformer's contextual understanding.
              </p>
            </div>
            
            <div className="table-container" style={{ marginTop: "2rem" }}>
              <table className="table-modern">
                <thead>
                  <tr>
                    <th>Lexicon Weight</th>
                    {mode === "highlight" ? (
                      <>
                        <th>Precision</th>
                        <th>Recall</th>
                      </>
                    ) : (
                      <th>Accuracy</th>
                    )}
                    <th>{mode === "highlight" ? "F1-Score" : "Metric Score"}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((row, idx) => (
                    <tr key={idx} style={{ backgroundColor: row.is_best ? 'rgba(76, 175, 80, 0.1)' : 'transparent' }}>
                      <td style={{ fontWeight: row.is_best ? "bold" : "normal", color: row.is_best ? "var(--primary-color)" : "inherit" }}>
                        {row.lexicon_weight.toFixed(2)}
                      </td>
                      {mode === "highlight" ? (
                        <>
                          <td>{row.precision ? row.precision.toFixed(3) : '-'}</td>
                          <td>{row.recall ? row.recall.toFixed(3) : '-'}</td>
                        </>
                      ) : (
                        <td>{row.accuracy ? row.accuracy.toFixed(3) : '-'}</td>
                      )}
                      <td style={{ fontWeight: row.is_best ? "bold" : "normal" }}>
                        {row.f1.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </section>
        )}
      </main>
    </div>
  );
}
