"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function DatasetsExplorer() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [datasetType, setDatasetType] = useState("ml"); // "ml" or "lexicon"
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [definedEvents, setDefinedEvents] = useState([]);

  useEffect(() => {
    // Fetch events once
    fetch("/api/events")
      .then(r => r.json())
      .then(d => {
        let evts = d.events || [];
        if (!evts.includes("normal_play")) evts.push("normal_play");
        setDefinedEvents(evts);
      })
      .catch(console.error);

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

  const handleRowChange = (index, field, value) => {
    const updatedRows = [...rows];
    updatedRows[index] = { ...updatedRows[index], [field]: value };
    setRows(updatedRows);
  };

  const saveChanges = async () => {
    if (!matchId || rows.length === 0) return;
    setStatusMsg("Saving changes...");
    try {
      const res = await fetch("/api/dataset-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, type: datasetType, rows })
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg("Successfully saved changes.");
      } else {
        setStatusMsg(data.message || "Error saving data");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("API Error while saving.");
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

      <div className="flex-between mb-4" style={{ justifyContent: "flex-start", gap: "1rem", position: "relative" }}>
        <div style={{ position: "relative" }}>
          <input 
            placeholder={`Search ${datasetType.toUpperCase()} Dataset ID`} 
            value={matchId} 
            onChange={e => {
              setMatchId(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIsDropdownOpen(true);
              }
            }}
            className="form-input"
            style={{ width: "300px", paddingRight: "2.5rem" }}
          />
          <div 
            style={{
              position: "absolute",
              right: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          {isDropdownOpen && availableMatches.length > 0 && (
            <ul style={{
              position: "absolute",
              top: "100%",
              left: 0,
              width: "100%",
              maxHeight: "200px",
              overflowY: "auto",
              background: "var(--glass-bg)",
              backdropFilter: "blur(12px)",
              border: "1px solid var(--glass-border)",
              borderRadius: "0 0 8px 8px",
              listStyle: "none",
              padding: 0,
              margin: 0,
              zIndex: 10,
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
            }}>
              {availableMatches
                .filter(id => id.toLowerCase().includes(matchId.toLowerCase()))
                .map(id => (
                  <li 
                    key={id}
                    onClick={() => {
                      setMatchId(id);
                      setIsDropdownOpen(false);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                    onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                    onMouseOut={e => e.currentTarget.style.background = "transparent"}
                  >
                    {id}
                  </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn btn-primary" onClick={loadData}>Load Dataset CSV</button>
        <button className="btn btn-secondary" onClick={saveChanges} disabled={rows.length === 0}>Save Changes</button>
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
                    <select
                      value={r.event || "normal_play"}
                      onChange={(e) => handleRowChange(i, "event", e.target.value)}
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "inherit",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        width: "100%"
                      }}
                    >
                      {definedEvents.map(evt => (
                        <option key={evt} value={evt}>{evt}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ width: "100px", fontWeight: "bold" }}>
                    <input
                      type="number"
                      step="0.0001"
                      value={r.score || ""}
                      onChange={(e) => handleRowChange(i, "score", e.target.value)}
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "inherit",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        width: "100%"
                      }}
                    />
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
