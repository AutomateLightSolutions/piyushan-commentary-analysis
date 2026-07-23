"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function DatasetsExplorer() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [datasetType, setDatasetType] = useState("ml"); // "ml" or "lexicon"

  useEffect(() => {
    // Fetch available matches for the selected dataset type
    setMatchId("");
    setRows([]);
    fetch(`/api/dataset-csv?type=${datasetType}`)
      .then(r => r.json())
      .then(d => setAvailableMatches(d.matchIds || []))
      .catch(console.error);
  }, [datasetType]);

  const loadData = async () => {
    if (!matchId) return;
    setStatusMsg("Loading dataset...");
    try {
      const res = await fetch(`/api/dataset-csv?matchId=${matchId}&type=${datasetType}`);
      const data = await res.json();
      
      if (res.ok) {
        setRows(data.rows || []);
        setStatusMsg(`Successfully loaded ${data.rows?.length || 0} rows.`);
      } else {
        setStatusMsg(data.message || "Error Loading data");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("API Error.");
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: "1400px", minHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <header className="mb-4">
        <h1 className="page-title">Dataset Verification Explorer</h1>
        <p className="page-subtitle">Verify imported dataset mappings for ML and Lexicon generation.</p>
      </header>

      {/* Tabs for dataset types */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <button 
          className={`btn ${datasetType === 'ml' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setDatasetType('ml')}
        >
          ML Training Datasets (2s overlap)
        </button>
        <button 
          className={`btn ${datasetType === 'lexicon' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setDatasetType('lexicon')}
        >
          Lexicon Generation Datasets (0.5s overlap)
        </button>
      </div>

      <div className="flex-between mb-4" style={{ justifyContent: "flex-start", gap: "1rem" }}>
        <input 
          list="dataset-options"
          placeholder={`Search ${datasetType.toUpperCase()} Dataset ID`} 
          value={matchId} 
          onChange={e => setMatchId(e.target.value)}
          className="form-input"
          style={{ width: "300px" }}
        />
        <datalist id="dataset-options">
          {availableMatches.map(id => <option key={id} value={id} />)}
        </datalist>
        <button className="btn btn-primary" onClick={loadData}>Load Dataset CSV</button>
        <span className="text-muted" style={{ fontWeight: "500", marginLeft: "1rem" }}>{statusMsg}</span>
      </div>

      <main className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h2 className="card-title" style={{ margin: 0 }}>📊 {datasetType.toUpperCase()} Raw CSV Dataset View</h2>
        </div>
        
        <div className="table-container" style={{ borderRadius: 0, border: "none", flex: 1, overflow: "auto" }}>
          <table className="table-modern">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Text</th>
                <th className="text-primary">Event</th>
                <th className="text-primary">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center text-muted" style={{ padding: "3rem" }}>
                    No CSV data loaded.
                  </td>
                </tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={{ background: (r.event && r.event !== "normal_play") ? "var(--secondary-glow)" : "transparent" }}>
                  <td style={{ width: "100px" }}>{r.start}</td>
                  <td style={{ width: "100px" }}>{r.end}</td>
                  <td>{r.text}</td>
                  <td style={{ width: "150px", fontWeight: "bold", color: (r.event && r.event !== "normal_play") ? "var(--secondary-color)" : "inherit" }}>
                    {r.event || "-"}
                  </td>
                  <td style={{ width: "100px", fontWeight: "bold" }}>
                    {r.score || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
