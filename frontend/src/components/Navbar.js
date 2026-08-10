"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function Navbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="navbar">
      <Link href="/" className="nav-brand">
        Rugby Highlight Analyzer
      </Link>
      
      <button 
        className="mobile-menu-btn" 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle menu"
      >
        {isOpen ? "✕" : "☰"}
      </button>

      <div 
        className={`nav-links ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(false)}
      >
        <Link 
          href="/" 
          className={`nav-link ${pathname === "/" ? "active" : ""}`}
        >
          Pipeline
        </Link>
        <Link 
          href="/lexicon" 
          className={`nav-link ${pathname === "/lexicon" ? "active" : ""}`}
        >
          Lexicon
        </Link>
        <Link 
          href="/manage-matches" 
          className={`nav-link ${pathname === "/manage-matches" ? "active" : ""}`}
        >
          Matches
        </Link>
        <Link 
          href="/manage-events" 
          className={`nav-link ${pathname === "/manage-events" ? "active" : ""}`}
        >
          Events
        </Link>
        <Link 
          href="/datasets" 
          className={`nav-link ${pathname === "/datasets" ? "active" : ""}`}
        >
          Datasets
        </Link>
        <Link
          href="/predict"
          className={`nav-link ${pathname === "/predict" ? "active" : ""}`}
        >
          Predict
        </Link>
        <Link
          href="/label"
          className="nav-link-cta"
          onClick={() => setIsOpen(false)}
        >
          Import Dataset →
        </Link>
      </div>
    </nav>
  );
}
