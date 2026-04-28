"use client";

import { useState } from "react";
import Link from "next/link";
import "./globals.css";

export default function Home() {
  const [matchId, setMatchId] = useState("");
  const [fullVideo, setFullVideo] = useState(null);
  const [highlightVideo, setHighlightVideo] = useState(null);

  const [steps, setSteps] = useState([
    { id: "upload", name: "1. Upload Videos to Backend", status: "idle", log: "" },
    { id: "extract", name: "2. Audio Extraction & Whisper Transcription", status: "idle", log: "" },
    { id: "chunk", name: "3. Chunking Timestamped Text", status: "idle", log: "" },
    { id: "label", name: "4. Proceed to Manual Labeling module", status: "idle", log: "" }
  ]);
  
  const [mlSteps, setMlSteps] = useState([
    { id: "train", name: "6. Train RoBERTa Highlight Classifier", status: "idle", log: "" },
    { id: "predict", name: "7-11. Build Lexicon, Hybrid Score & Merge Predict", status: "idle", log: "" },
    { id: "evaluate", name: "12. Generate Evaluation Metrics", status: "idle", log: "" }
  ]);

  const [metricsData, setMetricsData] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMlProcessing, setIsMlProcessing] = useState(false);

  const updateStep = (id, newStatus, newLog = "") => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status: newStatus, log: newLog } : s));
  };

  const updateMlStep = (id, newStatus, newLog = "") => {
    setMlSteps(prev => prev.map(s => s.id === id ? { ...s, status: newStatus, log: newLog } : s));
  };

  const handleProcess = async () => {
    if (!matchId) return alert("Please enter a Match Identifier Base Name!");
    if (!fullVideo) return alert("Please select the Full Match MP4!");
    if (!highlightVideo) return alert("Please select the Highlight MP4!");

    setIsProcessing(true);
    setSteps(prev => prev.map(s => ({ ...s, status: "idle", log: "" })));

    // STEP 1: Upload Videos using XHR for Progress Tracking
    updateStep("upload", "active", "Uploading .mp4 files -> 0%");
    
    try {
      await new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("fullVideo", fullVideo);
        formData.append("highlightVideo", highlightVideo);
        formData.append("matchId", matchId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload-video", true);

        // Upload progress tracking
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            updateStep("upload", "active", `Uploading .mp4 files -> ${percentComplete}% \n(${((event.loaded/1024)/1024).toFixed(1)} MB / ${((event.total/1024)/1024).toFixed(1)} MB)`);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            updateStep("upload", "done", "Upload successful!");
            resolve();
          } else {
            reject(new Error("Upload failed. Files may be too large."));
          }
        };

        xhr.onerror = () => reject(new Error("Network Error occurred during upload."));
        xhr.send(formData);
      });
    } catch (err) {
      updateStep("upload", "error", err.message);
      setIsProcessing(false); return;
    }

    // STEP 2: Extract
    updateStep("extract", "active", "Running FFMPEG and Whisper...\nDepending on video length, this could take a few minutes.");
    try {
      const extRes = await fetch("/api/extract-videos", { method: "POST" });
      if (!extRes.ok) throw new Error("Transcription script failed.");
      updateStep("extract", "done", "Extracted .vtt files successfully!");
    } catch (err) {
      updateStep("extract", "error", err.message);
      setIsProcessing(false); return;
    }

    // STEP 3: Chunking
    updateStep("chunk", "active", "Converting .vtt to overlapped chunks and checking overlap...");
    try {
      const chunkRes = await fetch("/api/prepare", { method: "POST" });
      if (!chunkRes.ok) throw new Error("Chunking failed.");
      updateStep("chunk", "done", "Chunks generated and dataset.csv initialized.");
    } catch (err) {
      updateStep("chunk", "error", err.message);
      setIsProcessing(false); return;
    }

    updateStep("label", "done", "Pipeline completely successful! You may now navigate to the Data Annotation Center.");
    setIsProcessing(false);
  };

  const handleMlProcess = async () => {
    setIsMlProcessing(true);
    setMetricsData(null);
    setMlSteps(prev => prev.map(s => ({ ...s, status: "idle", log: "" })));

    // Phase 6: Train RoBERTa
    updateMlStep("train", "active", "Fine-tuning RoBERTa baseline on chunk datasets...\n(This will take significant time/GPU conditionally)");
    try {
      const trainRes = await fetch("/api/train", { method: "POST" });
      if (!trainRes.ok) throw new Error("Failed to train RoBERTa.");
      updateMlStep("train", "done", "RoBERTa Training finished successfully!");
    } catch (err) {
      updateMlStep("train", "error", err.message);
      setIsMlProcessing(false); return;
    }

    // Phase 7-11: Lexicon & Hybrid & Merge
    updateMlStep("predict", "active", "Building Lexicon mappings, fusing 70/30 scores, and merging consecutive predictions...");
    try {
      const pipelineRes = await fetch("/api/pipeline", { method: "POST" });
      if (!pipelineRes.ok) throw new Error("Pipeline run failed.");
      updateMlStep("predict", "done", "Predictions JSON generated locally!");
    } catch (err) {
      updateMlStep("predict", "error", err.message);
      setIsMlProcessing(false); return;
    }

    // Phase 12: Evaluate
    updateMlStep("evaluate", "active", "Averaging precision metrics against ground-truth labels...");
    try {
      const evalRes = await fetch("/api/evaluate", { method: "POST" });
      const evalData = await evalRes.json();
      if (!evalRes.ok) throw new Error("Evaluation parsing failed.");
      setMetricsData(evalData.metrics);
      updateMlStep("evaluate", "done", "Evaluation matrix pulled gracefully.");
    } catch (err) {
      updateMlStep("evaluate", "error", err.message);
      setIsMlProcessing(false); return;
    }

    setIsMlProcessing(false);
  };

  return (
    <div className="app-container" style={{maxWidth: "1400px"}}>
      <header className="flex-between">
        <div>
          <h1>Rugby Highlight Analyzer</h1>
          <p className="subtitle" style={{marginBottom: 0}}>Automated Video Transcription & Chunking Pipeline</p>
        </div>
        <div style={{display: "flex", gap: "1.5rem", alignItems: "center"}}>
            <Link href="/lexicon" style={{color: "white", textDecoration: "none", fontWeight: "bold", background: "rgba(255,255,255,0.1)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)"}}>
              Manage Lexicon
            </Link>
            <Link href="/datasets" style={{color: "white", textDecoration: "none", fontWeight: "bold", background: "rgba(255,255,255,0.1)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)"}}>
              View Final Datasets CSV
            </Link>
            <Link href="/label" style={{color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold"}}>
              Go to Manual Labeling Center →
            </Link>
        </div>
      </header>

      <main style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", alignItems: "start"}}>
        
        {/* Left Col: Setup Pipeline */}
        <div>
           <section className="glass-card" style={{marginBottom: "2rem"}}>
             <h2 className="card-title">🎥 1. Provide Context & Videos</h2>
             
             <div style={{display: "flex", flexDirection: "column", gap: "1rem"}}>
                <div>
                  <label style={{display: "block", marginBottom: "0.5rem", color: "var(--text-muted)"}}>Match Identifier Base Name</label>
                  <input 
                     type="text" 
                     placeholder="e.g. match_01" 
                     value={matchId} 
                     onChange={e => setMatchId(e.target.value)}
                     style={{width: "100%", padding: "0.8rem", borderRadius:"8px", border:"1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white"}}
                   />
                </div>
                
                <div>
                  <label style={{display: "block", marginBottom: "0.5rem", color: "var(--text-muted)"}}>Upload Full Match Video (.mp4)</label>
                  <input 
                     type="file" 
                     accept="video/mp4" 
                     onChange={e => setFullVideo(e.target.files[0])}
                     style={{width: "100%", padding: "0.8rem", borderRadius:"8px", border:"1px dashed var(--primary-color)", color: "white"}}
                   />
                </div>

                <div>
                  <label style={{display: "block", marginBottom: "0.5rem", color: "var(--text-muted)"}}>Upload Highlight Video (.mp4)</label>
                  <input 
                     type="file" 
                     accept="video/mp4" 
                     onChange={e => setHighlightVideo(e.target.files[0])}
                     style={{width: "100%", padding: "0.8rem", borderRadius:"8px", border:"1px dashed var(--secondary-color)", color: "white"}}
                   />
                </div>

                <button 
                   className="btn" 
                   onClick={handleProcess} 
                   disabled={isProcessing || isMlProcessing}
                   style={{marginTop: "1rem"}}
                 >
                   {isProcessing ? "Pipeline Running..." : "Start System Pipeline (Step 1-4)"}
                 </button>
             </div>
           </section>

           <section className="glass-card">
             <h2 className="card-title">⚙️ 2. Data Pipeline Progress</h2>
             
             <div style={{display: "flex", flexDirection: "column", gap: "1.5rem"}}>
                {steps.map(step => (
                   <div key={step.id} style={{
                       opacity: step.status === "idle" ? 0.4 : 1,
                       transition: "all 0.3s ease",
                       borderLeft: `4px solid ${
                          step.status === "done" ? "#10b981" : 
                          step.status === "active" ? "var(--primary-color)" : 
                          step.status === "error" ? "#ef4444" : "var(--glass-border)"
                       }`,
                       paddingLeft: "1rem"
                   }}>
                       <div style={{fontWeight: "bold", fontSize: "1.1rem", display: "flex", justifyContent: "space-between"}}>
                          <span>{step.name}</span>
                          <span>
                             {step.status === "done" && "✅"}
                             {step.status === "active" && "⏳"}
                             {step.status === "error" && "❌"}
                          </span>
                       </div>
                       {step.log && (
                           <div style={{
                               marginTop: "0.5rem", 
                               background: "rgba(0,0,0,0.2)", 
                               padding: "0.8rem", 
                               borderRadius: "8px", 
                               fontFamily: "monospace", 
                               fontSize: "0.9rem",
                               color: step.status === "error" ? "#fca5a5" : "#a7f3d0",
                               whiteSpace: "pre-wrap"
                           }}>
                               {step.log}
                           </div>
                       )}
                       {step.id === "label" && step.status === "done" && (
                           <Link href="/label" style={{display:"inline-block", marginTop:"1rem", background:"var(--primary-color)", color:"white", padding:"0.6rem 1rem", borderRadius:"6px", textDecoration:"none", fontWeight:"bold"}}>
                              Go to Manual Labeling →
                           </Link>
                       )}
                   </div>
                ))}
             </div>
           </section>
        </div>

        {/* Right Col: Advanced ML & Metrics */}
        <div>
           <section className="glass-card" style={{marginBottom: "2rem"}}>
             <div className="flex-between">
                <h2 className="card-title" style={{margin: 0}}>🧠 3. Advanced ML Execution</h2>
                <button 
                   className="btn" 
                   onClick={handleMlProcess} 
                   disabled={isProcessing || isMlProcessing}
                   style={{marginTop: 0, padding:"0.6rem 1.2rem", width:"auto"}}
                 >
                   {isMlProcessing ? "Executing Sequence..." : "Run ML Sequence (Step 6-12)"}
                 </button>
             </div>
             
             <div style={{display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1.5rem"}}>
                {mlSteps.map(step => (
                   <div key={step.id} style={{
                       opacity: step.status === "idle" ? 0.4 : 1,
                       transition: "all 0.3s ease",
                       borderLeft: `4px solid ${
                          step.status === "done" ? "#10b981" : 
                          step.status === "active" ? "var(--secondary-color)" : 
                          step.status === "error" ? "#ef4444" : "var(--glass-border)"
                       }`,
                       paddingLeft: "1rem"
                   }}>
                       <div style={{fontWeight: "bold", fontSize: "1.1rem", display: "flex", justifyContent: "space-between"}}>
                          <span>{step.name}</span>
                          <span>
                             {step.status === "done" && "✅"}
                             {step.status === "active" && "⏳"}
                             {step.status === "error" && "❌"}
                          </span>
                       </div>
                       {step.log && (
                           <div style={{
                               marginTop: "0.5rem", 
                               background: "rgba(0,0,0,0.2)", 
                               padding: "0.8rem", 
                               borderRadius: "8px", 
                               fontFamily: "monospace", 
                               fontSize: "0.9rem",
                               color: step.status === "error" ? "#fca5a5" : "#a7f3d0",
                               whiteSpace: "pre-wrap"
                           }}>
                               {step.log}
                           </div>
                       )}
                   </div>
                ))}
             </div>
           </section>

           {metricsData && (
               <section className="glass-card" style={{animation: "fadeIn 0.5s ease"}}>
                   <h2 className="card-title">📊 Final Evaluation Metrics</h2>
                   <table style={{width: "100%", borderCollapse: "collapse", textAlign: "left"}}>
                       <thead>
                           <tr style={{borderBottom: "1px solid var(--glass-border)", color: "white"}}>
                               <th style={{padding: "1rem"}}>Model Approach</th>
                               <th style={{padding: "1rem", color:"var(--primary-color)"}}>Precision</th>
                               <th style={{padding: "1rem", color:"var(--secondary-color)"}}>Recall</th>
                               <th style={{padding: "1rem", color:"#10b981"}}>F1 Score</th>
                           </tr>
                       </thead>
                       <tbody>
                           {Object.entries(metricsData).map(([model, metrics]) => (
                               <tr key={model} style={{borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                                   <td style={{padding: "1rem", fontWeight: "bold"}}>{model}</td>
                                   <td style={{padding: "1rem"}}>{metrics.precision?.toFixed(2) || "0.00"}</td>
                                   <td style={{padding: "1rem"}}>{metrics.recall?.toFixed(2) || "0.00"}</td>
                                   <td style={{padding: "1rem", fontWeight: "bold", textShadow:"0 0 10px rgba(16,185,129,0.3)"}}>{metrics.f1?.toFixed(2) || "0.00"}</td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </section>
           )}
        </div>

      </main>
    </div>
  );
}
