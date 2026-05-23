"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function CompareModels() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics")
      .then(res => res.json())
      .then(data => {
        // Data is expected to be an array of metric records
        setMetrics(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch metrics", err);
        setLoading(false);
      });
  }, []);

  const groupMetricsByModel = () => {
    const grouped = {};
    metrics.forEach(m => {
      if (!grouped[m.model_used]) {
        grouped[m.model_used] = [];
      }
      grouped[m.model_used].push(m);
    });
    return grouped;
  };

  const calculateAverageF1 = (modelMetrics) => {
    if (!modelMetrics || modelMetrics.length === 0) return 0;
    const sum = modelMetrics.reduce((acc, m) => acc + (m.metrics?.["Hybrid Model"]?.f1 || 0), 0);
    return (sum / modelMetrics.length).toFixed(2);
  };

  const groupedMetrics = groupMetricsByModel();

  return (
    <div className="app-container">
      <div className="mb-3">
        <h1 className="page-title">Model Comparison Dashboard</h1>
        <p className="page-subtitle">Compare evaluation metrics across different transformer models and training rounds.</p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem" }}>Loading metrics data...</div>
      ) : metrics.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center" }}>
          No evaluation metrics found. Please run the ML Pipeline first.
        </div>
      ) : (
        <div className="grid-2">
          {/* Automated Comparison Summary */}
          <section className="glass-card" style={{ gridColumn: "1 / -1" }}>
            <h2 className="card-title">🏆 Automated Comparison Summary</h2>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {Object.keys(groupedMetrics).map(model => (
                <div key={model} style={{ 
                  flex: "1 1 200px", 
                  background: "rgba(255,255,255,0.05)", 
                  padding: "1.5rem", 
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  textAlign: "center"
                }}>
                  <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>{model}</h3>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                    {groupedMetrics[model].length} Run(s)
                  </div>
                  <div style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--success-color)", textShadow: "0 0 10px rgba(16,185,129,0.3)" }}>
                    {calculateAverageF1(groupedMetrics[model])}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Avg Hybrid F1</div>
                </div>
              ))}
            </div>
          </section>

          {/* Detailed Runs Table */}
          <section className="glass-card" style={{ gridColumn: "1 / -1" }}>
            <h2 className="card-title">📋 Detailed Evaluation Runs</h2>
            <div className="table-container" style={{ overflowX: "auto" }}>
              <table className="table-modern" style={{ minWidth: "1000px" }}>
                <thead>
                  <tr>
                    <th>Match Base Name</th>
                    <th>Dataset</th>
                    <th>Model Used</th>
                    <th>Training Round</th>
                    <th className="text-primary">Lexicon F1</th>
                    <th className="text-secondary">Model F1</th>
                    <th style={{ color: "var(--success-color)" }}>Hybrid F1</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {[...metrics].reverse().map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: "600" }}>{m.match_id}</td>
                      <td>{m.dataset_name}</td>
                      <td><span style={{ 
                        background: "rgba(59, 130, 246, 0.2)", 
                        color: "#93c5fd",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.85rem"
                      }}>{m.model_used}</span></td>
                      <td>Round {m.training_round}</td>
                      <td>{m.metrics?.["Lexicon Only"]?.f1?.toFixed(2) || "0.00"}</td>
                      <td>{m.metrics?.["ML Model Only"]?.f1?.toFixed(2) || "0.00"}</td>
                      <td style={{ fontWeight: "bold", color: "var(--success-color)" }}>
                        {m.metrics?.["Hybrid Model"]?.f1?.toFixed(2) || "0.00"}
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {new Date(m.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
