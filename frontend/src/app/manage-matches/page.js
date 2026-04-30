"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import "../globals.css";

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function ManageMatches() {
  const [matchIds, setMatchIds] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchFiles, setMatchFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [isFetching, setIsFetching] = useState(true);
  const [isFetchingFiles, setIsFetchingFiles] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  // 1. Fetch available match IDs
  const fetchMatches = async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/manage-matches");
      if (!res.ok) throw new Error("Failed to fetch matches");
      const data = await res.json();
      setMatchIds(data.matchIds);
      if (data.matchIds.length > 0 && !selectedMatchId) {
        setSelectedMatchId(data.matchIds[0]);
      } else if (data.matchIds.length === 0) {
        setSelectedMatchId("");
        setMatchFiles([]);
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

  // 2. Fetch specific files when a match ID is selected
  useEffect(() => {
    const fetchSpecificFiles = async () => {
      if (!selectedMatchId) {
        setMatchFiles([]);
        setSelectedFiles({});
        return;
      }
      setIsFetchingFiles(true);
      try {
        const res = await fetch(`/api/manage-matches?matchId=${encodeURIComponent(selectedMatchId)}`);
        if (!res.ok) throw new Error("Failed to fetch files");
        const data = await res.json();
        setMatchFiles(data.files || []);
        
        // Auto-select everything by default
        const initialSelections = {};
        (data.files || []).forEach(f => {
          initialSelections[f.name] = true;
        });
        setSelectedFiles(initialSelections);
      } catch (err) {
        console.error(err);
      } finally {
        setIsFetchingFiles(false);
      }
    };
    fetchSpecificFiles();
  }, [selectedMatchId]);

  // Handle individual checkbox changes
  const toggleFile = (filename) => {
    setSelectedFiles(prev => ({ ...prev, [filename]: !prev[filename] }));
  };

  // Handle 'Select All' toggle
  const allSelected = matchFiles.length > 0 && matchFiles.every(f => selectedFiles[f.name]);
  const toggleSelectAll = () => {
    const newVal = !allSelected;
    const newSelections = {};
    matchFiles.forEach(f => { newSelections[f.name] = newVal; });
    setSelectedFiles(newSelections);
  };

  // Perform backend deletion
  const handleDelete = async () => {
    const filesToDelete = matchFiles.filter(f => selectedFiles[f.name]);
    if (filesToDelete.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${filesToDelete.length} file(s) for "${selectedMatchId}"?`)) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/manage-matches`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: selectedMatchId,
          filesToDelete: filesToDelete.map(f => ({ name: f.name, category: f.category }))
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || "Failed to delete files");
      }
      
      setMessage(`Successfully deleted ${data.deletedCount} file(s).`);
      
      // Refresh the match list natively
      fetchMatches();
      // Reset selected Match ID so useEffect fetches latest
      if (filesToDelete.length === matchFiles.length) {
         setSelectedMatchId(""); // we deleted everything, force it to fall to the next match
      } else {
         // trigger fetch of remaining files by cheating a state change
         const remaining = matchFiles.filter(f => !selectedFiles[f.name]);
         setMatchFiles(remaining);
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = Object.values(selectedFiles).filter(Boolean).length;

  return (
    <div className="app-container" style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem" }}>
      <header className="flex-between" style={{ marginBottom: "2rem", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Manage Matches</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>Review and delete specific files for any match</p>
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

              {isFetchingFiles ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "1rem" }}>
                  Fetching specific files...
                </div>
              ) : matchFiles.length > 0 ? (
                <>
                  {/* Granular File Table */}
                  <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
                    <div style={{ display: "flex", padding: "1rem", borderBottom: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", fontWeight: "bold" }}>
                       <div style={{ flex: "0 0 40px" }}>
                         <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer", accentColor: "#ef4444" }} title="Select All" />
                       </div>
                       <div style={{ flex: 1 }}>File Type / Path</div>
                       <div style={{ flex: "0 0 100px", textAlign: "right" }}>Size</div>
                    </div>
                    {matchFiles.map(file => (
                      <div key={file.name} style={{ display: "flex", padding: "1rem", borderBottom: "1px solid rgba(255,255,255,0.05)", alignItems: "center" }}>
                        <div style={{ flex: "0 0 40px" }}>
                          <input 
                            type="checkbox" 
                            checked={!!selectedFiles[file.name]} 
                            onChange={() => toggleFile(file.name)} 
                            style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer", accentColor: "var(--primary-color)" }} 
                          />
                        </div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                          <span style={{ fontWeight: "bold", color: "white" }}>{file.type}</span>
                          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontFamily: "'Courier New', monospace" }}>
                            {file.category} / {file.name}
                          </span>
                        </div>
                        <div style={{ flex: "0 0 100px", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                          {formatBytes(file.sizeBytes)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                    <button 
                      className="btn" 
                      onClick={handleDelete} 
                      disabled={isLoading || selectedCount === 0}
                      style={{
                        background: "#ef4444",
                        boxShadow: "0 4px 15px rgba(239, 68, 68, 0.3)",
                        border: "1px solid rgba(239, 68, 68, 0.5)",
                        transition: "all 0.3s ease",
                        width: "auto",
                        padding: "0.8rem 2rem",
                        opacity: (isLoading || selectedCount === 0) ? 0.6 : 1
                      }}
                    >
                      {isLoading ? "Processing..." : `🗑️ Delete Selected Data (${selectedCount})`}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "1rem", border: "1px dashed rgba(255,255,255,0.2)", borderRadius: "8px" }}>
                  Match identifier exists but no associated managed files were found.
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
