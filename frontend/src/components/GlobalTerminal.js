"use client";

import React, { useContext, useState, useRef, useEffect } from "react";
import { PipelineContext } from "../app/PipelineContext";
import { usePathname } from "next/navigation";

export default function GlobalTerminal() {
  const { steps, mlSteps, isProcessing, isMlProcessing } = useContext(PipelineContext);
  const [isMinimized, setIsMinimized] = useState(false);
  const logRef = useRef(null);
  const pathname = usePathname();

  // Find the currently active step
  let activeStep = null;
  if (isProcessing) {
    activeStep = steps.find(s => s.status === "active");
  } else if (isMlProcessing) {
    activeStep = mlSteps.find(s => s.status === "active");
  }

  useEffect(() => {
    if (logRef.current && !isMinimized) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [activeStep?.lines, activeStep?.log, isMinimized]);

  // Don't show if nothing is processing, or if we are on the main Pipeline page (where the big terminal is already visible)
  // But wait, the user might want it visible everywhere or we can just hide it on "/" if they are looking at Tab 2 or 3.
  // Actually, let's show it on other pages definitely.
  if (!isProcessing && !isMlProcessing) return null;
  if (pathname === "/") return null; // We can hide it on the main page to avoid duplication, as it's already there

  if (!activeStep) return null;

  const hasLiveLines = activeStep.lines && activeStep.lines.length > 0;

  return (
    <div style={{
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: isMinimized ? "300px" : "500px",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      borderRadius: "8px",
      boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      transition: "all 0.3s ease"
    }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem",
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        borderBottom: isMinimized ? "none" : "1px solid rgba(255, 255, 255, 0.05)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "pointer"
      }} onClick={() => setIsMinimized(!isMinimized)}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", overflow: "hidden" }}>
          <span style={{ display: "inline-block", animation: "pulse 1.2s ease-in-out infinite", fontSize: "0.9rem" }}>⏳</span>
          <span style={{ fontWeight: "600", fontSize: "0.9rem", color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activeStep.name}
          </span>
        </div>
        <button style={{
          background: "transparent",
          border: "none",
          color: "#a1a1aa",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0.2rem"
        }}>
          {isMinimized ? "▲" : "▼"}
        </button>
      </div>

      {/* Terminal Body */}
      {!isMinimized && (
        <div ref={logRef} style={{
          padding: "1rem",
          fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
          fontSize: "0.8rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: "300px",
          minHeight: "150px",
          overflowY: "auto",
          lineHeight: "1.6",
        }}>
          {/* Static log */}
          {!hasLiveLines && activeStep.log && (
            <span style={{ color: activeStep.status === "error" ? "#fca5a5" : "#a7f3d0" }}>{activeStep.log}</span>
          )}

          {/* Live streamed lines */}
          {hasLiveLines && activeStep.lines.map((l, i) => (
            <div key={i} style={{
              color: l.type === "stderr" ? "#fbbf24" :
                     activeStep.status === "error" ? "#fca5a5" : "#a7f3d0",
            }}>{l.text}</div>
          ))}

          {/* Blinking cursor */}
          {activeStep.status === "active" && (
            <span style={{ animation: "blink 1s step-end infinite", color: "#a7f3d0" }}>▋</span>
          )}
        </div>
      )}
    </div>
  );
}
