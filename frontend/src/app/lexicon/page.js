"use client";

import { useState, useEffect } from "react";
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
        setMessage({ type: "success", text: "Lexicon configuration saved successfully" });
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
      <div className="app-container text-center">
        <h1 className="page-title">Loading Lexicon...</h1>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="mb-3">
        <h1 className="page-title">Lexicon Management</h1>
        <p className="page-subtitle">Configure Rule-Based Parameters for Highlight Generation</p>
      </header>

      <main style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        <section className="glass-card">
          <div className="flex-between mb-3">
            <h2 className="card-title" style={{ margin: 0 }}>📊 Category Weights</h2>
            <div className={`alert ${totalWeight === 1 ? 'alert-success' : 'alert-error'}`} style={{ margin: 0, padding: "0.5rem 1rem" }}>
              Total Weight: {(totalWeight * 100).toFixed(0)}% {totalWeight !== 1 && "(Should be 100%)"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
            {config.categories.map((cat) => (
              <div key={cat.id} className="glass-card" style={{ padding: "1.5rem", background: "rgba(0,0,0,0.3)" }}>
                <input
                  type="text"
                  value={cat.name}
                  onChange={(e) => updateCategoryName(cat.id, e.target.value)}
                  className="form-input mb-2"
                  style={{ background: "transparent", border: "none", borderBottom: "1px solid var(--glass-border)", borderRadius: 0, fontSize: "1.2rem", fontWeight: "bold", padding: "0.5rem 0" }}
                />
                <div className="flex-between mb-3">
                  <label className="form-label mb-0">Weight:</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={cat.weight}
                    onChange={(e) => updateWeight(cat.id, e.target.value)}
                    className="form-input"
                    style={{ width: "90px", padding: "0.4rem" }}
                  />
                </div>
                <button 
                  onClick={() => removeCategory(cat.id)}
                  className="btn btn-danger w-full"
                  style={{ padding: "0.5rem" }}
                >
                  Remove Category
                </button>
              </div>
            ))}
            <button 
              onClick={addCategory}
              className="glass-card flex-center"
              style={{ border: "2px dashed var(--glass-border)", background: "transparent", color: "var(--text-muted)", flexDirection: "column", gap: "1rem", cursor: "pointer" }}
            >
              <span style={{ fontSize: "2.5rem", fontWeight: "300" }}>+</span>
              <span style={{ fontWeight: "500" }}>Add Category</span>
            </button>
          </div>
        </section>

        <section className="glass-card">
          <h2 className="card-title">🔍 Category Terms</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {config.categories.map((cat) => (
              <div key={cat.id} style={{ borderBottom: "1px solid var(--glass-border)", paddingBottom: "1.5rem" }}>
                <h3 className="mb-2 text-primary">{cat.name}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem" }}>
                  {cat.terms.map((term) => (
                    <div 
                      key={term} 
                      style={{ 
                        background: "rgba(255,255,255,0.1)", 
                        padding: "0.4rem 0.8rem", 
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
                        style={{ background: "none", border: "none", color: "var(--error-color)", cursor: "pointer", fontWeight: "bold", fontSize: "1.2rem", lineHeight: 1 }}
                      >
                        &times;
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
                      className="form-input"
                      style={{ padding: "0.4rem 1rem", borderRadius: "20px", width: "160px" }}
                    />
                    <button 
                      type="submit"
                      className="btn btn-primary flex-center"
                      style={{ width: "36px", height: "36px", borderRadius: "50%", padding: 0 }}
                    >
                      +
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex-between">
          <div>
            {message.text && (
              <div className={`alert ${message.type === "success" ? 'alert-success' : 'alert-error'}`} style={{ margin: 0 }}>
                {message.text}
              </div>
            )}
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleSave} 
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </main>
    </div>
  );
}
