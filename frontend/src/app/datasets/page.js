"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
    <div className="app-container" style={{maxWidth: "1600px", height: "95vh"}}>
      <header className="flex-between">
        <div>
           <h1 style={{fontSize: "2rem", textAlign: "left"}}>Dataset Verification Explorer</h1>
           <p className="subtitle" style={{textAlign: "left", marginBottom: 0}}>Verify labeled CSV structure pre-training</p>
        </div>
        <div style={{display:"flex", gap:"2rem"}}>
            <Link href="/label" style={{color: "var(--secondary-color)", textDecoration: "none", fontWeight: "bold"}}>
            ← Go to Labeling Center
            </Link>
            <Link href="/" style={{color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold"}}>
            ← Back to Hub
            </Link>
        </div>
      </header>

      <div style={{display: "flex", gap: "1rem", alignItems: "center", marginBottom: "2rem"}}>
        <input 
          list="dataset-options"
          placeholder="Search Dataset ID" 
          value={matchId} 
          onChange={e => setMatchId(e.target.value)}
          style={{padding: "0.8rem", borderRadius:"8px", border:"1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", width: "300px"}}
        />
        <datalist id="dataset-options">
          {availableMatches.map(id => <option key={id} value={id} />)}
        </datalist>
        <button className="btn" style={{width: "auto", margin: 0}} onClick={loadData}>Load Dataset CSV</button>
        <span style={{color: "var(--text-muted)"}}>{statusMsg}</span>
      </div>

      <main className="glass-card" style={{height: "calc(100% - 180px)", display: "flex", flexDirection: "column"}}>
        <h2 className="card-title">📊 Raw CSV Dataset View</h2>
        <div style={{overflowY: "auto", flexGrow: 1, border: "1px solid var(--glass-border)", borderRadius: "12px", background: "rgba(0,0,0,0.2)"}}>
          <table style={{width: "100%", borderCollapse: "collapse", textAlign: "left"}}>
            <thead style={{background: "rgba(0,0,0,0.4)", position: "sticky", top: 0, zIndex: 10}}>
              <tr>
                <th style={{padding: "1rem", color: "var(--text-muted)", borderBottom: "1px solid var(--glass-border)"}}>Start</th>
                <th style={{padding: "1rem", color: "var(--text-muted)", borderBottom: "1px solid var(--glass-border)"}}>End</th>
                <th style={{padding: "1rem", color: "var(--text-muted)", borderBottom: "1px solid var(--glass-border)"}}>Text</th>
                <th style={{padding: "1rem", color: "var(--primary-color)", borderBottom: "1px solid var(--glass-border)"}}>Ground Label</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="4" style={{padding: "2rem", textAlign: "center", color: "var(--text-muted)"}}>No CSV data loaded.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={{borderBottom: "1px solid rgba(255,255,255,0.05)", background: r.label === "1" ? "rgba(236, 72, 153, 0.1)" : "transparent"}}>
                  <td style={{padding: "1rem", fontSize: "0.9rem"}}>{r.start}</td>
                  <td style={{padding: "1rem", fontSize: "0.9rem"}}>{r.end}</td>
                  <td style={{padding: "1rem", fontSize: "0.95rem"}}>{r.text}</td>
                  <td style={{padding: "1rem", fontWeight: "bold", color: r.label === "1" ? "var(--secondary-color)" : "white"}}>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
