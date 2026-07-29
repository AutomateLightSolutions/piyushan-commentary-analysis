"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function LabelingDashboard() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [file, setFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    fetch("/api/list-matches")
      .then(r => r.json())
      .then(d => setAvailableMatches(d.matchIds || []))
      .catch(console.error);
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const importLabels = async () => {
    if (!matchId || !file) {
      setStatusMsg("Please select a match and a CSV file.");
      return;
    }

    setIsImporting(true);
    setStatusMsg("Importing dataset and generating chunks...");

    const formData = new FormData();
    formData.append("matchId", matchId);
    formData.append("file", file);

    try {
      const res = await fetch(`/api/import-labels`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg("✅ " + data.message);
      } else {
        setStatusMsg("❌ Error: " + data.message + (data.error ? " - " + data.error : ""));
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("❌ Failed to import labels due to network/server error.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="app-container" style={{ 
      maxWidth: "800px", 
      margin: "0 auto",
      padding: "2rem", 
      gap: "1.5rem", 
      display: "flex", 
      flexDirection: "column"
    }}>
      <header>
        <h1 className="page-title" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Dataset Import Center</h1>
        <p className="page-subtitle" style={{ fontSize: "1rem" }}>
          Upload a pre-labeled CSV to map labels to ML (2s overlap) and Lexicon (0.5s overlap) datasets.
        </p>
      </header>

      <section className="glass-card" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        
        <div>
          <label className="text-muted" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Select Match ID</label>
          <input 
            list="match-options"
            placeholder="Search or Select Match ID" 
            value={matchId} 
            onChange={e => setMatchId(e.target.value)}
            className="form-input"
            style={{ width: "100%", padding: "0.8rem" }}
          />
          <datalist id="match-options">
            {availableMatches.map(id => <option key={id} value={id} />)}
          </datalist>
        </div>

        <div>
          <label className="text-muted" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Upload Dataset CSV</label>
          <input 
            type="file" 
            accept=".csv"
            onChange={handleFileChange}
            className="form-input"
            style={{ width: "100%", padding: "0.8rem" }}
          />
          <p className="text-muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            CSV must contain headers: <code>t_start</code>, <code>t_end</code>, <code>event_class</code>, <code>highlight_score</code>
          </p>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={importLabels}
          disabled={isImporting || !matchId || !file}
          style={{ padding: "1rem", fontSize: "1.1rem", marginTop: "1rem" }}
        >
          {isImporting ? "Importing & Processing..." : "Import Labels"}
        </button>

        {statusMsg && (
          <div style={{ 
            marginTop: "1rem", 
            padding: "1rem", 
            borderRadius: "8px",
            background: statusMsg.includes("✅") ? "rgba(16, 185, 129, 0.1)" : (statusMsg.includes("❌") ? "rgba(239, 68, 68, 0.1)" : "rgba(255,255,255,0.05)"),
            color: statusMsg.includes("✅") ? "#34d399" : (statusMsg.includes("❌") ? "#f87171" : "var(--text-main)"),
            border: `1px solid ${statusMsg.includes("✅") ? "#34d399" : (statusMsg.includes("❌") ? "#f87171" : "var(--glass-border)")}`
          }}>
            {statusMsg}
          </div>
        )}

      </section>
    </div>
  );
}
