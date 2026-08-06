"use client";

import React, { createContext, useState, useRef, useCallback, useEffect } from "react";
import { streamSSE } from "../lib/sse";

export const PipelineContext = createContext();

const INITIAL_STEPS = [
  { id: "upload",  name: "1. Upload Videos to Backend",                  status: "idle", log: "", lines: [] },
  { id: "extract", name: "2. Audio Extraction & Whisper Transcription",   status: "idle", log: "", lines: [] },
  { id: "chunk",   name: "3. Chunking Timestamped Text",                  status: "idle", log: "", lines: [] },
  { id: "label",   name: "4. Proceed to Manual Labeling module",          status: "idle", log: "", lines: [] },
];

const INITIAL_ML_STEPS = [
  { id: "train",    name: "6. Train Classifier",              status: "idle", log: "", lines: [] },
  { id: "predict",  name: "7-11. Build Lexicon, Hybrid Score & Merge Predict",  status: "idle", log: "", lines: [] },
  { id: "evaluate", name: "12. Generate Evaluation Metrics",                    status: "idle", log: "", lines: [] },
];

export function PipelineProvider({ children }) {
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [mlSteps, setMlSteps] = useState(INITIAL_ML_STEPS);
  const [metricsData, setMetricsData] = useState(null);
  const [selectedModel, setSelectedModel] = useState("roberta-base");
  
  const [selectedDataset, setSelectedDataset] = useState("all");
  
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

  // ── Run one SSE step ───────────────────────────────────────────────────────
  const runStreamStep = async (url, id, setter, signal) => {
    mutateStep(setter, id, { status: "active", log: "", lines: [] });
    const result = await streamSSE(url, (text, type) => appendLine(setter, id, text, type), signal);
    mutateStep(setter, id, { status: "done" });
    return result;
  };

  // ── Pipeline handlers ──────────────────────────────────────────────────────
  const handleProcess = async (matchId, fullVideo) => {
    setIsProcessing(true);
    resetSteps();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    mutateStep(setSteps, "upload", { status: "active", log: "Uploading .mp4 files → 0%", lines: [] });
    try {
      await new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append("fullVideo", fullVideo);
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

    try { await runStreamStep(`/api/extract-videos?filename=${matchId}_full.mp4`, "extract", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "extract", { status: "error", log: err.message }); setIsProcessing(false); return; }

    try { await runStreamStep(`/api/prepare?filename=${matchId}_full.json`, "chunk", setSteps, signal); }
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

    try { await runStreamStep(`/api/extract-videos?filename=${matchId}_full.mp4`, "extract", setSteps, signal); }
    catch (err) { mutateStep(setSteps, "extract", { status: "error", log: err.message }); setIsProcessing(false); return; }

    try { await runStreamStep(`/api/prepare?filename=${matchId}_full.json`, "chunk", setSteps, signal); }
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
    
    const params = `?modelName=${encodeURIComponent(selectedModel)}&dataset=${encodeURIComponent(selectedDataset)}`;

    try { await runStreamStep(`/api/train${params}`, "train", setMlSteps, signal); }
    catch (err) { mutateStep(setMlSteps, "train", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    try { await runStreamStep(`/api/pipeline${params}`, "predict", setMlSteps, signal); }
    catch (err) { mutateStep(setMlSteps, "predict", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    try {
      const result = await runStreamStep(`/api/evaluate${params}`, "evaluate", setMlSteps, signal);
      if (result?.extraData && !signal.aborted) setMetricsData(result.extraData);
    } catch (err) { mutateStep(setMlSteps, "evaluate", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    setIsMlProcessing(false);
  };

  const handleMlProcessSkipTrain = async () => {
    setIsMlProcessing(true);
    setMetricsData(null);
    resetMlSteps();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    const params = `?modelName=${encodeURIComponent(selectedModel)}&dataset=${encodeURIComponent(selectedDataset)}`;

    mutateStep(setMlSteps, "train", { status: "done", log: "Skipped training step." });

    try { await runStreamStep(`/api/pipeline${params}`, "predict", setMlSteps, signal); }
    catch (err) { mutateStep(setMlSteps, "predict", { status: "error", log: err.message }); setIsMlProcessing(false); return; }

    try {
      const result = await runStreamStep(`/api/evaluate${params}`, "evaluate", setMlSteps, signal);
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
    selectedModel,
    setSelectedModel,
    selectedDataset,
    setSelectedDataset,
    isProcessing,
    isMlProcessing,
    handleProcess,
    handleResume,
    handleMlProcess,
    handleMlProcessSkipTrain,
    handleStop
  };

  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}
