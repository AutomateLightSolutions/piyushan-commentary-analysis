"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function DatasetsExplorer() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    fetch("/api/dataset-csv")
      .then(r => r.json())
      .then(d => setAvailableMatches(d.matchIds || []))
      .catch(console.error);
  }, []);

  const loadData = async () => {
    if (!matchId) return;
    setStatusMsg("Loading dataset...");
    try {
      const res = await fetch(`/api/dataset-csv?matchId=${matchId}`);
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
    <div className="app-container" style={{ maxWidth: "1400px", height: "calc(100vh - var(--nav-height) - 4rem)" }}>
      <header className="mb-4">
        <h1 className="page-title">Dataset Verification Explorer</h1>
        <p className="page-subtitle">Verify labeled CSV structure pre-training</p>
      </header>

      <div className="flex-between mb-4" style={{ justifyContent: "flex-start", gap: "1rem" }}>
        <input 
          list="dataset-options"
          placeholder="Search Dataset ID" 
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

      <main className="glass-card" style={{ height: "calc(100% - 160px)", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h2 className="card-title" style={{ margin: 0 }}>📊 Raw CSV Dataset View</h2>
        </div>
        
        <div className="table-container" style={{ borderRadius: 0, border: "none", flexGrow: 1 }}>
          <table className="table-modern">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Text</th>
                <th className="text-primary">Ground Label</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center text-muted" style={{ padding: "3rem" }}>
                    No CSV data loaded.
                  </td>
                </tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={{ background: r.label === "1" ? "var(--secondary-glow)" : "transparent" }}>
                  <td style={{ width: "100px" }}>{r.start}</td>
                  <td style={{ width: "100px" }}>{r.end}</td>
                  <td>{r.text}</td>
                  <td style={{ width: "150px", fontWeight: "bold", color: r.label === "1" ? "var(--secondary-color)" : "inherit" }}>
                    {r.label}
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
