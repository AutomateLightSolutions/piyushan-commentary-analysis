"use client";

import { useState, useEffect } from "react";
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

  const toggleFile = (filename) => {
    setSelectedFiles(prev => ({ ...prev, [filename]: !prev[filename] }));
  };

  const allSelected = matchFiles.length > 0 && matchFiles.every(f => selectedFiles[f.name]);
  const toggleSelectAll = () => {
    const newVal = !allSelected;
    const newSelections = {};
    matchFiles.forEach(f => { newSelections[f.name] = newVal; });
    setSelectedFiles(newSelections);
  };

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
      if (!res.ok) throw new Error(data.message || "Failed to delete files");
      
      setMessage(`Successfully deleted ${data.deletedCount} file(s).`);
      
      const freshRes = await fetch("/api/manage-matches");
      const freshData = await freshRes.json();
      setMatchIds(freshData.matchIds);

      if (filesToDelete.length === matchFiles.length) {
         if (freshData.matchIds.length > 0) {
           setSelectedMatchId(freshData.matchIds[0]);
         } else {
           setSelectedMatchId("");
           setMatchFiles([]);
         }
         setSelectedFiles({});
      } else {
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
    <div className="app-container" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <header className="mb-4">
        <h1 className="page-title">Manage Matches</h1>
        <p className="page-subtitle">Review and delete specific files for any match</p>
      </header>

      <main>
        <section className="glass-card">
          {message && (
            <div className={`alert ${message.startsWith("Error:") ? 'alert-error' : 'alert-success'}`}>
              {message}
            </div>
          )}

          {isFetching ? (
            <div className="text-center text-muted py-4">Loading matches...</div>
          ) : matchIds.length === 0 ? (
            <div className="text-center text-muted py-4">No matches found in the system.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div className="form-group mb-0">
                <label className="form-label">Select Match Identifier</label>
                <select 
                  value={selectedMatchId} 
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                  className="form-select"
                >
                  {matchIds.map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>

              {isFetchingFiles ? (
                <div className="text-center text-muted">Fetching specific files...</div>
              ) : matchFiles.length > 0 ? (
                <>
                  <div className="table-container">
                    <table className="table-modern">
                      <thead>
                        <tr>
                          <th style={{ width: "50px", textAlign: "center" }}>
                            <input 
                              type="checkbox" 
                              checked={allSelected} 
                              onChange={toggleSelectAll} 
                              style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer", accentColor: "var(--primary-color)" }} 
                              title="Select All" 
                            />
                          </th>
                          <th>File Type / Path</th>
                          <th style={{ textAlign: "right" }}>Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchFiles.map(file => (
                          <tr key={file.name}>
                            <td style={{ textAlign: "center" }}>
                              <input 
                                type="checkbox" 
                                checked={!!selectedFiles[file.name]} 
                                onChange={() => toggleFile(file.name)} 
                                style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer", accentColor: "var(--primary-color)" }} 
                              />
                            </td>
                            <td>
                              <div style={{ fontWeight: "600", color: "var(--text-main)" }}>{file.type}</div>
                              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontFamily: "'Courier New', monospace", marginTop: "4px" }}>
                                {file.category} / {file.name}
                              </div>
                            </td>
                            <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: "0.95rem" }}>
                              {formatBytes(file.sizeBytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button 
                      className="btn btn-danger" 
                      onClick={handleDelete} 
                      disabled={isLoading || selectedCount === 0}
                    >
                      {isLoading ? "Processing..." : `🗑️ Delete Selected Data (${selectedCount})`}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center text-muted p-4" style={{ border: "1px dashed var(--glass-border)", borderRadius: "8px" }}>
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
