"use client";

/**
 * PtyTerminal - Interactive PTY-based terminal for Tauri desktop.
 *
 * Uses xterm.js with a real PTY backend via Tauri commands.
 * Supports full interactive terminal features: cursor movement, colors, etc.
 *
 * For web/Next.js, falls back to read-only TerminalBubble display.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { getPlatformBridge } from "@/core/platform";

// xterm.js types - actual imports are dynamic (browser-only)
type XTerminal = import("@xterm/xterm").Terminal;
type XFitAddon = import("@xterm/addon-fit").FitAddon;

interface PtyTerminalProps {
  /** Command to run (default: shell) */
  command?: string;
  /** Command arguments */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Callback when terminal exits */
  onExit?: (exitCode: number) => void;
  /** Initial rows (default: 24) */
  rows?: number;
  /** Initial cols (default: 80) */
  cols?: number;
}

// Dark theme matching TerminalBubble
const TERMINAL_THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
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

export function PtyTerminal({
  command,
  args,
  cwd,
  env,
  onExit,
  rows = 24,
  cols = 80,
}: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const readLoopRef = useRef<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we're in Tauri
  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  // Initialize terminal and PTY session
  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current || !isTauri) return;

    try {
      // Dynamic imports
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      const fitAddon = new FitAddon();
      const terminal = new Terminal({
        fontFamily: '"SF Mono", Monaco, Menlo, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        allowTransparency: true,
        convertEol: true,
        theme: TERMINAL_THEME,
      });

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Create PTY session via Tauri
      const bridge = getPlatformBridge();
      const sessionId = await bridge.invoke<string>("pty_create", {
        command,
        args,
        cwd,
        env,
        rows: terminal.rows,
        cols: terminal.cols,
      });
      sessionIdRef.current = sessionId;

      // Handle user input -> PTY
      terminal.onData(async (data) => {
        if (sessionIdRef.current) {
          await bridge.invoke("pty_write", {
            sessionId: sessionIdRef.current,
            data,
          });
        }
      });

      // Handle resize
      terminal.onResize(async ({ rows, cols }) => {
        if (sessionIdRef.current) {
          await bridge.invoke("pty_resize", {
            sessionId: sessionIdRef.current,
            rows,
            cols,
          });
        }
      });

      // Start read loop
      const readLoop = async () => {
        if (!sessionIdRef.current) return;
        try {
          const data = await bridge.invoke<string | null>("pty_read", {
            sessionId: sessionIdRef.current,
          });
          if (data) {
            terminal.write(data);
          }
        } catch {
          // Session may have ended
        }
        readLoopRef.current = requestAnimationFrame(readLoop);
      };
      readLoopRef.current = requestAnimationFrame(readLoop);

      setInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [command, args, cwd, env, isTauri]);

  // Initialize on mount
  useEffect(() => {
    const timer = setTimeout(() => initTerminal(), 50);
    return () => clearTimeout(timer);
  }, [initTerminal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (readLoopRef.current) {
        cancelAnimationFrame(readLoopRef.current);
      }
      if (sessionIdRef.current && isTauri) {
        const bridge = getPlatformBridge();
        bridge.invoke("pty_kill", { sessionId: sessionIdRef.current }).catch(() => {});
      }
      terminalRef.current?.dispose();
    };
  }, [isTauri]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [initialized]);

  if (!isTauri) {
    return (
      <div className="p-4 bg-gray-800 text-gray-400 rounded-lg">
        <p>Interactive PTY terminal is only available in the desktop app.</p>
        <p className="text-sm mt-2">
          Use the web terminal for read-only output display.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">
        <p className="font-semibold">Terminal Error</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 bg-[#161b22] border-b border-gray-700 flex items-center gap-2">
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
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
        <span className="text-xs font-mono text-gray-300 truncate flex-1">
          {command || "Terminal"} {args?.join(" ") || ""}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {initialized ? "connected" : "connecting..."}
        </span>
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="w-full bg-[#0d1117]"
        style={{
          minHeight: "300px",
          maxHeight: "600px",
        }}
      />
    </div>
  );
}

