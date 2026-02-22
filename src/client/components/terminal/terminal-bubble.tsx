"use client";

/**
 * TerminalBubble - xterm.js based terminal renderer for ACP terminal output.
 *
 * Renders terminal output inline in the chat panel using xterm.js.
 * Supports ANSI escape codes, colors, and proper terminal rendering.
 *
 * Inspired by the TerminalAdapter from intent-0.2.4.
 */

import { useRef, useEffect, useState, useCallback } from "react";

// xterm.js types - actual imports are dynamic (browser-only)
type XTerminal = import("@xterm/xterm").Terminal;
type XFitAddon = import("@xterm/addon-fit").FitAddon;

// xterm CSS will be loaded dynamically alongside the Terminal

interface TerminalBubbleProps {
  /** Unique terminal identifier */
  terminalId: string;
  /** Command that was executed */
  command?: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Accumulated terminal output data (ANSI-encoded) */
  data: string;
  /** Whether the terminal process has exited */
  exited?: boolean;
  /** Process exit code (if exited) */
  exitCode?: number | null;
}

// Dark theme matching the reference TerminalAdapter
const TERMINAL_THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#264f7850",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

export function TerminalBubble({
  terminalId,
  command,
  args,
  data,
  exited,
  exitCode,
}: TerminalBubbleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const writtenLengthRef = useRef(0);
  const [expanded, setExpanded] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Initialize xterm.js (dynamic import for SSR compatibility)
  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current) return;

    try {
      // Dynamic imports - xterm.js requires DOM
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      // xterm CSS is loaded globally via globals.css (@import "@xterm/xterm/css/xterm.css")

      const fitAddon = new FitAddon();

      const terminal = new Terminal({
        fontFamily: '"SF Mono", Monaco, Menlo, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.3,
        letterSpacing: 0,
        cursorBlink: false,
        cursorStyle: "block",
        scrollback: 5000,
        allowTransparency: true,
        convertEol: true,
        drawBoldTextInBrightColors: true,
        disableStdin: true, // Read-only terminal display
        theme: TERMINAL_THEME,
      });

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);

      // Fit to container
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        fitAddon.fit();
      } else {
        setTimeout(() => fitAddon.fit(), 100);
      }

      // Setup resize observer
      const observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {
            // ignore fit errors
          }
        });
      });
      observer.observe(containerRef.current);
      resizeObserverRef.current = observer;

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      writtenLengthRef.current = 0;
      setInitialized(true);
    } catch (err) {
      console.error("[TerminalBubble] Failed to initialize xterm:", err);
    }
  }, []);

  // Initialize when expanded
  useEffect(() => {
    if (expanded) {
      // Small delay to ensure container is rendered
      const timer = setTimeout(() => initTerminal(), 50);
      return () => clearTimeout(timer);
    }
  }, [expanded, initTerminal]);

  // Write new data to terminal (incremental)
  useEffect(() => {
    if (!terminalRef.current || !initialized) return;

    const newData = data.slice(writtenLengthRef.current);
    if (newData) {
      terminalRef.current.write(newData);
      writtenLengthRef.current = data.length;
    }
  }, [data, initialized]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Build display label
  const cmdLabel = command
    ? args?.length
      ? `${command} ${args.join(" ")}`
      : command
    : "Terminal";

  const statusColor = exited
    ? exitCode === 0
      ? "bg-green-500"
      : "bg-red-500"
    : "bg-yellow-500 animate-pulse";

  const statusText = exited
    ? exitCode === 0
      ? "completed"
      : `failed (${exitCode})`
    : "running";

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] w-full rounded-lg border border-gray-700 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-1.5 bg-[#161b22] border-b border-gray-700 flex items-center gap-2 text-left"
        >
          {/* Terminal icon */}
          <svg
            className="w-3.5 h-3.5 text-green-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-xs font-mono text-gray-300 truncate flex-1">
            {cmdLabel}
          </span>
          <span className="text-[10px] text-gray-500 shrink-0">
            {statusText}
          </span>
          <svg
            className={`w-3 h-3 text-gray-500 transition-transform duration-150 shrink-0 ${
              expanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>

        {/* Terminal content */}
        {expanded && (
          <div
            ref={containerRef}
            className="w-full bg-[#0d1117]"
            style={{
              minHeight: "120px",
              maxHeight: "400px",
              overflow: "hidden",
            }}
          />
        )}
      </div>
    </div>
  );
}
