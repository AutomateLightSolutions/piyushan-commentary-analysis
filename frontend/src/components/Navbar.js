"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="navbar">
      <Link href="/" className="nav-brand">
        Rugby Highlight Analyzer
      </Link>
      <div className="nav-links">
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
          href="/label" 
          className="nav-link-cta"
        >
          Manual Labeling →
        </Link>
      </div>
    </nav>
  );
}
