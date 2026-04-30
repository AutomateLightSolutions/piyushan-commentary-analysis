"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import "../globals.css";

export default function ManageMatches() {
  const [matchIds, setMatchIds] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [deleteDatasets, setDeleteDatasets] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isFetching, setIsFetching] = useState(true);

  const fetchMatches = async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/manage-matches");
      if (!res.ok) throw new Error("Failed to fetch matches");
      const data = await res.json();
      setMatchIds(data.matchIds);
      if (data.matchIds.length > 0) {
        setSelectedMatchId(data.matchIds[0]);
      } else {
        setSelectedMatchId("");
      }
    } catch (err) {
      console.error(err);
      setMessage(`Error fetching matches: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchMatches();
  }, []);

  const handleDelete = async () => {
    if (!selectedMatchId) return;
    
    if (!confirm(`Are you sure you want to delete data for "${selectedMatchId}"? This action cannot be undone.`)) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/manage-matches?matchId=${encodeURIComponent(selectedMatchId)}&deleteDatasets=${deleteDatasets}`, {
        method: "DELETE"
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || "Failed to delete files");
      }
      
      setMessage(`Successfully deleted ${data.deletedCount} file(s) for "${selectedMatchId}".`);
      await fetchMatches(); // Refresh list
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem" }}>
      <header className="flex-between" style={{ marginBottom: "2rem", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Manage Matches</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>Delete raw files, chunks, and datasets</p>
        </div>
        <Link href="/" style={{ color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold" }}>
          ← Back to Pipeline
        </Link>
      </header>

      <main>
        <section className="glass-card" style={{ padding: "2rem" }}>
          {message && (
            <div style={{
              padding: "1rem", 
              marginBottom: "1.5rem", 
              borderRadius: "8px", 
              background: message.startsWith("Error:") ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)",
              border: `1px solid ${message.startsWith("Error:") ? "#ef4444" : "#10b981"}`,
              color: "white"
            }}>
              {message}
            </div>
          )}

          {isFetching ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem 0" }}>
              Loading matches...
            </div>
          ) : matchIds.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem 0" }}>
              No matches found in the system.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Select Match Identifier</label>
                <select 
                  value={selectedMatchId} 
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                  style={{ 
                    width: "100%", 
                    padding: "0.8rem", 
                    borderRadius: "8px", 
                    border: "1px solid var(--glass-border)", 
                    background: "rgba(0,0,0,0.3)", 
                    color: "white",
                    fontFamily: "inherit"
                  }}
                >
                  {matchIds.map(id => (
                    <option key={id} value={id} style={{ background: "#1e1e1e" }}>{id}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input 
                  type="checkbox" 
                  id="deleteDatasets" 
                  checked={deleteDatasets} 
                  onChange={(e) => setDeleteDatasets(e.target.checked)} 
                  style={{ width: "1.2rem", height: "1.2rem", cursor: "pointer", accentColor: "var(--primary-color)" }}
                />
                <label htmlFor="deleteDatasets" style={{ color: "white", cursor: "pointer", userSelect: "none" }}>
                  Also delete generated Dataset CSVs for this match
                </label>
              </div>

              <div style={{ marginTop: "1rem" }}>
                <button 
                  className="btn" 
                  onClick={handleDelete} 
                  disabled={isLoading || !selectedMatchId}
                  style={{
                    background: "#ef4444",
                    boxShadow: "0 4px 15px rgba(239, 68, 68, 0.3)",
                    border: "1px solid rgba(239, 68, 68, 0.5)",
                    transition: "all 0.3s ease",
                    opacity: (isLoading || !selectedMatchId) ? 0.6 : 1
                  }}
                  onMouseOver={(e) => {
                    if(!isLoading && selectedMatchId) {
                      e.target.style.background = "#dc2626";
                      e.target.style.transform = "translateY(-1px)";
                    }
                  }}
                  onMouseOut={(e) => {
                    if(!isLoading && selectedMatchId) {
                      e.target.style.background = "#ef4444";
                      e.target.style.transform = "translateY(0)";
                    }
                  }}
                >
                  {isLoading ? "Deleting..." : "🗑️ Delete Selected Match"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
