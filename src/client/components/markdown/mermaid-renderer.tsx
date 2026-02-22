"use client";

/**
 * MermaidRenderer - React component for rendering mermaid diagrams.
 *
 *   - Renders mermaid code into SVG
 *   - Supports fullscreen expansion
 *   - Auto-updates on theme change
 *   - Handles base64-encoded and HTML-entity-encoded input
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface MermaidRendererProps {
  code: string;
  className?: string;
  showExpandButton?: boolean;
}

// Decode base64 encoded mermaid code
function decodeBase64(str: string): string {
  try {
    if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
      return decodeURIComponent(escape(atob(str)));
    }
    return str;
  } catch {
    return str;
  }
}

// Decode HTML entities
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function MermaidRenderer({
  code,
  className = "",
  showExpandButton = true,
}: MermaidRendererProps) {
  const [renderedSvg, setRenderedSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderDiagram = useCallback(async (rawCode: string) => {
    const base64Decoded = decodeBase64(rawCode);
    const decodedCode = decodeHtmlEntities(base64Decoded);

    if (!decodedCode?.trim()) {
      setRenderedSvg("");
      setError(null);
      return;
    }

    try {
      // Dynamically import mermaid to avoid SSR issues
      const mermaid = (await import("mermaid")).default;

      const isDark = document.documentElement.classList.contains("dark");

      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "loose",
        fontFamily: "inherit",
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          curve: "linear",
          padding: 12,
        },
        sequence: {
          useMaxWidth: false,
          wrap: true,
          mirrorActors: false,
        },
        themeVariables: isDark
          ? {
              primaryColor: "hsl(240 3.7% 15.9%)",
              primaryTextColor: "hsl(0 0% 63.9%)",
              primaryBorderColor: "hsl(240 3.7% 25%)",
              lineColor: "hsl(240 3.7% 35%)",
              secondaryColor: "hsl(240 3.7% 12%)",
              tertiaryColor: "hsl(240 3.7% 10%)",
              background: "transparent",
              mainBkg: "hsl(240 3.7% 15.9%)",
              nodeBorder: "hsl(240 3.7% 25%)",
              clusterBkg: "hsl(240 3.7% 12%)",
              clusterBorder: "hsl(240 3.7% 25%)",
              titleColor: "hsl(0 0% 63.9%)",
              edgeLabelBackground: "hsl(240 3.7% 15.9%)",
              textColor: "hsl(0 0% 63.9%)",
              nodeTextColor: "hsl(0 0% 63.9%)",
            }
          : {
              primaryColor: "hsl(0 0% 96.1%)",
              primaryTextColor: "hsl(240 5.9% 30%)",
              primaryBorderColor: "hsl(240 5.9% 85%)",
              lineColor: "hsl(240 5.9% 70%)",
              secondaryColor: "hsl(0 0% 98%)",
              tertiaryColor: "hsl(0 0% 96%)",
              background: "transparent",
              mainBkg: "hsl(0 0% 96.1%)",
              nodeBorder: "hsl(240 5.9% 85%)",
              clusterBkg: "hsl(0 0% 98%)",
              clusterBorder: "hsl(240 5.9% 85%)",
              titleColor: "hsl(240 5.9% 30%)",
              edgeLabelBackground: "hsl(0 0% 96.1%)",
              textColor: "hsl(240 5.9% 30%)",
              nodeTextColor: "hsl(240 5.9% 30%)",
            },
      });

      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { svg } = await mermaid.render(id, decodedCode);
      setRenderedSvg(svg);
      setError(null);
    } catch (err) {
      console.error("[MermaidRenderer] Failed to render:", err);
      setError(err instanceof Error ? err.message : "Failed to render diagram");
      setRenderedSvg("");
    }
  }, []);

  useEffect(() => {
    if (code) {
      renderDiagram(code);
    }
  }, [code, renderDiagram]);

  // Re-render on theme change
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class" && code) {
          renderDiagram(code);
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [code, renderDiagram]);

  // Escape key to close fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isFullscreen]);

  if (error) {
    return (
      <div className={`mermaid-renderer ${className}`}>
        <div className="p-2 text-xs text-red-500">
          <pre className="font-mono whitespace-pre-wrap">{error}</pre>
          <details className="mt-2">
            <summary className="cursor-pointer opacity-70 text-[10px]">View source</summary>
            <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-[10px] overflow-x-auto">
              {decodeHtmlEntities(decodeBase64(code))}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  if (!renderedSvg) {
    if (!code?.trim()) {
      return (
        <div className={`mermaid-renderer ${className}`}>
          <div className="p-4 text-center text-sm text-gray-400">No diagram code</div>
        </div>
      );
    }
    return (
      <div className={`mermaid-renderer ${className}`}>
        <div className="flex justify-center items-center min-h-[60px]">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className={`mermaid-renderer relative group ${className}`}>
        <div
          className="flex justify-center items-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: renderedSvg }}
        />
        {showExpandButton && (
          <button
            onClick={() => setIsFullscreen(true)}
            className="absolute top-2 right-2 p-1.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title="Expand to fullscreen"
          >
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        )}
      </div>

      {/* Fullscreen overlay */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsFullscreen(false); }}
        >
          <div className="relative bg-white dark:bg-gray-900 rounded-lg w-[90vw] h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer"
              title="Close fullscreen"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div
              className="flex-1 flex items-center justify-center p-10 overflow-hidden [&_svg]:w-full [&_svg]:h-full"
              dangerouslySetInnerHTML={{ __html: renderedSvg }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default MermaidRenderer;
