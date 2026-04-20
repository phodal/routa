"use client";

/**
 * AG-UI Protocol Test Page
 *
 * Standalone page for testing AG-UI protocol integration.
 * Features:
 * - Send prompts via AG-UI protocol (POST /api/ag-ui)
 * - View streaming AG-UI events in real-time
 * - Protocol switcher: toggle between ACP (native) and AG-UI
 * - Event inspector showing raw AG-UI events
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { v4 as uuidv4 } from "uuid";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { ChevronLeft, X, MessageSquare, RefreshCw } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


// ── Types ──────────────────────────────────────────────────────────────────

interface AGUIEvent {
  type: string;
  timestamp?: number;
  messageId?: string;
  delta?: string;
  role?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: string;
  threadId?: string;
  runId?: string;
  message?: string;
  code?: string;
  name?: string;
  value?: unknown;
  [key: string]: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "reasoning" | "tool" | "system";
  content: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  isStreaming?: boolean;
}

type ProtocolMode = "ag-ui" | "acp";

// ── Event type colors ──────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  RUN_STARTED:              { bg: "bg-emerald-50 dark:bg-emerald-950/30",   text: "text-emerald-700 dark:text-emerald-300",  border: "border-emerald-200 dark:border-emerald-800" },
  RUN_FINISHED:             { bg: "bg-emerald-50 dark:bg-emerald-950/30",   text: "text-emerald-700 dark:text-emerald-300",  border: "border-emerald-200 dark:border-emerald-800" },
  RUN_ERROR:                { bg: "bg-red-50 dark:bg-red-950/30",           text: "text-red-700 dark:text-red-300",          border: "border-red-200 dark:border-red-800" },
  TEXT_MESSAGE_START:        { bg: "bg-blue-50 dark:bg-blue-950/30",         text: "text-blue-700 dark:text-blue-300",        border: "border-blue-200 dark:border-blue-800" },
  TEXT_MESSAGE_CONTENT:      { bg: "bg-blue-50 dark:bg-blue-950/20",         text: "text-blue-600 dark:text-blue-400",        border: "border-blue-100 dark:border-blue-900" },
  TEXT_MESSAGE_END:          { bg: "bg-blue-50 dark:bg-blue-950/30",         text: "text-blue-700 dark:text-blue-300",        border: "border-blue-200 dark:border-blue-800" },
  TOOL_CALL_START:           { bg: "bg-amber-50 dark:bg-amber-950/30",       text: "text-amber-700 dark:text-amber-300",      border: "border-amber-200 dark:border-amber-800" },
  TOOL_CALL_ARGS:            { bg: "bg-amber-50 dark:bg-amber-950/20",       text: "text-amber-600 dark:text-amber-400",      border: "border-amber-100 dark:border-amber-900" },
  TOOL_CALL_END:             { bg: "bg-amber-50 dark:bg-amber-950/30",       text: "text-amber-700 dark:text-amber-300",      border: "border-amber-200 dark:border-amber-800" },
  TOOL_CALL_RESULT:          { bg: "bg-amber-50 dark:bg-amber-950/30",     text: "text-amber-700 dark:text-amber-300",    border: "border-amber-200 dark:border-amber-800" },
  REASONING_START:           { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-700 dark:text-slate-300",      border: "border-slate-200 dark:border-slate-800" },
  REASONING_MESSAGE_START:   { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-700 dark:text-slate-300",      border: "border-slate-200 dark:border-slate-800" },
  REASONING_MESSAGE_CONTENT: { bg: "bg-slate-50 dark:bg-slate-950/20",       text: "text-slate-600 dark:text-slate-400",      border: "border-slate-100 dark:border-slate-900" },
  REASONING_MESSAGE_END:     { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-700 dark:text-slate-300",      border: "border-slate-200 dark:border-slate-800" },
  REASONING_END:             { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-700 dark:text-slate-300",      border: "border-slate-200 dark:border-slate-800" },
  CUSTOM:                    { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-700 dark:text-slate-300",      border: "border-slate-200 dark:border-slate-800" },
  RAW:                       { bg: "bg-slate-50 dark:bg-slate-950/30",       text: "text-slate-600 dark:text-slate-400",      border: "border-slate-200 dark:border-slate-800" },
};

const DEFAULT_EVENT_COLOR = { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-600 dark:text-slate-400", border: "border-slate-200 dark:border-slate-800" };

// ── Sub-components ─────────────────────────────────────────────────────────

function ProtocolToggle({
  mode,
  onChange,
}: {
  mode: ProtocolMode;
  onChange: (mode: ProtocolMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-0.5">
      <button
        data-testid="protocol-toggle-ag-ui"
        onClick={() => onChange("ag-ui")}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
          mode === "ag-ui"
            ? "bg-blue-500 text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        }`}
      >
        AG-UI
      </button>
      <button
        data-testid="protocol-toggle-acp"
        onClick={() => onChange("acp")}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
          mode === "acp"
            ? "bg-emerald-500 text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        }`}
      >
        ACP
      </button>
    </div>
  );
}

function EventCard({ event, index }: { event: AGUIEvent; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const colors = EVENT_COLORS[event.type] ?? DEFAULT_EVENT_COLOR;

  // Compute a summary for the event
  let summary = "";
  if (event.delta) {
    summary = event.delta.length > 80 ? event.delta.slice(0, 80) + "…" : event.delta;
  } else if (event.message) {
    summary = event.message;
  } else if (event.toolCallName) {
    summary = event.toolCallName;
  } else if (event.content) {
    summary = typeof event.content === "string"
      ? event.content.slice(0, 80) + (event.content.length > 80 ? "…" : "")
      : "";
  }

  return (
    <div
      className={`rounded-md border ${colors.border} ${colors.bg} px-3 py-2 transition-all hover:shadow-sm cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 text-right text-[10px] text-slate-400 dark:text-slate-600 font-mono tabular-nums flex-shrink-0">
          {index + 1}
        </span>
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${colors.text} ${colors.bg} border ${colors.border}`}>
          {event.type}
        </span>
        {event.messageId && (
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 truncate max-w-[100px]">
            {event.messageId.slice(0, 8)}
          </span>
        )}
        {event.toolCallId && (
          <span className="text-[10px] font-mono text-amber-500 dark:text-amber-400 truncate max-w-[100px]">
            {event.toolCallId.slice(0, 8)}
          </span>
        )}
        {summary && (
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">
            {summary}
          </span>
        )}
        <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono flex-shrink-0">
          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}
        </span>
      </div>
      {expanded && (
        <pre className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 bg-white/50 dark:bg-black/20 rounded p-2 overflow-x-auto font-mono leading-relaxed">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-500 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "reasoning") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm leading-relaxed italic text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
          <span className="mb-1 block text-[10px] font-bold tracking-wider text-slate-500 dark:text-slate-400">REASONING</span>
          {message.content}
          {message.isStreaming && <span className="ml-0.5 inline-block h-4 w-1.5 rounded-sm bg-slate-400 animate-pulse dark:bg-slate-500" />}
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[90%] rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-sm leading-relaxed">
          <span className="text-[10px] font-bold tracking-wider text-amber-600 dark:text-amber-400 block mb-1">
            TOOL: {message.toolName ?? message.toolCallId ?? "unknown"}
          </span>
          <pre className="text-xs text-slate-600 dark:text-slate-300 font-mono whitespace-pre-wrap break-words">
            {message.content.length > 500 ? message.content.slice(0, 500) + "…" : message.content}
          </pre>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 leading-relaxed shadow-sm">
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.isStreaming && <span className="inline-block w-1.5 h-4 bg-slate-400 dark:bg-slate-500 ml-0.5 animate-pulse rounded-sm" />}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function AGUIPage() {
  const workspacesHook = useWorkspaces();
  const [protocolMode, setProtocolMode] = useState<ProtocolMode>("ag-ui");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [threadId] = useState(() => uuidv4());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AGUIEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [showEvents, setShowEvents] = useState(true);
  const [error, setError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (selectedWorkspaceId || workspacesHook.workspaces.length === 0) return;
    setSelectedWorkspaceId(workspacesHook.workspaces[0].id);
  }, [selectedWorkspaceId, workspacesHook.workspaces]);

  // Track streaming message state with refs for SSE callback
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // ── AG-UI Protocol send ──
  const sendViaAGUI = useCallback(
    async (text: string) => {
      if (!selectedWorkspaceId) {
        throw new Error("Select a workspace before using AG-UI mode");
      }

      const runId = uuidv4();
      const userMsgId = uuidv4();

      // Build RunAgentInput
      const input = {
        threadId,
        runId,
        state: {},
        messages: [
          ...messagesRef.current
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            })),
          { id: userMsgId, role: "user", content: text },
        ],
        tools: [],
        context: [],
        forwardedProps: {
          workspaceId: selectedWorkspaceId,
        },
      };

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await desktopAwareFetch("/api/ag-ui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`AG-UI request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Track current streaming messages by messageId
      const streamingMessages = new Map<string, string>(); // messageId -> role
      let currentAssistantId: string | null = null;
      let currentReasoningId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event: AGUIEvent = JSON.parse(json);
            setEvents((prev) => [...prev, event]);
            setEventCount((c) => c + 1);

            // Process event into chat messages
            switch (event.type) {
              case "TEXT_MESSAGE_START":
                currentAssistantId = event.messageId ?? uuidv4();
                streamingMessages.set(currentAssistantId, "assistant");
                setMessages((prev) => [
                  ...prev,
                  {
                    id: currentAssistantId!,
                    role: "assistant",
                    content: "",
                    timestamp: event.timestamp ?? Date.now(),
                    isStreaming: true,
                  },
                ]);
                break;

              case "TEXT_MESSAGE_CONTENT":
                if (event.messageId && event.delta) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.messageId
                        ? { ...m, content: m.content + event.delta! }
                        : m,
                    ),
                  );
                }
                break;

              case "TEXT_MESSAGE_END":
                if (event.messageId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.messageId
                        ? { ...m, isStreaming: false }
                        : m,
                    ),
                  );
                  streamingMessages.delete(event.messageId);
                  if (currentAssistantId === event.messageId) {
                    currentAssistantId = null;
                  }
                }
                break;

              case "REASONING_MESSAGE_START":
                currentReasoningId = event.messageId ?? uuidv4();
                streamingMessages.set(currentReasoningId, "reasoning");
                setMessages((prev) => [
                  ...prev,
                  {
                    id: currentReasoningId!,
                    role: "reasoning",
                    content: "",
                    timestamp: event.timestamp ?? Date.now(),
                    isStreaming: true,
                  },
                ]);
                break;

              case "REASONING_MESSAGE_CONTENT":
                if (event.messageId && event.delta) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.messageId
                        ? { ...m, content: m.content + event.delta! }
                        : m,
                    ),
                  );
                }
                break;

              case "REASONING_MESSAGE_END":
                if (event.messageId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.messageId
                        ? { ...m, isStreaming: false }
                        : m,
                    ),
                  );
                  streamingMessages.delete(event.messageId);
                  if (currentReasoningId === event.messageId) {
                    currentReasoningId = null;
                  }
                }
                break;

              case "TOOL_CALL_START":
                setMessages((prev) => [
                  ...prev,
                  {
                    id: event.toolCallId ?? uuidv4(),
                    role: "tool",
                    content: "",
                    timestamp: event.timestamp ?? Date.now(),
                    toolName: event.toolCallName,
                    toolCallId: event.toolCallId,
                    isStreaming: true,
                  },
                ]);
                break;

              case "TOOL_CALL_ARGS":
                if (event.toolCallId && event.delta) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.toolCallId
                        ? { ...m, content: m.content + event.delta! }
                        : m,
                    ),
                  );
                }
                break;

              case "TOOL_CALL_END":
                if (event.toolCallId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.toolCallId
                        ? { ...m, isStreaming: false }
                        : m,
                    ),
                  );
                }
                break;

              case "TOOL_CALL_RESULT":
                if (event.toolCallId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === event.toolCallId
                        ? {
                            ...m,
                            content: event.content ?? m.content,
                            isStreaming: false,
                          }
                        : m,
                    ),
                  );
                }
                break;

              case "RUN_ERROR":
                setError(event.message ?? "Unknown error");
                break;
            }
          } catch {
            // Skip unparseable events
          }
        }
      }
    },
    [selectedWorkspaceId, threadId],
  );

  // ── ACP Protocol send (for comparison) ──
  const sendViaACP = useCallback(
    async (text: string) => {
      if (!selectedWorkspaceId) {
        throw new Error("Select a workspace before using ACP mode");
      }
      // Use existing ACP endpoint in JSON-RPC format
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 1. Initialize
      await desktopAwareFetch("/api/acp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        }),
        signal: controller.signal,
      });

      // 2. Create session
      const sessionRes = await desktopAwareFetch("/api/acp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: { role: "CRAFTER", workspaceId: selectedWorkspaceId },
        }),
        signal: controller.signal,
      });
      const sessionData = await sessionRes.json();
      const sessionId = sessionData?.result?.sessionId;
      if (!sessionId) throw new Error("Failed to create ACP session");

      // 3. Send prompt (streaming SSE response)
      const promptRes = await desktopAwareFetch("/api/acp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "session/prompt",
          params: { sessionId, prompt: text },
        }),
        signal: controller.signal,
      });

      if (!promptRes.body) {
        throw new Error("ACP prompt: no response body");
      }

      // Read SSE stream
      const reader = promptRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const parsed = JSON.parse(json);
            const update = parsed?.params?.update || parsed?.params || parsed;
            const sessionUpdate = update?.sessionUpdate;

            // Convert ACP updates to simple events for display
            const acpEvent: AGUIEvent = {
              type: `ACP:${sessionUpdate ?? "unknown"}`,
              timestamp: Date.now(),
              ...update,
            };
            setEvents((prev) => [...prev, acpEvent]);
            setEventCount((c) => c + 1);

            // Handle message content
            if (sessionUpdate === "agent_message_chunk") {
              const contentText = update.content?.text ?? "";
              if (contentText) {
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
                    return prev.map((m, i) =>
                      i === prev.length - 1
                        ? { ...m, content: m.content + contentText }
                        : m,
                    );
                  }
                  return [
                    ...prev,
                    {
                      id: uuidv4(),
                      role: "assistant",
                      content: contentText,
                      timestamp: Date.now(),
                      isStreaming: true,
                    },
                  ];
                });
              }
            } else if (sessionUpdate === "turn_complete") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.isStreaming ? { ...m, isStreaming: false } : m,
                ),
              );
            } else if (sessionUpdate === "agent_thought_chunk") {
              const thinkText = update.content?.text ?? "";
              if (thinkText) {
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg?.role === "reasoning" && lastMsg.isStreaming) {
                    return prev.map((m, i) =>
                      i === prev.length - 1
                        ? { ...m, content: m.content + thinkText }
                        : m,
                    );
                  }
                  return [
                    ...prev,
                    {
                      id: uuidv4(),
                      role: "reasoning",
                      content: thinkText,
                      timestamp: Date.now(),
                      isStreaming: true,
                    },
                  ];
                });
              }
            } else if (sessionUpdate === "tool_call") {
              setMessages((prev) => [
                ...prev,
                {
                  id: update.toolCallId ?? uuidv4(),
                  role: "tool",
                  content: JSON.stringify(update.input ?? {}, null, 2),
                  timestamp: Date.now(),
                  toolName: update.toolName,
                  toolCallId: update.toolCallId,
                  isStreaming: true,
                },
              ]);
            }
          } catch {
            // Skip
          }
        }
      }
    },
    [selectedWorkspaceId],
  );

  // ── Send handler ──
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || sending) return;

    const text = prompt.trim();
    setPrompt("");
    setSending(true);
    setError("");

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        id: uuidv4(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      },
    ]);

    try {
      if (protocolMode === "ag-ui") {
        await sendViaAGUI(text);
      } else {
        await sendViaACP(text);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setSending(false);
  };

  const handleClear = () => {
    setMessages([]);
    setEvents([]);
    setEventCount(0);
    setError("");
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <ChevronLeft viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"/>
            </Link>
            <div>
              <h1
                data-testid="ag-ui-page-title"
                className="text-lg font-bold tracking-tight"
              >
                AG-UI Protocol
              </h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-tight">
                Agent-User Interaction Protocol Test
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ProtocolToggle mode={protocolMode} onChange={setProtocolMode} />

            <WorkspaceSwitcher
              workspaces={workspacesHook.workspaces}
              activeWorkspaceId={selectedWorkspaceId || null}
              onSelect={setSelectedWorkspaceId}
              onCreate={async (title) => {
                const workspace = await workspacesHook.createWorkspace(title);
                if (workspace?.id) {
                  setSelectedWorkspaceId(workspace.id);
                }
              }}
              loading={workspacesHook.loading}
            />

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 dark:bg-[#1e2130] text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className={`w-1.5 h-1.5 rounded-full ${sending ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              {protocolMode === "ag-ui" ? "AG-UI" : "ACP"}
              <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px]">
                {protocolMode === "ag-ui" ? "/api/ag-ui" : "/api/acp"}
              </span>
            </div>

            <span
              data-testid="event-counter"
              className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums"
            >
              {eventCount} events
            </span>

            <button
              onClick={handleClear}
              className="text-xs text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex gap-4" style={{ height: "calc(100vh - 64px)" }}>
        {/* Chat Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div
            data-testid="chat-messages"
            className="flex-1 overflow-y-auto px-2 py-4 space-y-1"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600">
                <MessageSquare viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 mb-3 opacity-50"/>
                <p className="text-sm font-medium">
                  Send a message to test the {protocolMode === "ag-ui" ? "AG-UI" : "ACP"} protocol
                </p>
                <p className="text-xs mt-1 text-slate-400 dark:text-slate-600">
                  Switch between protocols using the toggle above
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {error && (
              <div className="mx-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSend}
            className="border-t border-slate-200 dark:border-slate-800 px-2 py-3 flex gap-2"
          >
            <input
              data-testid="ag-ui-input"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Send via ${protocolMode === "ag-ui" ? "AG-UI" : "ACP"} protocol…`}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-600 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600"
              disabled={sending}
            />
            {sending ? (
              <button
                type="button"
                onClick={handleCancel}
                data-testid="cancel-button"
                className="rounded-xl bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                data-testid="send-button"
                disabled={!prompt.trim()}
                className="rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </form>
        </div>

        {/* Event Inspector Panel */}
        <div
          className={`transition-all ${showEvents ? "w-[420px]" : "w-0"} flex-shrink-0 overflow-hidden`}
        >
          <div className="h-full flex flex-col border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
                  Event Inspector
                </h2>
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 tabular-nums">
                  ({eventCount})
                </span>
              </div>
              <button
                onClick={() => setShowEvents(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"/>
              </button>
            </div>

            <div
              data-testid="event-inspector"
              className="flex-1 overflow-y-auto p-2 space-y-1"
            >
              {events.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-600 text-center py-8">
                  No events yet. Send a message to see AG-UI events stream here.
                </p>
              )}
              {events.map((event, i) => (
                <EventCard key={i} event={event} index={i} />
              ))}
              <div ref={eventsEndRef} />
            </div>
          </div>
        </div>

        {/* Show events button when panel is hidden */}
        {!showEvents && (
          <button
            onClick={() => setShowEvents(true)}
            className="fixed bottom-6 right-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-3 shadow-lg transition-all hover:scale-105"
          >
            <RefreshCw viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"/>
          </button>
        )}
      </main>
    </div>
  );
}
