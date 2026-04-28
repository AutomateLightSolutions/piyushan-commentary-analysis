"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import "../globals.css";

export default function LexiconManagement() {
  const [config, setConfig] = useState({ categories: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/lexicon");
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error("Failed to fetch lexicon:", err);
      setMessage({ type: "error", text: "Failed to load lexicon configuration." });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const res = await fetch("/api/lexicon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Lexicon configuration saved successfully!" });
      } else {
        throw new Error("Failed to save");
      }
    } catch (err) {
      setMessage({ type: "error", text: "Error saving configuration." });
    } finally {
      setSaving(false);
    }
  };

  const updateWeight = (id, newWeight) => {
    setConfig((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) =>
        cat.id === id ? { ...cat, weight: parseFloat(newWeight) || 0 } : cat
      ),
    }));
  };

  const addTerm = (catId, term) => {
    if (!term.trim()) return;
    setConfig((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) =>
        cat.id === catId ? { ...cat, terms: [...cat.terms, term.trim()] } : cat
      ),
    }));
  };

  const removeTerm = (catId, termToRemove) => {
    setConfig((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) =>
        cat.id === catId
          ? { ...cat, terms: cat.terms.filter((t) => t !== termToRemove) }
          : cat
      ),
    }));
  };

  const addCategory = () => {
    const newId = `cat_${Date.now()}`;
    setConfig((prev) => ({
      ...prev,
      categories: [
        ...prev.categories,
        { id: newId, name: "New Category", weight: 0, terms: [] },
      ],
    }));
  };

  const removeCategory = (id) => {
    setConfig((prev) => ({
      ...prev,
      categories: prev.categories.filter((cat) => cat.id !== id),
    }));
  };

  const updateCategoryName = (id, newName) => {
    setConfig((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) =>
        cat.id === id ? { ...cat, name: newName } : cat
      ),
    }));
  };

  const totalWeight = config.categories.reduce((acc, cat) => acc + cat.weight, 0);

  if (loading) {
    return (
      <div className="app-container" style={{ textAlign: "center" }}>
        <h1>Loading Lexicon...</h1>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ maxWidth: "1200px" }}>
      <header className="flex-between">
        <div>
          <h1>Lexicon Management</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Configure Rule-Based Parameters for Highlight Generation
          </p>
        </div>
        <Link href="/" style={{ color: "var(--primary-color)", textDecoration: "none", fontWeight: "bold" }}>
          ← Back to Dashboard
        </Link>
      </header>

      <main>
        <section className="glass-card" style={{ marginBottom: "2rem" }}>
          <div className="flex-between" style={{ marginBottom: "1.5rem" }}>
            <h2 className="card-title" style={{ margin: 0 }}>📊 Category Weights</h2>
            <div style={{ 
              padding: "0.5rem 1rem", 
              borderRadius: "8px", 
              background: totalWeight === 1 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
              color: totalWeight === 1 ? "#10b981" : "#ef4444",
              fontWeight: "bold"
            }}>
              Total Weight: {(totalWeight * 100).toFixed(0)}% {totalWeight !== 1 && "(Should be 100%)"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "1.5rem" }}>
            {config.categories.map((cat) => (
              <div key={cat.id} className="glass-card" style={{ padding: "1.5rem", background: "rgba(0,0,0,0.2)" }}>
                <input
                  type="text"
                  value={cat.name}
                  onChange={(e) => updateCategoryName(cat.id, e.target.value)}
                  style={{ 
                    background: "transparent", 
                    border: "none", 
                    color: "white", 
                    fontSize: "1.2rem", 
                    fontWeight: "bold", 
                    width: "100%",
                    marginBottom: "0.5rem",
                    borderBottom: "1px solid var(--glass-border)"
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <label style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Weight:</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={cat.weight}
                    onChange={(e) => updateWeight(cat.id, e.target.value)}
                    style={{ 
                      width: "80px", 
                      padding: "0.3rem", 
                      borderRadius: "4px", 
                      border: "1px solid var(--glass-border)", 
                      background: "rgba(0,0,0,0.3)", 
                      color: "white" 
                    }}
                  />
                </div>
                <button 
                  onClick={() => removeCategory(cat.id)}
                  style={{ 
                    marginTop: "1rem", 
                    background: "rgba(239,68,68,0.2)", 
                    color: "#ef4444", 
                    border: "none", 
                    padding: "0.4rem 0.8rem", 
                    borderRadius: "6px", 
                    cursor: "pointer",
                    fontSize: "0.8rem"
                  }}
                >
                  Remove Category
                </button>
              </div>
            ))}
            <button 
              onClick={addCategory}
              style={{ 
                border: "2px dashed var(--glass-border)", 
                borderRadius: "16px", 
                background: "transparent", 
                color: "var(--text-muted)", 
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                padding: "2rem"
              }}
            >
              <span style={{ fontSize: "2rem" }}>+</span>
              <span>Add Category</span>
            </button>
          </div>
        </section>

        <section className="glass-card">
          <h2 className="card-title">🔍 Category Terms</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {config.categories.map((cat) => (
              <div key={cat.id} style={{ borderBottom: "1px solid var(--glass-border)", paddingBottom: "1.5rem" }}>
                <h3 style={{ marginBottom: "1rem", color: "var(--primary-color)" }}>{cat.name}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", marginBottom: "1rem" }}>
                  {cat.terms.map((term) => (
                    <div 
                      key={term} 
                      style={{ 
                        background: "rgba(255,255,255,0.1)", 
                        padding: "0.5rem 0.8rem", 
                        borderRadius: "20px", 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "0.5rem",
                        border: "1px solid var(--glass-border)"
                      }}
                    >
                      <span>{term}</span>
                      <button 
                        onClick={() => removeTerm(cat.id, term)}
                        style={{ 
                          background: "none", 
                          border: "none", 
                          color: "#ef4444", 
                          cursor: "pointer", 
                          fontWeight: "bold",
                          fontSize: "1.1rem",
                          lineHeight: 1
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.target.elements.term;
                      addTerm(cat.id, input.value);
                      input.value = "";
                    }}
                    style={{ display: "flex", gap: "0.5rem" }}
                  >
                    <input 
                      name="term"
                      placeholder="Add term..." 
                      style={{ 
                        padding: "0.5rem 1rem", 
                        borderRadius: "20px", 
                        border: "1px dashed var(--primary-color)", 
                        background: "rgba(0,0,0,0.2)", 
                        color: "white",
                        width: "150px"
                      }}
                    />
                    <button 
                      type="submit"
                      style={{ 
                        background: "var(--primary-color)", 
                        color: "white", 
                        border: "none", 
                        width: "32px", 
                        height: "32px", 
                        borderRadius: "50%", 
                        cursor: "pointer" 
                      }}
                    >
                      +
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div style={{ marginTop: "2rem", display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
          {message.text && (
            <div style={{ 
              padding: "1rem", 
              borderRadius: "8px", 
              background: message.type === "success" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
              color: message.type === "success" ? "#10b981" : "#ef4444",
              display: "flex",
              alignItems: "center"
            }}>
              {message.text}
            </div>
          )}
          <button 
            className="btn" 
            onClick={handleSave} 
            disabled={saving}
            style={{ width: "auto", padding: "1rem 3rem" }}
          >
            {saving ? "Saving..." : "Save Lexicon Configuration"}
          </button>
        </div>
      </main>

      <style jsx>{`
        .btn {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}
