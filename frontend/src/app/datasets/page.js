"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import "../globals.css";

export default function DatasetsExplorer() {
  const [matchId, setMatchId] = useState("");
  const [availableMatches, setAvailableMatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [datasetType, setDatasetType] = useState("ml"); // "ml" or "lexicon"
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [definedEvents, setDefinedEvents] = useState([]);

  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [ignoredSuspicious, setIgnoredSuspicious] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [focusedSuspiciousIndex, setFocusedSuspiciousIndex] = useState(-1);
  const [suspiciousThreshold, setSuspiciousThreshold] = useState(2);
  const [popupPos, setPopupPos] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const popupRef = useRef(null);
  const dragStartPos = useRef(null);

  const suspiciousIndices = useMemo(() => {
    const indices = [];
    let i = 0;
    while (i < rows.length) {
      const evt = rows[i].event;
      if (evt && evt !== 'normal_play') {
        let j = i;
        while (j < rows.length && rows[j].event === evt) {
          j++;
        }
        const blockLen = j - i;
        if (blockLen <= suspiciousThreshold) {
          for (let k = i; k < j; k++) {
            indices.push(k);
          }
        }
        i = j;
      } else {
        i++;
      }
    }
    return indices;
  }, [rows, suspiciousThreshold]);

  const activeSuspiciousIndices = useMemo(() => {
    return suspiciousIndices.filter(idx => !ignoredSuspicious.includes(idx));
  }, [suspiciousIndices, ignoredSuspicious]);

  useEffect(() => {
    if (activeSuspiciousIndices.length > 0 && !activeSuspiciousIndices.includes(focusedSuspiciousIndex)) {
      let nextIndex = activeSuspiciousIndices.find(idx => idx > focusedSuspiciousIndex);
      if (nextIndex === undefined) {
        nextIndex = activeSuspiciousIndices[0];
      }
      setFocusedSuspiciousIndex(nextIndex);
    } else if (activeSuspiciousIndices.length === 0 && focusedSuspiciousIndex !== -1) {
      setFocusedSuspiciousIndex(-1);
    }
  }, [activeSuspiciousIndices, focusedSuspiciousIndex]);

  const scrollToRow = (idx) => {
    const el = document.getElementById(`row-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handlePrev = () => {
    if (activeSuspiciousIndices.length === 0) return;
    const pos = activeSuspiciousIndices.indexOf(focusedSuspiciousIndex);
    const newPos = pos <= 0 ? activeSuspiciousIndices.length - 1 : pos - 1;
    const nextIndex = activeSuspiciousIndices[newPos];
    setFocusedSuspiciousIndex(nextIndex);
    scrollToRow(nextIndex);
  };

  const handleNext = () => {
    if (activeSuspiciousIndices.length === 0) return;
    const pos = activeSuspiciousIndices.indexOf(focusedSuspiciousIndex);
    const newPos = pos === -1 || pos === activeSuspiciousIndices.length - 1 ? 0 : pos + 1;
    const nextIndex = activeSuspiciousIndices[newPos];
    setFocusedSuspiciousIndex(nextIndex);
    scrollToRow(nextIndex);
  };

  const handleCheck = () => {
    if (focusedSuspiciousIndex === -1) return;
    
    let nextIndex = activeSuspiciousIndices.find(idx => idx > focusedSuspiciousIndex);
    if (nextIndex === undefined) {
      nextIndex = activeSuspiciousIndices.find(idx => idx !== focusedSuspiciousIndex);
    }
    
    setIgnoredSuspicious(prev => [...prev, focusedSuspiciousIndex]);
    setUndoStack(prev => [...prev, focusedSuspiciousIndex]);
    
    if (nextIndex !== undefined) {
      setFocusedSuspiciousIndex(nextIndex);
      setTimeout(() => scrollToRow(nextIndex), 50);
    } else {
      setFocusedSuspiciousIndex(-1);
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setIgnoredSuspicious(prev => prev.filter(x => x !== last));
    setFocusedSuspiciousIndex(last);
    setTimeout(() => scrollToRow(last), 50);
  };

  const handleMouseDown = (e) => {
    const isToggleButton = e.target.closest('#popup-toggle-btn');
    // Don't drag if clicking an interactive element, unless it's the toggle button itself
    if (!isToggleButton && (e.target.closest('button') || e.target.closest('input'))) return;
    
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
      if (!popupPos) {
        setPopupPos({ x: rect.left, y: rect.top });
      }
    }
  };

  useEffect(() => {
    if (isDragging) {
      const handleMove = (e) => {
        setPopupPos({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      };
      const handleUp = () => {
        setIsDragging(false);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
    }
  }, [isDragging, dragOffset]);

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
        setIgnoredSuspicious([]);
        setUndoStack([]);
        setFocusedSuspiciousIndex(-1);
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

  const exportDataset = () => {
    if (rows.length === 0) return;
    
    const headers = ["Start", "End", "Text", "Event", "Score"];
    const csvRows = rows.map(r => {
      const escape = (str) => {
        if (str == null) return "";
        const s = String(str);
        if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      return [r.start, r.end, escape(r.text), r.event || "normal_play", r.score || 0].join(",");
    });
    
    const csvContent = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${matchId}_${datasetType}_exported.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="app-container" style={{ maxWidth: "1400px", minHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <header className="mb-4">
        <h1 className="page-title">Dataset Verification Explorer</h1>
        <p className="page-subtitle">Verify imported dataset mappings for ML and Lexicon generation.</p>
      </header>

      {/* Floating Widget for Suspicious Rows */}
      <div 
        ref={popupRef}
        style={popupPos ? {
          position: 'fixed',
          left: `${popupPos.x}px`,
          top: `${popupPos.y}px`,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          userSelect: isDragging ? 'none' : 'auto'
        } : {
          position: 'fixed',
          left: '20px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          userSelect: isDragging ? 'none' : 'auto'
        }}
      >
        {!isPopupOpen ? (
          <button 
            id="popup-toggle-btn"
            className="btn btn-secondary" 
            onMouseDown={handleMouseDown}
            onClick={(e) => {
              if (dragStartPos.current) {
                const dx = Math.abs(e.clientX - dragStartPos.current.x);
                const dy = Math.abs(e.clientY - dragStartPos.current.y);
                if (dx > 3 || dy > 3) return; // Ignore click if we dragged
              }
              setIsPopupOpen(true);
            }} 
            style={{ 
              borderRadius: '50%', 
              width: '64px', 
              height: '64px', 
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              position: 'relative',
              fontSize: '2rem',
              cursor: isDragging ? 'grabbing' : 'pointer'
            }}
            title="Suspicious Rows Navigator"
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '-4px' }}>⚠️</span>
          </button>
        ) : (
          <div className="glass-card" 
            onMouseDown={handleMouseDown}
            style={{ 
              padding: '1.2rem', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '15px', 
              alignItems: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(20, 20, 35, 0.98)',
              backdropFilter: 'blur(20px)',
              width: '210px',
              cursor: isDragging ? 'grabbing' : 'grab'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Suspicious Rows</h4>
              <button 
                onClick={() => setIsPopupOpen(false)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: '6px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Max consecutive:</span>
              <input 
                type="number" 
                min="1"
                value={suspiciousThreshold} 
                onChange={(e) => setSuspiciousThreshold(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ 
                  width: '45px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  color: 'white', 
                  borderRadius: '4px', 
                  padding: '2px 5px',
                  textAlign: 'center',
                  fontSize: '0.9rem'
                }}
              />
            </div>

            {activeSuspiciousIndices.length > 0 ? (
              <>
                <button className="btn btn-secondary" onClick={handlePrev} style={{ padding: '0.5rem 2rem', fontSize: '1.2rem', width: '100%' }}>▲</button>
                <div style={{ fontWeight: 'bold', fontSize: '1.5rem', margin: '5px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--primary-color)' }}>
                    {activeSuspiciousIndices.indexOf(focusedSuspiciousIndex) + 1}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>/</span>
                  <span style={{ fontSize: '1.2rem' }}>{activeSuspiciousIndices.length}</span>
                </div>
                <button className="btn btn-secondary" onClick={handleNext} style={{ padding: '0.5rem 2rem', fontSize: '1.2rem', width: '100%' }}>▼</button>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', width: '100%' }}>
                  <button className="btn btn-primary" onClick={handleCheck} style={{ width: '100%', padding: '0.6rem' }}>Check Off</button>
                  {undoStack.length > 0 && (
                    <button className="btn btn-secondary" onClick={handleUndo} style={{ width: '100%', padding: '0.6rem' }}>
                      Undo
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', margin: '20px 0' }}>
              
                <div style={{ fontSize: '0.9rem' }}>No suspicious rows left.</div>
                {undoStack.length > 0 && (
                  <button className="btn btn-secondary" onClick={handleUndo} style={{ width: '100%', marginTop: '20px', padding: '0.6rem' }}>
                    Undo Last
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
        <button className="btn btn-secondary" onClick={exportDataset} disabled={rows.length === 0} style={{ background: 'var(--primary-color)', color: 'white', border: 'none' }}>Export Dataset</button>
        <span className="text-muted" style={{ fontWeight: "500", marginLeft: "1rem" }}>{statusMsg}</span>
      </div>

      <main className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "visible" }}>
        <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h2 className="card-title" style={{ margin: 0 }}>📊 {datasetType.toUpperCase()} Raw CSV Dataset View</h2>
        </div>
        
        <div className="table-container" style={{ borderRadius: 0, border: "none", flex: 1, overflowX: "auto", overflowY: "visible" }}>
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
                <tr 
                  key={i} 
                  id={`row-${i}`}
                  style={{ 
                    background: focusedSuspiciousIndex === i 
                      ? "rgba(255, 71, 87, 0.2)" 
                      : (r.event && r.event !== "normal_play") 
                        ? "var(--secondary-glow)" 
                        : "transparent",
                    boxShadow: focusedSuspiciousIndex === i ? "inset 0 0 0 2px #ff4757" : "none",
                    transition: "background 0.3s, box-shadow 0.3s"
                  }}
                >
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
                        <option key={evt} value={evt} style={{ color: "black", background: "white" }}>{evt}</option>
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
