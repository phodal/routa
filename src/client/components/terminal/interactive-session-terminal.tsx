"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

type XTerminal = import("@xterm/xterm").Terminal;
type XFitAddon = import("@xterm/addon-fit").FitAddon;

interface InteractiveSessionTerminalProps {
  acp: UseAcpState & UseAcpActions;
  sessionId: string;
  cwd?: string;
  title?: string;
}

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

export function InteractiveSessionTerminal({
  acp,
  sessionId,
  cwd,
  title = "Interactive terminal",
}: InteractiveSessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<XFitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const processedUpdatesRef = useRef(0);
  const outputLengthRef = useRef(0);
  const [initialized, setInitialized] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("starting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [buffer, setBuffer] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTerminal = useCallback(async () => {
    if (creating || terminalIdRef.current) return;
    setCreating(true);
    setError(null);

    const result = await acp.createTerminal(sessionId, {
      cwd,
      command: "/bin/bash",
      args: [],
      shell: false,
      env: {
        TERM: "xterm-256color",
      },
    });

    setCreating(false);
    if (!result?.terminalId) {
      setError("Failed to start terminal");
      setStatusText("failed");
      return;
    }

    terminalIdRef.current = result.terminalId;
    setTerminalId(result.terminalId);
    setStatusText("connected");
  }, [acp, creating, cwd, sessionId]);

  const stopTerminal = useCallback(async () => {
    if (!terminalIdRef.current) return;
    await acp.killTerminal(terminalIdRef.current);
  }, [acp]);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current) return;

    try {
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
        drawBoldTextInBrightColors: true,
        theme: TERMINAL_THEME,
      });

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminal.onData((data) => {
        const currentTerminalId = terminalIdRef.current;
        if (!currentTerminalId) return;
        terminal.write(data === "\r" ? "\r\n" : data);
        void acp.writeTerminal(currentTerminalId, data);
      });

      observerRef.current = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {
            // Ignore resize races during unmount.
          }
        });
      });
      observerRef.current.observe(containerRef.current);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      terminal.writeln("Connected to Kanban session shell");
      terminal.writeln("Type a command and press Enter.");
      setInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatusText("failed");
    }
  }, [acp]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void initTerminal();
    }, 50);
    return () => clearTimeout(timer);
  }, [initTerminal]);

  useEffect(() => {
    if (initialized) {
      void createTerminal();
    }
  }, [createTerminal, initialized]);

  useEffect(() => {
    if (acp.updates.length < processedUpdatesRef.current) {
      processedUpdatesRef.current = 0;
    }
    const nextUpdates = acp.updates.slice(processedUpdatesRef.current);
    processedUpdatesRef.current = acp.updates.length;

    for (const notification of nextUpdates) {
      if (notification.sessionId !== sessionId) continue;

      const update = notification.update as Record<string, unknown> | undefined;
      const kind = update?.sessionUpdate;
      const updateTerminalId = typeof update?.terminalId === "string" ? update.terminalId : undefined;

      if (kind === "terminal_created" && updateTerminalId && updateTerminalId === terminalIdRef.current) {
        setStatusText("connected");
      }

      if (kind === "terminal_output" && updateTerminalId && updateTerminalId === terminalIdRef.current) {
        const data = typeof update?.data === "string" ? update.data : "";
        if (data) {
          setBuffer((current) => current + data);
        }
      }

      if (kind === "terminal_exited" && updateTerminalId && updateTerminalId === terminalIdRef.current) {
        const nextExitCode = typeof update?.exitCode === "number" ? update.exitCode : 0;
        setExitCode(nextExitCode);
        setStatusText(nextExitCode === 0 ? "completed" : `failed (${nextExitCode})`);
      }
    }
  }, [acp.updates, sessionId]);

  useEffect(() => {
    if (!terminalRef.current || !buffer) return;

    const newData = buffer.slice(outputLengthRef.current);
    if (!newData) return;

    terminalRef.current.write(newData);
    outputLengthRef.current = buffer.length;
  }, [buffer]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      fitAddonRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
    };
  }, []);

  const statusTone = useMemo(() => {
    if (statusText === "connected") return "bg-green-500";
    if (statusText.startsWith("failed")) return "bg-red-500";
    if (statusText === "completed") return "bg-slate-400";
    return "bg-yellow-500 animate-pulse";
  }, [statusText]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0d1117]"
      data-testid="kanban-interactive-terminal"
    >
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${statusTone}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-100">{title}</div>
          <div className="truncate text-[11px] text-slate-400">
            {cwd ?? "session cwd"} {terminalId ? `- ${terminalId}` : ""}
          </div>
        </div>
        <div className="text-[11px] text-slate-400">
          {exitCode !== null ? `exit ${exitCode}` : statusText}
        </div>
        <button
          type="button"
          onClick={() => void stopTerminal()}
          className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          disabled={!terminalId}
        >
          Stop
        </button>
      </div>
      {error ? (
        <div className="px-3 py-3 text-sm text-red-300">{error}</div>
      ) : (
        <div
          ref={containerRef}
          className="min-h-0 flex-1 bg-[#0d1117]"
          style={{ minHeight: "240px" }}
        />
      )}
    </div>
  );
}
