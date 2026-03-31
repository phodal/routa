"use client";

/**
 * AG-UI Trace Panel — Replays TraceRecords through RoutaToAGUIAdapter
 * and renders AGUIBaseEvent[] as an AG-UI protocol event timeline.
 *
 * This shows how the same trace data would look when pushed through the
 * AG-UI protocol — useful for testing and verifying the AG-UI adapter.
 */

import { useMemo, useState } from "react";
import type { TraceRecord } from "@/core/trace";
import type { AGUIBaseEvent } from "@/core/ag-ui/event-adapter";
import { AGUIEventType } from "@/core/ag-ui/event-adapter";
import { replayTracesAsAGUI } from "@/core/trace/trace-replay";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { useTranslation } from "@/i18n";

// ─── Event colors (same as ag-ui page) ────────────────────────────────────

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  RUN_STARTED: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800" },
  RUN_FINISHED: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800" },
  RUN_ERROR: { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-300", border: "border-red-200 dark:border-red-800" },
  TEXT_MESSAGE_START: { bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800" },
  TEXT_MESSAGE_CONTENT: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-600 dark:text-blue-400", border: "border-blue-100 dark:border-blue-900" },
  TEXT_MESSAGE_END: { bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800" },
  TOOL_CALL_START: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800" },
  TOOL_CALL_ARGS: { bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-600 dark:text-amber-400", border: "border-amber-100 dark:border-amber-900" },
  TOOL_CALL_END: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800" },
  TOOL_CALL_RESULT: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800" },
  REASONING_START: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  REASONING_MESSAGE_START: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  REASONING_MESSAGE_CONTENT: { bg: "bg-slate-50 dark:bg-slate-950/20", text: "text-slate-600 dark:text-slate-400", border: "border-slate-100 dark:border-slate-900" },
  REASONING_MESSAGE_END: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  REASONING_END: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  STEP_STARTED: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  STEP_FINISHED: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  CUSTOM: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800" },
  RAW: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-600 dark:text-slate-400", border: "border-slate-200 dark:border-slate-800" },
};
const DEFAULT_EVENT_COLOR = { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-600 dark:text-slate-400", border: "border-slate-200 dark:border-slate-800" };

// ─── AG-UI Event grouping (assemble messages from chunks) ─────────────────

interface AssembledMessage {
  kind: "user" | "assistant" | "reasoning" | "tool_result";
  content: string;
  messageId?: string;
  toolCallId?: string;
  toolName?: string;
}

interface ToolCallGroup {
  toolCallId: string;
  toolName: string;
  args: string;
  result?: string;
}

type DisplayItem =
  | { type: "lifecycle"; event: AGUIBaseEvent }
  | { type: "message"; message: AssembledMessage }
  | { type: "tool"; tool: ToolCallGroup }
  | { type: "custom"; event: AGUIBaseEvent };

/**
 * Assemble raw AG-UI events into higher-level display items.
 * This reconstructs messages from START/CONTENT/END triplets,
 * and groups tool calls with their results.
 */
function assembleDisplayItems(events: AGUIBaseEvent[]): DisplayItem[] {
  const items: DisplayItem[] = [];

  // Track in-flight messages and tool calls
  const messageBuilders = new Map<string, { role: string; chunks: string[] }>();
  const reasoningBuilders = new Map<string, string[]>();
  const toolCalls = new Map<string, ToolCallGroup>();

  for (const evt of events) {
    switch (evt.type) {
      case AGUIEventType.RUN_STARTED:
      case AGUIEventType.RUN_FINISHED:
      case AGUIEventType.RUN_ERROR:
        items.push({ type: "lifecycle", event: evt });
        break;

      case AGUIEventType.TEXT_MESSAGE_START: {
        const mid = (evt.messageId as string) ?? "";
        messageBuilders.set(mid, { role: (evt.role as string) ?? "assistant", chunks: [] });
        break;
      }
      case AGUIEventType.TEXT_MESSAGE_CONTENT: {
        const mid = (evt.messageId as string) ?? "";
        const builder = messageBuilders.get(mid);
        if (builder) {
          builder.chunks.push((evt.delta as string) ?? "");
        }
        break;
      }
      case AGUIEventType.TEXT_MESSAGE_END: {
        const mid = (evt.messageId as string) ?? "";
        const builder = messageBuilders.get(mid);
        if (builder) {
          items.push({
            type: "message",
            message: {
              kind: builder.role === "user" ? "user" : "assistant",
              content: builder.chunks.join(""),
              messageId: mid,
            },
          });
          messageBuilders.delete(mid);
        }
        break;
      }

      case AGUIEventType.REASONING_START:
      case AGUIEventType.REASONING_MESSAGE_START: {
        const mid = (evt.messageId as string) ?? "";
        if (!reasoningBuilders.has(mid)) {
          reasoningBuilders.set(mid, []);
        }
        break;
      }
      case AGUIEventType.REASONING_MESSAGE_CONTENT: {
        const mid = (evt.messageId as string) ?? "";
        const builder = reasoningBuilders.get(mid);
        if (builder) {
          builder.push((evt.delta as string) ?? "");
        }
        break;
      }
      case AGUIEventType.REASONING_MESSAGE_END:
      case AGUIEventType.REASONING_END: {
        const mid = (evt.messageId as string) ?? "";
        const builder = reasoningBuilders.get(mid);
        if (builder && builder.length > 0) {
          items.push({
            type: "message",
            message: {
              kind: "reasoning",
              content: builder.join(""),
              messageId: mid,
            },
          });
          reasoningBuilders.delete(mid);
        }
        break;
      }

      case AGUIEventType.TOOL_CALL_START: {
        const tcId = (evt.toolCallId as string) ?? "";
        toolCalls.set(tcId, {
          toolCallId: tcId,
          toolName: (evt.toolCallName as string) ?? "unknown",
          args: "",
        });
        break;
      }
      case AGUIEventType.TOOL_CALL_ARGS: {
        const tcId = (evt.toolCallId as string) ?? "";
        const tc = toolCalls.get(tcId);
        if (tc) {
          tc.args += (evt.delta as string) ?? "";
        }
        break;
      }
      case AGUIEventType.TOOL_CALL_END: {
        // Tool call ended — will be flushed when result arrives or at the end
        break;
      }
      case AGUIEventType.TOOL_CALL_RESULT: {
        const tcId = (evt.toolCallId as string) ?? "";
        const tc = toolCalls.get(tcId);
        if (tc) {
          tc.result = (evt.content as string) ?? "";
          items.push({ type: "tool", tool: { ...tc } });
          toolCalls.delete(tcId);
        } else {
          // Orphan result
          items.push({
            type: "tool",
            tool: {
              toolCallId: tcId,
              toolName: "unknown",
              args: "",
              result: (evt.content as string) ?? "",
            },
          });
        }
        break;
      }

      case AGUIEventType.STEP_STARTED:
      case AGUIEventType.STEP_FINISHED:
      case AGUIEventType.CUSTOM:
      case AGUIEventType.RAW:
        items.push({ type: "custom", event: evt });
        break;

      default:
        break;
    }
  }

  // Flush remaining tool calls without results
  for (const tc of toolCalls.values()) {
    items.push({ type: "tool", tool: tc });
  }

  // Flush remaining message builders
  for (const [mid, builder] of messageBuilders.entries()) {
    if (builder.chunks.length > 0) {
      items.push({
        type: "message",
        message: {
          kind: builder.role === "user" ? "user" : "assistant",
          content: builder.chunks.join(""),
          messageId: mid,
        },
      });
    }
  }

  // Flush remaining reasoning builders
  for (const [mid, chunks] of reasoningBuilders.entries()) {
    if (chunks.length > 0) {
      items.push({
        type: "message",
        message: {
          kind: "reasoning",
          content: chunks.join(""),
          messageId: mid,
        },
      });
    }
  }

  return items;
}

// ─── Sub-components ───────────────────────────────────────────────────────

function EventCard({ event }: { event: AGUIBaseEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = EVENT_COLORS[event.type] ?? DEFAULT_EVENT_COLOR;
  const ts = event.timestamp ? new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions) : "";

  // Extract summary
  const summaryParts: string[] = [];
  if (event.delta) summaryParts.push(`"${String(event.delta).slice(0, 50)}${String(event.delta).length > 50 ? "..." : ""}"`);
  if (event.messageId) summaryParts.push(`msg:${String(event.messageId).slice(0, 8)}`);
  if (event.toolCallId) summaryParts.push(`tc:${String(event.toolCallId).slice(0, 8)}`);
  if (event.toolCallName) summaryParts.push(String(event.toolCallName));

  return (
    <div className={`px-2 py-1 rounded border text-[10px] ${color.bg} ${color.border}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className={`font-mono font-semibold ${color.text}`}>{event.type}</span>
        <span className="text-slate-400 truncate flex-1">{summaryParts.join(" | ")}</span>
        <span className="text-slate-400 shrink-0">{ts}</span>
        <svg className={`w-2.5 h-2.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <pre className="mt-1 text-[9px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-40 overflow-auto border-t border-slate-200 dark:border-slate-700 pt-1">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AGUILifecycleBar({ event }: { event: AGUIBaseEvent }) {
  const color = EVENT_COLORS[event.type] ?? DEFAULT_EVENT_COLOR;
  const label = event.type === AGUIEventType.RUN_STARTED ? "Run Started"
    : event.type === AGUIEventType.RUN_FINISHED ? "Run Finished"
      : event.type === AGUIEventType.RUN_ERROR ? "Run Error"
        : event.type;

  const detail = event.type === AGUIEventType.RUN_ERROR ? (event.message as string) ?? "" : "";

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${color.bg} ${color.border}`}>
      <span className={`text-xs font-semibold ${color.text}`}>{label}</span>
      {detail && <span className="text-[10px] text-red-500">{detail}</span>}
    </div>
  );
}

function AGUIUserBubble({ message }: { message: AssembledMessage }) {
  return (
    <div className="flex items-start gap-3 group">
      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        <span className="text-sm">👤</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">User</span>
        </div>
        <div className="px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {message.content || <span className="italic text-slate-400">(empty)</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function AGUIAssistantBubble({ message }: { message: AssembledMessage }) {
  return (
    <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
      <MarkdownViewer content={message.content || ""} className="text-sm" />
    </div>
  );
}

function AGUIReasoningBubble({ message }: { message: AssembledMessage }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="group my-1 flex w-full items-start gap-2 rounded-lg border border-slate-100/50 bg-slate-50/50 px-3 py-1.5 text-left transition-colors hover:bg-slate-100/70 dark:border-slate-800/20 dark:bg-slate-900/10 dark:hover:bg-slate-900/20"
    >
      <span className="shrink-0 pt-0.5 text-[10px] text-slate-500">💭</span>
      <p className={`text-[11px] text-slate-500 dark:text-slate-400 italic leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {message.content}
      </p>
      {!expanded && message.content.length > 150 && (
        <span className="shrink-0 pt-0.5 text-[9px] text-slate-500 dark:text-slate-400">...</span>
      )}
    </button>
  );
}

function AGUIToolCard({ tool }: { tool: ToolCallGroup }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = !!tool.result;

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors w-full text-left"
      >
        <span className="text-[10px]">🔧</span>
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{tool.toolName}</span>
        <span className={`text-[10px] ${hasResult ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {hasResult ? "✓" : "⏳"}
        </span>
        <svg className={`w-3 h-3 text-slate-400 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 pl-3 border-l-2 border-amber-200 dark:border-amber-800/40 space-y-2">
          {tool.args && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Args</span>
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-0.5 max-h-32 overflow-auto">
                {tool.args}
              </pre>
            </div>
          )}
          {tool.result && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Result</span>
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-0.5 max-h-40 overflow-auto">
                {tool.result.slice(0, 2000)}{tool.result.length > 2000 ? "\n...(truncated)" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AGUICustomCard({ event }: { event: AGUIBaseEvent }) {
  const [expanded, setExpanded] = useState(false);
  const name = (event.name as string) ?? event.type;

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors w-full text-left"
      >
        <span className="text-[10px] text-slate-500">⚙</span>
        <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{name}</span>
        <svg className={`w-2.5 h-2.5 text-slate-400 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <pre className="ml-4 mt-1 text-[9px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-32 overflow-auto">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── View modes ───────────────────────────────────────────────────────────

type ViewMode = "chat" | "events" | "split";

// ─── Main Component ───────────────────────────────────────────────────────

interface AGUITracePanelProps {
  sessionId: string | null;
  traces: TraceRecord[];
}

export function AGUITracePanel({ sessionId, traces }: AGUITracePanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const { t } = useTranslation();

  // Replay traces through AG-UI adapter
  const agUIEvents = useMemo(() => {
    if (!sessionId || traces.length === 0) return [];
    return replayTracesAsAGUI(traces, sessionId, `run-${sessionId.slice(0, 8)}`);
  }, [traces, sessionId]);

  // Assemble into display items
  const displayItems = useMemo(() => assembleDisplayItems(agUIEvents), [agUIEvents]);

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t.trace.selectSessionAGUI}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#13151d]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">AG-UI</span>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.trace.protocolView}</span>
          {agUIEvents.length > 0 && (
            <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              {agUIEvents.length} {t.trace.events}
            </span>
          )}
        </div>

        {/* View mode toggle */}
        <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-0.5">
          {(["chat", "split", "events"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${viewMode === mode
                ? "bg-blue-500 text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
            >
              {mode === "chat" ? "Chat" : mode === "events" ? "Events" : "Split"}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {agUIEvents.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {traces.length === 0 ? t.trace.noTracesSession : t.trace.noAGUIEvents}
          </p>
        </div>
      )}

      {/* Content */}
      {agUIEvents.length > 0 && (
        <div className="flex-1 flex min-h-0">
          {/* Chat view */}
          {(viewMode === "chat" || viewMode === "split") && (
            <div className={`${viewMode === "split" ? "w-1/2 border-r border-slate-200 dark:border-slate-800" : "w-full"} overflow-y-auto`}>
              <div className="p-4 space-y-4">
                {displayItems.map((item, idx) => {
                  switch (item.type) {
                    case "lifecycle":
                      return <AGUILifecycleBar key={idx} event={item.event} />;
                    case "message":
                      if (item.message.kind === "user") {
                        return <AGUIUserBubble key={idx} message={item.message} />;
                      }
                      if (item.message.kind === "reasoning") {
                        return <AGUIReasoningBubble key={idx} message={item.message} />;
                      }
                      return (
                        <div key={idx} className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                            <span className="text-[10px] font-bold text-blue-600">AG</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <AGUIAssistantBubble message={item.message} />
                          </div>
                        </div>
                      );
                    case "tool":
                      return <AGUIToolCard key={idx} tool={item.tool} />;
                    case "custom":
                      return <AGUICustomCard key={idx} event={item.event} />;
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          )}

          {/* Events stream view */}
          {(viewMode === "events" || viewMode === "split") && (
            <div className={`${viewMode === "split" ? "w-1/2" : "w-full"} overflow-y-auto`}>
              <div className="p-2 space-y-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {t.trace.rawEvents} ({agUIEvents.length})
                </div>
                {agUIEvents.map((evt, idx) => (
                  <EventCard key={idx} event={evt} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
