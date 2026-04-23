"use client";

import { useState } from "react";
import "./globals.css";

export default function Home() {
  const [file, setFile] = useState(null);
  const [logs, setLogs] = useState("Waiting for input...");
  const [isProcessing, setIsProcessing] = useState(false);
  const [highlights, setHighlights] = useState([]);

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const runPipeline = async () => {
    if (!file) return;
    setIsProcessing(true);
    setLogs("Uploading file...");

    try {
      // 1. Upload File & Chunk Data
      const formData = new FormData();
      formData.append("file", file);
      
      let res = await fetch("/api/upload", { method: "POST", body: formData });
      let data = await res.json();
      setLogs((prev) => prev + "\n" + data.message);

      // 2. Run Pipeline Model Predictions
      setLogs((prev) => prev + "\nRunning Hybrid Model predictions...");
      res = await fetch("/api/pipeline", { method: "POST" });
      data = await res.json();
      setLogs((prev) => prev + "\n" + data.message);

      // 3. Fetch specific match results
      setLogs((prev) => prev + "\nFetching Highlight Timestamps...");
      const matchId = file.name.replace(".vtt", "");
      res = await fetch(`/api/results?matchId=${matchId}`);
      if (res.ok) {
        const clips = await res.json();
        setHighlights(clips);
        setLogs((prev) => prev + `\nFound ${clips.length} highlight clips!`);
      } else {
        setLogs((prev) => prev + "\nError fetching timestamps.");
      }

    } catch (err) {
      console.error(err);
      setLogs((prev) => prev + "\nFailed to complete pipeline.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Rugby Highlight Analyzer</h1>
        <p className="subtitle">AI-Powered Commentary Model Pipeline Dashboard</p>
      </header>

      <main className="dashboard-grid">
        {/* Upload & Control Panel */}
        <section className="glass-card">
          <h2 className="card-title">🚀 Pipeline Controls</h2>
          
          <div 
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="drop-icon">📁</div>
            {file ? (
              <p>Selected: <strong>{file.name}</strong></p>
            ) : (
              <p>Drag & Drop your <strong>.vtt</strong> commentary chunk here<br/><span style={{opacity:0.6, fontSize:'0.9rem'}}>(e.g. match_01.vtt)</span></p>
            )}
          </div>

          <button 
            className="btn" 
            onClick={runPipeline} 
            disabled={!file || isProcessing}
          >
            {isProcessing ? "Processing Match..." : "Run Complete Pipeline"}
          </button>

          <div className="status-log">
            {logs}
          </div>
        </section>

        {/* Results Panel */}
        <section className="glass-card">
          <h2 className="card-title">🎯 Highlight Clips</h2>
          
          <div className="highlights-container">
            {highlights.length === 0 ? (
              <p style={{color: "var(--text-muted)", textAlign: "center", marginTop: "2rem"}}>
                No highlights discovered yet.
              </p>
            ) : (
              highlights.map((clip, i) => (
                <div 
                  key={i} 
                  className="highlight-item" 
                  style={{animationDelay: `${i * 0.1}s`}}
                >
                  <div className="highlight-time">
                    {clip.start}s — {clip.end}s
                  </div>
                  <p style={{opacity: 0.8, fontSize: "0.95rem"}}>
                    Detected through Hybrid Model (RoBERTa + Lexicon)
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
