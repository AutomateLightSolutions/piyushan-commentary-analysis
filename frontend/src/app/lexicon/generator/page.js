"use client";

import { useState, useEffect } from "react";
import "../../globals.css";
import Link from 'next/link';

export default function AutoLexiconGenerator() {
  const [data, setData] = useState({ available_runs: [], current_view: { events: [], sources: [] } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [selectedRun, setSelectedRun] = useState('cumulative');
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState("");

  // Structure: { [eventId]: { weight: 0.1, topN: 30, selectedTerms: Set() } }
  const [configState, setConfigState] = useState({});

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    fetchAutoLexicon(selectedRun);
  }, [selectedRun]);

  const fetchDatasets = async () => {
      try {
          const res = await fetch('/api/run-extraction');
          const data = await res.json();
          if (data.datasets) {
              setDatasets(data.datasets);
              if (data.datasets.length > 0) setSelectedDataset(data.datasets[0]);
          }
      } catch (err) {
          console.error("Failed to fetch datasets", err);
      }
  };

  const handleRunExtraction = async () => {
      if (!selectedDataset) return;
      setExtracting(true);
      setMessage({ type: "", text: "" });
      try {
          const res = await fetch('/api/run-extraction', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataset: selectedDataset })
          });
          const result = await res.json();
          
          if (!res.ok) throw new Error(result.error || "Failed to extract");
          
          setMessage({ type: "success", text: `Successfully extracted keywords from ${result.source}` });
          // Refresh the cumulative view to include the new run
          setSelectedRun('cumulative');
          await fetchAutoLexicon('cumulative');
      } catch (err) {
          console.error(err);
          setMessage({ type: "error", text: `Extraction failed: ${err.message}` });
      } finally {
          setExtracting(false);
      }
  };

  const fetchAutoLexicon = async (runId) => {
    setLoading(true);
    try {
      const url = runId === 'cumulative' ? "/api/auto-lexicon" : `/api/auto-lexicon?run_id=${runId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      const fetchedData = await res.json();
      setData(fetchedData);

      // Initialize config state
      const initialConfig = {};
      fetchedData.current_view.events.forEach(event => {
        const topTerms = event.scores.slice(0, 30).map(s => s.text);
        initialConfig[event.id] = {
          weight: event.default_weight,
          topN: 30,
          selectedTerms: new Set(topTerms) // Select all by default
        };
      });
      setConfigState(initialConfig);
    } catch (err) {
      console.error("Failed to fetch auto lexicon:", err);
      setMessage({ type: "error", text: "Failed to load auto-generated keywords." });
    } finally {
      setLoading(false);
    }
  };

  const deleteRun = async (runId) => {
    if (!confirm("Are you sure you want to delete this historical run? This will remove its keyword frequencies from the cumulative totals.")) return;
    
    try {
      const res = await fetch(`/api/auto-lexicon?run_id=${runId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete");
      setMessage({ type: "success", text: "Successfully Deleted." });
      setSelectedRun('cumulative');
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Error deleting run." });
    }
  };

  const updateTopN = (eventId, newTopN) => {
    const topN = parseInt(newTopN) || 5;
    setConfigState(prev => {
      const event = data.current_view.events.find(e => e.id === eventId);
      if (!event) return prev;
      const topTerms = event.scores.slice(0, topN).map(s => s.text);
      return {
        ...prev,
        [eventId]: { ...prev[eventId], topN, selectedTerms: new Set(topTerms) }
      }
    });
  };

  const toggleTerm = (eventId, termText) => {
    setConfigState(prev => {
      const selected = new Set(prev[eventId].selectedTerms);
      if (selected.has(termText)) {
        selected.delete(termText);
      } else {
        selected.add(termText);
      }
      return {
        ...prev,
        [eventId]: { ...prev[eventId], selectedTerms: selected }
      };
    });
  };

  const handleExport = async () => {
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const lexRes = await fetch("/api/lexicon");
      const currentLexicon = await lexRes.json();
      
      const newCategories = [];

      data.current_view.events.forEach(event => {
        const eventConfig = configState[event.id];
        if (!eventConfig) return;

        const finalTerms = event.scores.filter(s => eventConfig.selectedTerms.has(s.text));

        newCategories.push({
          id: event.id,
          name: event.name,
          weight: eventConfig.weight, // preserved from original
          terms: finalTerms
        });
      });

      const finalCategoryMap = new Map();
      currentLexicon.categories.forEach(cat => finalCategoryMap.set(cat.id, cat));
      newCategories.forEach(cat => finalCategoryMap.set(cat.id, cat));

      const finalConfig = { categories: Array.from(finalCategoryMap.values()) };

      const res = await fetch("/api/lexicon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalConfig),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Successfully exported to lexicon.json!" });
      } else {
        throw new Error("Failed to save");
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Error exporting configuration." });
    } finally {
      setSaving(false);
    }
  };

  const eventsData = data.current_view?.events || [];

  return (
    <div className="app-container">
      <header className="mb-3">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
                <h1 className="page-title">Auto Lexicon Generator</h1>
                <p className="page-subtitle">Review dynamically aggregated keyword frequencies from NLP runs.</p>
            </div>
            <Link href="/lexicon">
                <button className="btn btn-secondary">← Back to Lexicon</button>
            </Link>
        </div>
      </header>

      <div className="glass-card mb-3" style={{ padding: "1.5rem", borderLeft: "4px solid var(--accent-color)" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>⚡ Run New Keyword Extraction</h3>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
              Select a processed match dataset to run the NLP keyword extraction algorithm on it. The keywords will automatically be added to your cumulative totals.
          </p>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <select 
                  className="form-input" 
                  style={{ width: "400px" }}
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  disabled={extracting}
              >
                  {datasets.length === 0 ? (
                      <option value="">No datasets found in data/processed/datasets/lexicon/</option>
                  ) : (
                      datasets.map(ds => <option key={ds} value={ds}>{ds}</option>)
                  )}
              </select>
              <button 
                  className="btn btn-primary" 
                  onClick={handleRunExtraction}
                  disabled={extracting || datasets.length === 0}
                  style={{ background: "var(--accent-color)" }}
              >
                  {extracting ? "Extracting Keywords..." : "Extract Keywords"}
              </button>
          </div>
      </div>

      <div className="glass-card mb-3" style={{ padding: "1.5rem" }}>
         <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
             <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                 <label style={{ fontWeight: "bold" }}>Generation View:</label>
                 <select 
                    className="form-input" 
                    style={{ width: "300px" }}
                    value={selectedRun}
                    onChange={(e) => setSelectedRun(e.target.value)}
                 >
                     <option value="cumulative">Cumulative (All Time Runs)</option>
                     {data.available_runs.map(run => {
                         const d = new Date(run.timestamp);
                         return (
                             <option key={run.run_id} value={run.run_id}>
                                 Run: {d.toLocaleDateString()} {d.toLocaleTimeString()}
                             </option>
                         )
                     })}
                 </select>
             </div>
             {selectedRun !== 'cumulative' && (
                 <button className="btn btn-secondary" style={{ color: "#ff4d4f", borderColor: "#ff4d4f" }} onClick={() => deleteRun(selectedRun)}>
                     🗑️ Delete This Run
                 </button>
             )}
         </div>
         
         <div style={{ background: "rgba(0,0,0,0.2)", padding: "1rem", borderRadius: "8px" }}>
             <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-muted)" }}>Data Sources for Current View:</h4>
             {data.current_view.sources.length === 0 ? (
                 <span style={{ fontStyle: "italic" }}>No sources processed yet.</span>
             ) : (
                 <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                     {data.current_view.sources.map((src, i) => (
                         <span key={i} style={{ background: "var(--accent-color)", color: "white", padding: "0.2rem 0.6rem", borderRadius: "12px", fontSize: "0.85rem" }}>
                             {src.name}
                         </span>
                     ))}
                 </div>
             )}
         </div>
      </div>

      <main style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {loading ? (
           <div className="text-center"><p>Loading frequencies...</p></div>
        ) : eventsData.length === 0 ? (
           <div className="glass-card text-center">
             <p>No keyword frequencies found. Please process matches using the Python data pipeline first.</p>
           </div>
        ) : (
            eventsData.map((event) => {
                const eventConfig = configState[event.id];
                if (!eventConfig) return null;

                const topScores = event.scores.slice(0, eventConfig.topN);

                return (
                    <section key={event.id} className="glass-card">
                        <div className="flex-between mb-3" style={{ borderBottom: "1px solid var(--glass-border)", paddingBottom: "1rem" }}>
                            <h2 className="card-title text-primary" style={{ margin: 0 }}>{event.name}</h2>
                            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                                <div>
                                    <label className="form-label mb-0 mr-2" style={{ marginRight: '0.5rem' }}>Top N:</label>
                                    <input
                                        type="number"
                                        min="5"
                                        max="200"
                                        step="5"
                                        value={eventConfig.topN}
                                        onChange={(e) => updateTopN(event.id, e.target.value)}
                                        className="form-input"
                                        style={{ width: "80px", padding: "0.4rem" }}
                                    />
                                </div>
                            </div>
                        </div>

                        {topScores.length === 0 ? (
                            <p>No keywords extracted for this event yet.</p>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
                                {topScores.map(scoreObj => {
                                    const isSelected = eventConfig.selectedTerms.has(scoreObj.text);
                                    return (
                                        <div 
                                            key={scoreObj.text}
                                            onClick={() => toggleTerm(event.id, scoreObj.text)}
                                            style={{
                                                padding: "0.8rem",
                                                background: isSelected ? "rgba(79, 70, 229, 0.2)" : "rgba(255,255,255,0.05)",
                                                border: isSelected ? "1px solid var(--primary-color)" : "1px solid var(--glass-border)",
                                                borderRadius: "10px",
                                                cursor: "pointer",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center"
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected}
                                                    onChange={() => {}} 
                                                    style={{ cursor: "pointer" }}
                                                />
                                                <span style={{ fontWeight: isSelected ? "bold" : "normal" }}>{scoreObj.text}</span>
                                            </div>
                                            <span style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{scoreObj.weight.toFixed(4)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                )
            })
        )}

        <div className="flex-between glass-card" style={{ position: "sticky", bottom: "1rem", zIndex: 100, background: "rgba(15, 23, 42, 0.95)", padding: "1rem 1.5rem" }}>
          <div>
            {message.text && (
              <div className={`alert ${message.type === "success" ? 'alert-success' : 'alert-error'}`} style={{ margin: 0 }}>
                {message.text}
              </div>
            )}
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleExport} 
            disabled={saving || eventsData.length === 0}
            style={{ padding: "1rem 2rem", fontSize: "1.1rem" }}
          >
            {saving ? "Exporting..." : "Export to Lexicon"}
          </button>
        </div>
      </main>
    </div>
  );
}
