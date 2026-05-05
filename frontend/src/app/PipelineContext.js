"use client";

import React, { createContext, useState, useRef, useCallback, useEffect } from "react";

export const PipelineContext = createContext();

const INITIAL_STEPS = [
  { id: "upload",  name: "1. Upload Videos to Backend",                  status: "idle", log: "", lines: [] },
  { id: "extract", name: "2. Audio Extraction & Whisper Transcription",   status: "idle", log: "", lines: [] },
  { id: "chunk",   name: "3. Chunking Timestamped Text",                  status: "idle", log: "", lines: [] },
  { id: "label",   name: "4. Proceed to Manual Labeling module",          status: "idle", log: "", lines: [] },
];

const INITIAL_ML_STEPS = [
  { id: "train",    name: "6. Train RoBERTa Highlight Classifier",              status: "idle", log: "", lines: [] },
  { id: "predict",  name: "7-11. Build Lexicon, Hybrid Score & Merge Predict",  status: "idle", log: "", lines: [] },
  { id: "evaluate", name: "12. Generate Evaluation Metrics",                    status: "idle", log: "", lines: [] },
];

export function PipelineProvider({ children }) {
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [mlSteps, setMlSteps] = useState(INITIAL_ML_STEPS);
  const [metricsData, setMetricsData] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMlProcessing, setIsMlProcessing] = useState(false);

  const abortControllerRef = useRef(null);

  // Prevent browser refresh if process is running
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isProcessing || isMlProcessing) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isProcessing, isMlProcessing]);

  // ── State helpers ──────────────────────────────────────────────────────────
  const resetSteps    = () => setSteps(INITIAL_STEPS.map(s => ({ ...s, lines: [] })));
  const resetMlSteps  = () => setMlSteps(INITIAL_ML_STEPS.map(s => ({ ...s, lines: [] })));

  const mutateStep = useCallback((setter, id, patch) => {
    setter(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const appendLine = useCallback((setter, id, text, type) => {
    setter(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, lines: [...s.lines, { text, type }] };
    }));
  }, []);

  // ── SSE stream consumer ────────────────────────────────────────────────────
  const streamSSE = async (url, onLine, signal) => {
    const res = await fetch(url, { method: "POST", signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let extraData = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop(); // keep incomplete tail

        for (const event of events) {
          const line = event.replace(/^data: /, "").trim();
          if (!line) continue;
          if (line === "__DONE__")           return { ok: true, extraData };
          if (line.startsWith("__ERROR__:")) throw new Error(line.slice(10));
          if (line.startsWith("__METRICS__:")) { extraData = JSON.parse(line.slice(12)); continue; }
          onLine(line.startsWith("STDERR:") ? line.slice(7) : line,
                 line.startsWith("STDERR:") ? "stderr" : "stdout");
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { ok: true, extraData };
  };

  // ── Run one SSE step ───────────────────────────────────────────────────────
  const runStreamStep = async (url, id, setter, signal) => {
    mutateStep(setter, id, { status: "active", log: "", lines: [] });
    const result = await streamSSE(url, (text, type) => appendLine(setter, id, text, type), signal);
    mutateStep(setter, id, { status: "done" });
    return result;
  };

  // ── Pipeline handlers ──────────────────────────────────────────────────────
  const handleProcess = async (matchId, fullVideo, highlightVideo) => {
    setIsProcessing(true);
    resetSteps();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    mutateStep(setSteps, "upload", { status: "active", log: "Uploading .mp4 files → 0%", lines: [] });
    try {
      await new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append("fullVideo", fullVideo);
        fd.append("highlightVideo", highlightVideo);
        fd.append("matchId", matchId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload-video", true);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            mutateStep(setSteps, "upload", {
              log: `Uploading .mp4 files → ${pct}%\n(${(e.loaded/1048576).toFixed(1)} MB / ${(e.total/1048576).toFixed(1)} MB)`
            });
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? (mutateStep(setSteps, "upload", { status: "done", log: "Upload successful!" }), resolve())
          : reject(new Error("Upload failed. Files may be too large."));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.onabort = () => reject(new Error("Upload aborted."));
        
        signal.addEventListener("abort", () => xhr.abort());
        xhr.send(fd);
      });
    } catch (err) {
      mutateStep(setSteps, "upload", { status: "error", log: err.message });
      setIsProcessing(false); return;
    }

    try { await runStreamStep("/api/extract-videos", "extract", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "extract", { status: "error", log: err.message }); setIsProcessing(false); return; }

    try { await runStreamStep("/api/prepare", "chunk", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "chunk", { status: "error", log: err.message }); setIsProcessing(false); return; }

    if (!signal.aborted) {
        mutateStep(setSteps, "label", { status: "done", log: "Pipeline completely successful! You may now navigate to the Data Annotation Center." });
    }
    setIsProcessing(false);
  };

  const handleResume = async (matchId) => {
    setIsProcessing(true);
    resetSteps();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    mutateStep(setSteps, "upload", { status: "done", log: "Skipped raw video upload phase. Searching backend directly..." });

    try { await runStreamStep("/api/extract-videos", "extract", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "extract", { status: "error", log: err.message }); setIsProcessing(false); return; }

    try { await runStreamStep("/api/prepare", "chunk", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "chunk", { status: "error", log: err.message }); setIsProcessing(false); return; }

    if (!signal.aborted) {
        mutateStep(setSteps, "label", { status: "done", log: "Pipeline successfully resumed and completed!" });
    }
    setIsProcessing(false);
  };

  const handleMlProcess = async () => {
    setIsMlProcessing(true);
    setMetricsData(null);
    resetMlSteps();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try { await runStreamStep("/api/train", "train", setMlSteps, signal); }
    catch (err) { mutateStep(setMlSteps, "train", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    try { await runStreamStep("/api/pipeline", "predict", setMlSteps, signal); }
    catch (err) { mutateStep(setMlSteps, "predict", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    try {
      const result = await runStreamStep("/api/evaluate", "evaluate", setMlSteps, signal);
      if (result?.extraData && !signal.aborted) setMetricsData(result.extraData);
    } catch (err) { mutateStep(setMlSteps, "evaluate", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    setIsMlProcessing(false);
  };

  const handleStop = async () => {
    // Abort active fetch/xhr requests
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    
    // Call backend to hard kill any child python processes
    try {
        await fetch("/api/stop", { method: "POST" });
    } catch (err) {
        console.error("Failed to call /api/stop", err);
    }
    
    setIsProcessing(false);
    setIsMlProcessing(false);
  };

  const value = {
    steps,
    mlSteps,
    metricsData,
    isProcessing,
    isMlProcessing,
    handleProcess,
    handleResume,
    handleMlProcess,
    handleStop
  };

  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}
