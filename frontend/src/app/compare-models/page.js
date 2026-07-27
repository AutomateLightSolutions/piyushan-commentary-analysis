"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function CompareModels() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("detailed");

  const formatModelName = (name) => {
    switch (name) {
      case "roberta-base": return "Roberta";
      case "microsoft/deberta-base": return "DeBERTa";
      case "answerdotai/ModernBERT-base": return "ModernBERT";
      case "bert-base-uncased": return "BERT";
      default: return name;
    }
  };

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

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this evaluation run?")) return;
    try {
      const res = await fetch("/api/metrics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        setMetrics(prev => prev.filter(m => m.id !== id));
      } else {
        const error = await res.json();
        alert(`Failed to delete: ${error.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Failed to delete", err);
      alert("Failed to delete record.");
    }
  };

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

  const calculateAverageMetrics = (modelMetrics) => {
    if (!modelMetrics || modelMetrics.length === 0) return { p: "0.00", r: "0.00", f1: "0.00" };
    const sums = modelMetrics.reduce((acc, m) => {
      const metric = m.metrics?.Classification?.["ML Model Only"] || {};
      return {
        p: acc.p + (metric.precision || 0),
        r: acc.r + (metric.recall || 0),
        f1: acc.f1 + (metric.f1 || 0)
      };
    }, { p: 0, r: 0, f1: 0 });
    
    return {
      p: (sums.p / modelMetrics.length).toFixed(2),
      r: (sums.r / modelMetrics.length).toFixed(2),
      f1: (sums.f1 / modelMetrics.length).toFixed(2)
    };
  };

  const groupedMetrics = groupMetricsByModel();

  const getMacroAverages = () => {
    const groups = {};
    metrics.forEach(m => {
      const key = `${m.model_used}_${m.training_round}_${m.evaluation_round || 1}`;
      if (!groups[key]) {
        groups[key] = {
          model_used: m.model_used,
          training_round: m.training_round,
          evaluation_round: m.evaluation_round || 1,
          timestamp: m.timestamp,
          count: 0,
          totals: {
            Classification: {
              "Lexicon Only": { p: 0, r: 0, f1: 0 },
              "ML Model Only": { p: 0, r: 0, f1: 0 },
              "Hybrid Model": { p: 0, r: 0, f1: 0 },
              "Specific Event (Multi-class)": { p: 0, r: 0, f1: 0 }
            },
            Regression: {
              "Lexicon Only": { mse: 0, mae: 0 },
              "ML Model Only": { mse: 0, mae: 0 },
              "Hybrid Model": { mse: 0, mae: 0 }
            }
          }
        };
      }
      groups[key].count += 1;
      if (new Date(m.timestamp) > new Date(groups[key].timestamp)) {
        groups[key].timestamp = m.timestamp;
      }
      
      const approaches = ["Lexicon Only", "ML Model Only", "Hybrid Model", "Specific Event (Multi-class)"];
      approaches.forEach(app => {
        if (m.metrics?.Classification?.[app]) {
          groups[key].totals.Classification[app].p += (m.metrics.Classification[app].precision || 0);
          groups[key].totals.Classification[app].r += (m.metrics.Classification[app].recall || 0);
          groups[key].totals.Classification[app].f1 += (m.metrics.Classification[app].f1 || 0);
        }
        if (app !== "Specific Event (Multi-class)" && m.metrics?.Regression?.[app]) {
          groups[key].totals.Regression[app].mse += (m.metrics.Regression[app].mse || 0);
          groups[key].totals.Regression[app].mae += (m.metrics.Regression[app].mae || 0);
        }
      });
    });

    return Object.values(groups).map(g => {
      const avg = {
        model_used: g.model_used,
        training_round: g.training_round,
        evaluation_round: g.evaluation_round,
        timestamp: g.timestamp,
        count: g.count,
        metrics: { Classification: {}, Regression: {} }
      };
      const approaches = ["Lexicon Only", "ML Model Only", "Hybrid Model", "Specific Event (Multi-class)"];
      approaches.forEach(app => {
        avg.metrics.Classification[app] = {
          precision: g.totals.Classification[app].p / g.count,
          recall: g.totals.Classification[app].r / g.count,
          f1: g.totals.Classification[app].f1 / g.count
        };
        if (app !== "Specific Event (Multi-class)") {
          avg.metrics.Regression[app] = {
            mse: g.totals.Regression[app].mse / g.count,
            mae: g.totals.Regression[app].mae / g.count
          };
        }
      });
      return avg;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  const macroAverages = getMacroAverages();

  const [filterModel, setFilterModel] = useState("All");
  const [filterTrainRound, setFilterTrainRound] = useState("All");
  const [filterEvalRound, setFilterEvalRound] = useState("All");
  const [filterMatchName, setFilterMatchName] = useState("All");

  const uniqueModels = ["All", ...new Set(metrics.map(m => m.model_used))];
  const uniqueTrainRounds = ["All", ...new Set(metrics.map(m => m.training_round))].sort();
  const uniqueEvalRounds = ["All", ...new Set(metrics.map(m => m.evaluation_round || 1))].sort();
  const uniqueMatchNames = ["All", ...new Set(metrics.map(m => m.match_id))];

  const filteredMetrics = metrics.filter(m => {
    if (filterModel !== "All" && m.model_used !== filterModel) return false;
    if (filterTrainRound !== "All" && m.training_round.toString() !== filterTrainRound.toString()) return false;
    if (filterEvalRound !== "All" && (m.evaluation_round || 1).toString() !== filterEvalRound.toString()) return false;
    if (filterMatchName !== "All" && m.match_id !== filterMatchName) return false;
    return true;
  });

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
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column"
                }}>
                  <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>{formatModelName(model)}</h3>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                    {groupedMetrics[model].length} Run(s)
                  </div>
                  {(() => {
                    const avg = calculateAverageMetrics(groupedMetrics[model]);
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", alignItems: "start", marginTop: "auto" }}>
                        <div>
                          <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--primary-color)" || "#3b82f6" }}>
                            {avg.p}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.2 }}>Avg Precision</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--secondary-color)" || "#a855f7" }}>
                            {avg.r}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.2 }}>Avg Recall</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--success-color)", textShadow: "0 0 10px rgba(16,185,129,0.3)" }}>
                            {avg.f1}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.2 }}>Avg F1</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </section>

          {/* Detailed Runs and Macro-Averages */}
          <section className="glass-card" style={{ gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 className="card-title" style={{ margin: 0 }}>📋 Evaluation Runs</h2>
              <div className="tabs-container" style={{ margin: 0, padding: 0, background: "transparent", border: "none" }}>
                <button 
                  className={`tab-btn ${activeTab === 'detailed' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('detailed')}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
                >
                  Detailed Runs
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'macro' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('macro')}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
                >
                  Macro-Averaged Results
                </button>
              </div>
            </div>
            
            {activeTab === "detailed" ? (
              <>
                {/* Filter UI */}
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", padding: "1rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label className="form-label" style={{ fontSize: "0.85rem" }}>Model Used</label>
                <select className="form-input" style={{ padding: "0.5rem" }} value={filterModel} onChange={e => setFilterModel(e.target.value)}>
                  {uniqueModels.map(u => <option key={u} value={u}>{u === "All" ? "All" : formatModelName(u)}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label className="form-label" style={{ fontSize: "0.85rem" }}>Match Name</label>
                <select className="form-input" style={{ padding: "0.5rem" }} value={filterMatchName} onChange={e => setFilterMatchName(e.target.value)}>
                  {uniqueMatchNames.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label className="form-label" style={{ fontSize: "0.85rem" }}>Training Round</label>
                <select className="form-input" style={{ padding: "0.5rem" }} value={filterTrainRound} onChange={e => setFilterTrainRound(e.target.value)}>
                  {uniqueTrainRounds.map(u => <option key={u} value={u}>{u === "All" ? "All" : `Round ${u}`}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label className="form-label" style={{ fontSize: "0.85rem" }}>Eval Round</label>
                <select className="form-input" style={{ padding: "0.5rem" }} value={filterEvalRound} onChange={e => setFilterEvalRound(e.target.value)}>
                  {uniqueEvalRounds.map(u => <option key={u} value={u}>{u === "All" ? "All" : `Eval ${u}`}</option>)}
                </select>
              </div>
            </div>

            <div className="table-container" style={{ overflowX: "auto" }}>
              <table className="table-modern" style={{ minWidth: "1000px" }}>
                <thead>
                  <tr>
                    <th>Match Base Name</th>
                    <th>Dataset</th>
                    <th>Model Used</th>
                    <th>Training Round</th>
                    <th>Eval Round</th>
                    <th className="text-primary">Lexicon Metrics</th>
                    <th className="text-secondary">Model Metrics</th>
                    <th style={{ color: "var(--success-color)" }}>Hybrid Metrics</th>
                    <th>Timestamp</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMetrics.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ textAlign: "center", padding: "2rem" }}>No metrics match the selected filters.</td>
                    </tr>
                  ) : [...filteredMetrics].reverse().map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: "600" }}>{m.match_id}</td>
                      <td>{m.dataset_name}</td>
                      <td><span style={{ 
                        background: "rgba(59, 130, 246, 0.2)", 
                        color: "#93c5fd",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.85rem"
                      }}>{formatModelName(m.model_used)}</span></td>
                      <td>Round {m.training_round}</td>
                      <td>Eval {m.evaluation_round || 1}</td>
                      <td>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px", whiteSpace: "nowrap" }}>
                          P: {m.metrics?.Classification?.["Lexicon Only"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["Lexicon Only"]?.recall?.toFixed(2) || "0.00"}
                        </div>
                        <div style={{ fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["Lexicon Only"]?.f1?.toFixed(2) || "0.00"}</div>
                        <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["Lexicon Only"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["Lexicon Only"]?.mae?.toFixed(4) || "0.0000"}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px", whiteSpace: "nowrap" }}>
                          P: {m.metrics?.Classification?.["ML Model Only"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["ML Model Only"]?.recall?.toFixed(2) || "0.00"}
                        </div>
                        <div style={{ fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["ML Model Only"]?.f1?.toFixed(2) || "0.00"}</div>
                        <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["ML Model Only"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["ML Model Only"]?.mae?.toFixed(4) || "0.0000"}</div>
                      </td>
                      <td style={{ color: "var(--success-color)" }}>
                        <div style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px", whiteSpace: "nowrap" }}>
                          P: {m.metrics?.Classification?.["Hybrid Model"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["Hybrid Model"]?.recall?.toFixed(2) || "0.00"}
                        </div>
                        <div style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["Hybrid Model"]?.f1?.toFixed(2) || "0.00"}</div>
                        <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["Hybrid Model"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["Hybrid Model"]?.mae?.toFixed(4) || "0.0000"}</div>
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {new Date(m.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <button 
                          onClick={() => handleDelete(m.id)}
                          style={{
                            background: "rgba(239, 68, 68, 0.2)",
                            color: "#f87171",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                            padding: "0.3rem 0.6rem",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            transition: "all 0.2s"
                          }}
                          onMouseOver={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.4)"; }}
                          onMouseOut={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)"; }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              </>
            ) : (
              <div className="table-container" style={{ overflowX: "auto" }}>
                <table className="table-modern" style={{ minWidth: "1000px" }}>
                  <thead>
                    <tr>
                      <th>Model Used</th>
                      <th>Datasets Count</th>
                      <th>Training Round</th>
                      <th>Eval Round</th>
                      <th className="text-primary">Lexicon Metrics</th>
                      <th className="text-secondary">Model Metrics</th>
                      <th style={{ color: "var(--success-color)" }}>Hybrid Metrics</th>
                      <th>Latest Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macroAverages.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ textAlign: "center", padding: "2rem" }}>No macro-averaged metrics available.</td>
                      </tr>
                    ) : macroAverages.map((m, idx) => (
                      <tr key={idx}>
                        <td><span style={{ 
                          background: "rgba(59, 130, 246, 0.2)", 
                          color: "#93c5fd",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.85rem"
                        }}>{formatModelName(m.model_used)}</span></td>
                        <td>{m.count} dataset(s)</td>
                        <td>Round {m.training_round}</td>
                        <td>Eval {m.evaluation_round}</td>
                        <td>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px", whiteSpace: "nowrap" }}>
                            P: {m.metrics?.Classification?.["Lexicon Only"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["Lexicon Only"]?.recall?.toFixed(2) || "0.00"}
                          </div>
                          <div style={{ fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["Lexicon Only"]?.f1?.toFixed(2) || "0.00"}</div>
                          <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["Lexicon Only"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["Lexicon Only"]?.mae?.toFixed(4) || "0.0000"}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px", whiteSpace: "nowrap" }}>
                            P: {m.metrics?.Classification?.["ML Model Only"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["ML Model Only"]?.recall?.toFixed(2) || "0.00"}
                          </div>
                          <div style={{ fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["ML Model Only"]?.f1?.toFixed(2) || "0.00"}</div>
                          <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["ML Model Only"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["ML Model Only"]?.mae?.toFixed(4) || "0.0000"}</div>
                        </td>
                        <td style={{ color: "var(--success-color)" }}>
                          <div style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px", whiteSpace: "nowrap" }}>
                            P: {m.metrics?.Classification?.["Hybrid Model"]?.precision?.toFixed(2) || "0.00"} &bull; R: {m.metrics?.Classification?.["Hybrid Model"]?.recall?.toFixed(2) || "0.00"}
                          </div>
                          <div style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "2px" }}>F1: {m.metrics?.Classification?.["Hybrid Model"]?.f1?.toFixed(2) || "0.00"}</div>
                          <div style={{ fontSize: "0.7rem", color: "#fca5a5", opacity: 0.8 }}>MSE: {m.metrics?.Regression?.["Hybrid Model"]?.mse?.toFixed(4) || "0.0000"} &bull; MAE: {m.metrics?.Regression?.["Hybrid Model"]?.mae?.toFixed(4) || "0.0000"}</div>
                        </td>
                        <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          {new Date(m.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
