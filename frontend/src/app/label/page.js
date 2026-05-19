"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function LabelingDashboard() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [highlightText, setHighlightText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    fetch("/api/list-matches")
      .then(r => r.json())
      .then(d => setAvailableMatches(d.matchIds || []))
      .catch(console.error);
  }, []);

  const loadData = async () => {
    if (!matchId) return;
    setStatusMsg("Loading references...");
    try {
      const res = await fetch(`/api/chunks?matchId=${matchId}`);
      const data = await res.json();
      
      if (res.ok) {
        setChunks(data.chunks || []);
        setHighlightText(data.highlightText || "No highlight transcript provided.");
        setStatusMsg(`Successfully loaded ${data.chunks?.length || 0} chunks.`);
      } else {
        setStatusMsg(data.message || "Error Loading data");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Pipeline Error during fetch.");
    }
  };

  const toggleLabel = (index) => {
    const updated = [...chunks];
    updated[index].label = updated[index].label === 1 ? 0 : 1;
    setChunks(updated);
  };

  const saveLabels = async () => {
    setIsSaving(true);
    setStatusMsg("Saving ground truth labels...");
    try {
      const res = await fetch(`/api/save-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, chunks }),
      });
      const data = await res.json();
      if (res.ok) {
         setStatusMsg("Labels successfully saved and pushed to dataset CSV!");
      } else {
         setStatusMsg("Error saving labels: " + data.message);
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Failed to persist labels.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="app-container" style={{ 
      maxWidth: "1600px", 
      height: "calc(100vh - var(--nav-height) - 4rem)", 
      padding: "1.5rem", 
      gap: "1rem", 
      display: "flex", 
      flexDirection: "column",
      overflow: "hidden"
    }}>
      <header style={{ flexShrink: 0 }}>
        <h1 className="page-title" style={{ fontSize: "2rem", marginBottom: "0.2rem" }}>Data Annotation Center</h1>
        <p className="page-subtitle" style={{ fontSize: "1rem", marginBottom: "0" }}>Manually Label Highlights for RoBERTa Training</p>
      </header>

      {/* Target Selector */}
      <div className="flex-between" style={{ justifyContent: "flex-start", gap: "1rem", flexShrink: 0, marginBottom: "0.2rem" }}>
        <input 
          list="match-options"
          placeholder="Search or Select Match ID" 
          value={matchId} 
          onChange={e => setMatchId(e.target.value)}
          className="form-input"
          style={{ width: "300px" }}
        />
        <datalist id="match-options">
          {availableMatches.map(id => <option key={id} value={id} />)}
        </datalist>
        <button className="btn btn-primary" onClick={loadData}>Load Chunks</button>
        <span className="text-muted" style={{ fontWeight: "500", marginLeft: "1rem" }}>{statusMsg}</span>
      </div>

      <main className="grid-2" style={{ flex: 1, minHeight: 0, gap: "1.5rem", alignItems: "stretch" }}>
        
        {/* Left Side: Main Chunks that need Labeling */}
        <section className="glass-card" style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0, overflow: "hidden" }}>
          <div className="flex-between" style={{ padding: "1.5rem", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
            <h2 className="card-title" style={{ margin: 0 }}>📝 Full Match Chunks</h2>
            <button className="btn btn-primary" disabled={chunks.length === 0 || isSaving} onClick={saveLabels}>
              {isSaving ? "Saving..." : "Save Labels to CSV"}
            </button>
          </div>

          <div style={{ overflowY: "auto", flexGrow: 1, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {chunks.length === 0 ? <p className="text-muted text-center py-4">Enter Match ID to load chunks.</p> : null}
            
            {chunks.map((chk, i) => (
              <div key={i} style={{
                background: chk.label === 1 ? "var(--secondary-glow)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${chk.label === 1 ? "var(--secondary-color)" : "var(--glass-border)"}`,
                borderRadius: "12px",
                padding: "1.2rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                transition: "all 0.2s ease"
              }}>
                <div style={{ paddingRight: "1rem" }}>
                    <div style={{ fontSize: "0.85rem", color: chk.label === 1 ? "var(--text-main)" : "var(--primary-color)", fontWeight: "bold", marginBottom: "0.5rem" }}>
                      {chk.start}s - {chk.end}s
                    </div>
                    <div style={{ lineHeight: "1.5" }}>{chk.text_clean || chk.text_raw}</div>
                </div>
                
                <button 
                  onClick={() => toggleLabel(i)}
                  className={`btn ${chk.label === 1 ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ minWidth: "120px", flexShrink: 0 }}
                >
                  {chk.label === 1 ? "★ Highlight" : "Normal"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Right Side: Ground Truth Highlight Reference */}
        <section className="glass-card" style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
            <h2 className="card-title" style={{ margin: 0 }}>🎥 Highlight Transcript Ref.</h2>
          </div>
          <div style={{
            padding: "1.5rem",
            overflowY: "auto",
            flexGrow: 1,
            fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
            fontSize: "0.95rem",
            lineHeight: "1.7",
            whiteSpace: "pre-wrap",
            color: "#a7f3d0",
            background: "rgba(0,0,0,0.5)",
            boxShadow: "inset 0 2px 10px rgba(0,0,0,0.3)"
          }}>
              {highlightText}
          </div>
        </section>

      </main>
    </div>
  );
}
