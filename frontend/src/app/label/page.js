"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
    <div className="app-container" style={{maxWidth: "1600px", height: "95vh"}}>
      <header className="flex-between">
        <div>
          <h1 style={{fontSize: "2rem", textAlign: "left"}}>Data Annotation Center</h1>
          <p className="subtitle" style={{textAlign: "left", marginBottom: 0}}>Manually Label Highlights for RoBERTa Training</p>
        </div>
        <Link href="/" style={{color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold"}}>
          ← Back to Hub
        </Link>
      </header>

      {/* Target Selector */}
      <div style={{display: "flex", gap: "1rem", alignItems: "center"}}>
        <input 
          list="match-options"
          placeholder="Search or Select Match ID" 
          value={matchId} 
          onChange={e => setMatchId(e.target.value)}
          style={{padding: "0.8rem", borderRadius:"8px", border:"1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", width: "300px"}}
        />
        <datalist id="match-options">
          {availableMatches.map(id => <option key={id} value={id} />)}
        </datalist>
        <button className="btn" style={{width: "auto", margin: 0}} onClick={loadData}>Load Chunks</button>
        <span style={{color: "var(--text-muted)"}}>{statusMsg}</span>
      </div>

      <main style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", height: "calc(100% - 140px)"}}>
        
        {/* Left Side: Main Chunks that need Labeling */}
        <section className="glass-card" style={{display: "flex", flexDirection: "column", height: "100%", overflow: "hidden"}}>
          <div className="flex-between" style={{marginBottom: "1rem"}}>
            <h2 className="card-title" style={{margin: 0}}>📝 Full Match Chunks</h2>
            <button className="btn" style={{width: "auto", margin: 0, padding: "0.5rem 1rem"}} disabled={chunks.length===0 || isSaving} onClick={saveLabels}>
              {isSaving ? "Saving..." : "Save Labels to CSV"}
            </button>
          </div>

          <div style={{overflowY: "auto", flexGrow: 1, paddingRight: "1rem", display: "flex", flexDirection: "column", gap: "0.8rem"}}>
            {chunks.length === 0 ? <p style={{color: "var(--text-muted)"}}>Enter Match ID to load chunks.</p> : null}
            
            {chunks.map((chk, i) => (
              <div key={i} style={{
                background: chk.label === 1 ? "rgba(236, 72, 153, 0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${chk.label === 1 ? "var(--secondary-color)" : "transparent"}`,
                borderRadius: "8px",
                padding: "1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div>
                    <div style={{fontSize: "0.85rem", color: "var(--primary-color)", fontWeight: "bold"}}>{chk.start}s - {chk.end}s</div>
                    <div style={{marginTop: "0.5rem"}}>{chk.text_clean || chk.text_raw}</div>
                </div>
                
                <button 
                  onClick={() => toggleLabel(i)}
                  style={{
                    background: chk.label === 1 ? "var(--secondary-color)" : "rgba(0,0,0,0.5)",
                    border: "none",
                    color: "white",
                    padding: "0.6rem 1rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                >
                  {chk.label === 1 ? "★ Highlight" : "Normal"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Right Side: Ground Truth Highlight Reference */}
        <section className="glass-card" style={{display: "flex", flexDirection: "column", height: "100%", overflow: "hidden"}}>
            <h2 className="card-title">🎥 Highlight Transcript Ref.</h2>
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--glass-border)",
              borderRadius: "12px",
              padding: "1.5rem",
              overflowY: "auto",
              flexGrow: 1,
              fontFamily: "monospace",
              fontSize: "0.95rem",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              color: "#a7f3d0"
            }}>
                {highlightText}
            </div>
        </section>

      </main>
    </div>
  );
}
