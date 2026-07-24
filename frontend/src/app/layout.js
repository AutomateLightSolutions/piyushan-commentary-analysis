import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PipelineProvider } from "./PipelineContext";
import GlobalTerminal from "../components/GlobalTerminal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Rugby Highlight Analyzer",
  description: "Automated Video Transcription & Chunking Pipeline",
};

import Navbar from "../components/Navbar";

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PipelineProvider>
          <div className="layout-container">
            <Navbar />
            <main className="main-content">
              {children}
            </main>
            <GlobalTerminal />
          </div>
        </PipelineProvider>
      </body>
    </html>
  );
}
