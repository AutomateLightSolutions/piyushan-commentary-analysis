"use client";

import { useState, useEffect } from "react";
import "../globals.css";

export default function ManageEvents() {
  const [events, setEvents] = useState([]);
  const [newEvent, setNewEvent] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (res.ok) {
        setEvents(data.events || []);
      } else {
        setStatusMsg("Failed to load events");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Error loading events");
    } finally {
      setIsLoading(false);
    }
  };

  const saveEvents = async (updatedEvents) => {
    try {
      setStatusMsg("Saving...");
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: updatedEvents }),
      });
      if (res.ok) {
        setEvents(updatedEvents);
        setStatusMsg("Events updated successfully");
      } else {
        setStatusMsg("Failed to update events");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Error saving events");
    }
  };

  const handleAddEvent = () => {
    if (!newEvent.trim()) return;
    if (events.includes(newEvent.trim())) {
      setStatusMsg("Event already exists");
      return;
    }
    const updatedEvents = [...events, newEvent.trim()];
    saveEvents(updatedEvents);
    setNewEvent("");
  };

  const handleDeleteEvent = (index) => {
    const updatedEvents = events.filter((_, i) => i !== index);
    saveEvents(updatedEvents);
  };

  return (
    <div className="app-container" style={{ maxWidth: "800px", padding: "2rem", margin: "0 auto" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="page-title">Manage Events</h1>
        <p className="page-subtitle">Configure the predefined events for manual labeling</p>
      </header>

      <div className="glass-card" style={{ padding: "1.5rem" }}>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
          <input 
            type="text" 
            placeholder="New Event Name" 
            value={newEvent} 
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddEvent()}
            className="form-input"
            style={{ flexGrow: 1 }}
          />
          <button className="btn btn-primary" onClick={handleAddEvent}>Add Event</button>
        </div>

        {statusMsg && <div style={{ marginBottom: "1rem", color: "var(--primary-color)" }}>{statusMsg}</div>}

        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {events.length === 0 ? <p className="text-muted">No events configured.</p> : null}
            {events.map((evt, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                padding: "1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <span style={{ fontWeight: "bold" }}>{evt}</span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem", color: "#f87171", borderColor: "#f87171" }}
                  onClick={() => handleDeleteEvent(i)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
