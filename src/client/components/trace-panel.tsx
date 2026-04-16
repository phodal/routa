"use client";

/**
 * TracePanel - Displays Agent Trace records for debugging
 *
 * Shows:
 * - Session lifecycle events (start/end)
 * - User messages
 * - Agent responses (messages, thoughts)
 * - Tool calls and results (with input params as table)
 * - File modifications
 *
 * Based on the Agent Trace specification: https://github.com/cursor/agent-trace
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import type { TraceRecord } from "@/core/trace";
import type { LaneHandoffInfo, LaneSessionInfo, SessionKanbanContext } from "@/client/types/kanban-context";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { ToolInputTable, ToolOutputView } from "./tool-call-content";
import { useTranslation } from "@/i18n";
import { Check, ChevronRight, Copy, FileText } from "lucide-react";


interface TracePanelProps {
  sessionId: string | null;
}


/** A merged tool call + result record */
interface MergedToolRecord {
  type: "merged_tool";
  toolCall: TraceRecord;
  toolResult?: TraceRecord;
  toolCallId: string;
}

/** A regular trace record or a merged tool record */
type DisplayRecord = TraceRecord | MergedToolRecord;

function isMergedTool(record: DisplayRecord): record is MergedToolRecord {
  return (record as MergedToolRecord).type === "merged_tool";
}

/**
 * A conversation turn - either a user message or an agent response block
 * Agent response blocks group together: thoughts, messages, and tools
 */
interface ConversationTurn {
  type: "user" | "agent";
  startTime: string;
  endTime: string;
  items: DisplayRecord[];
}

/**
 * Group traces into conversation turns for a continuous flow layout.
 * User messages start a new turn. Agent content (thoughts, messages, tools)
 * are grouped together until the next user message.
 */
function groupIntoConversationTurns(records: DisplayRecord[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentAgentTurn: ConversationTurn | null = null;

  for (const record of records) {
    const trace = isMergedTool(record) ? record.toolCall : record;
    const eventType = isMergedTool(record) ? "tool_call" : trace.eventType;

    if (eventType === "user_message") {
      // Flush current agent turn if any
      if (currentAgentTurn && currentAgentTurn.items.length > 0) {
        turns.push(currentAgentTurn);
        currentAgentTurn = null;
      }
      // User message is its own turn
      turns.push({
        type: "user",
        startTime: trace.timestamp,
        endTime: trace.timestamp,
        items: [record],
      });
    } else if (
      eventType === "agent_message" ||
      eventType === "agent_thought" ||
      eventType === "tool_call" ||
      isMergedTool(record)
    ) {
      // Agent content - add to current agent turn or create new one
      if (!currentAgentTurn) {
        currentAgentTurn = {
          type: "agent",
          startTime: trace.timestamp,
          endTime: trace.timestamp,
          items: [],
        };
      }
      currentAgentTurn.items.push(record);
      currentAgentTurn.endTime = trace.timestamp;
    } else if (eventType === "session_start" || eventType === "session_end") {
      // Session events - flush agent turn and add as separate item
      if (currentAgentTurn && currentAgentTurn.items.length > 0) {
        turns.push(currentAgentTurn);
        currentAgentTurn = null;
      }
      turns.push({
        type: "agent", // Use agent type for session events
        startTime: trace.timestamp,
        endTime: trace.timestamp,
        items: [record],
      });
    }
    // Skip tool_result as they are merged with tool_call
  }

  // Flush remaining agent turn
  if (currentAgentTurn && currentAgentTurn.items.length > 0) {
    turns.push(currentAgentTurn);
  }

  return turns;
}

/**
 * Merge tool_call and tool_result traces by toolCallId.
 * Returns a mixed array of regular traces and merged tool records.
 */
function mergeToolTraces(traces: TraceRecord[]): DisplayRecord[] {
  const result: DisplayRecord[] = [];
  const processedResultIds = new Set<string>();

  // First pass: find all tool_calls and mark their matching results
  for (const trace of traces) {
    if (trace.eventType === "tool_result" && trace.tool?.toolCallId) {
      const hasMatchingCall = traces.some(
        (t) => t.eventType === "tool_call" && t.tool?.toolCallId === trace.tool?.toolCallId
      );
      if (hasMatchingCall) {
        processedResultIds.add(trace.id);
      }
    }
  }

  // Build the result array
  for (const trace of traces) {
    if (trace.eventType === "tool_call" && trace.tool?.toolCallId) {
      // Find matching result
      const matchingResult = traces.find(
        (t) =>
          t.eventType === "tool_result" &&
          t.tool?.toolCallId === trace.tool?.toolCallId
      );
      result.push({
        type: "merged_tool",
        toolCall: trace,
        toolResult: matchingResult,
        toolCallId: trace.tool.toolCallId,
      });
    } else if (trace.eventType === "tool_result" && trace.tool?.toolCallId) {
      // Skip if already merged with a tool_call
      if (processedResultIds.has(trace.id)) {
        continue;
      }
      // Orphan result (no matching call) - still show it
      result.push(trace);
    } else {
      // All other event types
      result.push(trace);
    }
  }

  return result;
}

/**
 * Infer actual tool name from input parameters when name is "other" or "unknown".
 * This handles cases where the ACP provider doesn't send the correct tool name.
 */
function inferToolName(name: string, input: unknown): string {
  if (name !== "other" && name !== "unknown") {
    return name;
  }

  if (!input || typeof input !== "object") {
    return name;
  }

  const inputObj = input as Record<string, unknown>;

  // codebase-retrieval: has "information_request" parameter
  if ("information_request" in inputObj) {
    return "codebase-retrieval";
  }

  // file read operations
  if ("file_path" in inputObj && !("content" in inputObj)) {
    return "read-file";
  }

  // file write operations
  if ("file_path" in inputObj && "content" in inputObj) {
    return "write-file";
  }

  // shell/bash commands
  if ("command" in inputObj) {
    return "shell";
  }

  // web search
  if ("query" in inputObj && "num_results" in inputObj) {
    return "web-search";
  }

  // web fetch
  if ("url" in inputObj && !("query" in inputObj)) {
    return "web-fetch";
  }

  return name;
}

function formatLaneSessionSummary(session: LaneSessionInfo, t: ReturnType<typeof useTranslation>["t"]): string {
  return [
    session.columnName ?? session.columnId ?? t.trace.unknownLane,
    session.stepName ?? (typeof session.stepIndex === "number" ? `${t.trace.step} ${session.stepIndex + 1}` : undefined),
    session.provider,
    session.role,
  ].filter(Boolean).join(" • ");
}

function formatHandoffRequestType(value: LaneHandoffInfo["requestType"]): string {
  return value.replace(/_/g, " ");
}

function getTraceMetadataString(trace: TraceRecord, key: string): string | null {
  const value = trace.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Inline tool display for conversation flow - compact, non-intrusive */
function InlineToolView({
  merged,
  formatTime,
  t,
}: {
  merged: MergedToolRecord;
  formatTime: (timestamp: string) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [expanded, setExpanded] = useState(true); // Default expanded
  const { toolCall, toolResult } = merged;
  const rawToolName = toolCall.tool?.name ?? "unknown";
  const toolName = inferToolName(rawToolName, toolCall.tool?.input);
  const status = toolResult?.tool?.status ?? toolCall.tool?.status ?? "running";
  const toolContextPath =
    getTraceMetadataString(toolCall, "toolCallContentPath") ??
    getTraceMetadataString(toolCall, "toolCallContextDir");

  const rawOutput = toolResult?.tool?.output;
  const outputStr =
    rawOutput == null
      ? ""
      : typeof rawOutput === "string"
        ? rawOutput
        : JSON.stringify(rawOutput, null, 2);

  const statusIcon = status === "completed" ? "✓" : status === "failed" ? "✗" : "⏳";
  const statusColor =
    status === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "failed"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400 animate-pulse";

  // Generate a brief summary of the tool input
  const inputSummary = useMemo(() => {
    const input = toolCall.tool?.input;
    if (!input) return "";
    if (typeof input === "string") return input.slice(0, 50);
    const obj = input as Record<string, unknown>;
    // Show key field based on tool type
    if (obj.url) return String(obj.url).slice(0, 50);
    if (obj.path) return String(obj.path);
    if (obj.file_path) return String(obj.file_path);
    if (obj.command) return String(obj.command).slice(0, 50);
    if (obj.information_request) return String(obj.information_request).slice(0, 40);
    if (obj.query) return String(obj.query).slice(0, 40);
    return "";
  }, [toolCall.tool?.input]);

  return (
    <div className="my-2">
      {/* Compact tool header - inline with flow */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors w-full text-left"
      >
        <ChevronRight className={`w-3 h-3 text-amber-400 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        <span className="text-[10px] text-amber-500 dark:text-amber-400">🔧</span>
        <code className="text-[11px] font-mono font-medium text-amber-700 dark:text-amber-300">
          {toolName}
        </code>
        {inputSummary && (
          <>
            <span className="text-slate-300 dark:text-slate-600">→</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex-1 font-mono">
              {inputSummary}
            </span>
          </>
        )}
        <span className={`text-xs shrink-0 ${statusColor}`}>{statusIcon}</span>
        <span className="text-[9px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {formatTime(toolCall.timestamp)}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-amber-200 dark:border-amber-800/40 space-y-2">
          {/* Input */}
          {toolCall.tool?.input != null && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700/60 overflow-hidden">
              <div className="px-2 py-1 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/60">
                <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t.trace.input}
                </span>
              </div>
              <div className="px-2 py-1.5 bg-white dark:bg-slate-900/40">
                <ToolInputTable input={toolCall.tool.input} />
              </div>
            </div>
          )}
          {toolContextPath && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800/40 overflow-hidden">
              <div className="px-2 py-1 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40">
                <span className="text-[9px] font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wider">
                  {t.trace.toolContext}
                </span>
              </div>
              <div className="px-2 py-1.5 bg-white dark:bg-slate-900/40">
                <code className="block text-[11px] text-amber-700 dark:text-amber-300 break-all">
                  {toolContextPath}
                </code>
              </div>
            </div>
          )}
          {/* Output */}
          {outputStr && (
            <div className="rounded-md border border-blue-200 dark:border-blue-800/40 overflow-hidden">
              <ToolOutputView output={rawOutput ?? outputStr} toolName={toolName} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsible thought bubble for conversation flow */
function InlineThoughtView({ trace }: { trace: TraceRecord }) {
  const [expanded, setExpanded] = useState(false);
  const content = trace.conversation?.fullContent || trace.conversation?.contentPreview || "";

  if (!content) return null;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="group flex items-start gap-2 my-1 px-3 py-1.5 rounded-lg bg-amber-50/40 dark:bg-amber-900/5 border border-amber-100/50 dark:border-amber-800/20 hover:bg-amber-50/70 dark:hover:bg-amber-900/10 transition-colors w-full text-left"
    >
      <span className="text-[10px] text-amber-500 shrink-0 pt-0.5">💭</span>
      <p className={`text-[11px] text-slate-500 dark:text-slate-400 italic leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {content}
      </p>
      {!expanded && content.length > 150 && (
        <span className="text-[9px] text-amber-500 dark:text-amber-400 shrink-0 pt-0.5">...</span>
      )}
    </button>
  );
}

/** User message bubble for conversation flow */
function UserMessageBubble({
  trace,
  formatTime,
  t,
}: {
  trace: TraceRecord;
  formatTime: (timestamp: string) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const content = trace.conversation?.fullContent || trace.conversation?.contentPreview || "";

  return (
    <div className="flex items-start gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        <span className="text-sm">👤</span>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t.trace.user}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(trace.timestamp)}
          </span>
        </div>
        <div className="px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {content || <span className="italic text-slate-400">{t.trace.empty}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Agent response block - groups thoughts, messages, and tools into a continuous flow */
function AgentResponseBlock({
  turn,
  formatTime,
  t,
}: {
  turn: ConversationTurn;
  formatTime: (timestamp: string) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);

  // Separate thoughts from other content
  const thoughts: TraceRecord[] = [];
  const messages: TraceRecord[] = [];
  const tools: MergedToolRecord[] = [];
  const sessionEvents: TraceRecord[] = [];

  for (const item of turn.items) {
    if (isMergedTool(item)) {
      tools.push(item);
    } else if (item.eventType === "agent_thought") {
      thoughts.push(item);
    } else if (item.eventType === "agent_message") {
      messages.push(item);
    } else if (item.eventType === "session_start" || item.eventType === "session_end") {
      sessionEvents.push(item);
    }
  }

  // Session events render differently
  if (sessionEvents.length > 0 && messages.length === 0 && tools.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2">
        {sessionEvents.map((evt) => (
          <span
            key={evt.id}
            className={`text-[10px] font-semibold uppercase tracking-wide ${evt.eventType === "session_start"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-500 dark:text-red-400"
              }`}
          >
            {evt.eventType === "session_start" ? `▶ ${t.trace.sessionStarted}` : `■ ${t.trace.sessionEnded}`}
            <span className="ml-2 font-normal text-slate-400">{formatTime(evt.timestamp)}</span>
          </span>
        ))}
      </div>
    );
  }

  // Get model info from first agent message
  const model = messages[0]?.contributor?.model || thoughts[0]?.contributor?.model;

  // Build interleaved content for proper flow
  // Sort all items by timestamp and render in order
  const sortedItems = [...turn.items].sort(
    (a, b) =>
      new Date(isMergedTool(a) ? a.toolCall.timestamp : a.timestamp).getTime() -
      new Date(isMergedTool(b) ? b.toolCall.timestamp : b.timestamp).getTime()
  );

  // Merge consecutive agent_message content
  const mergedContent: Array<{
    type: "thought" | "message" | "tool";
    content?: string;
    trace?: TraceRecord;
    merged?: MergedToolRecord;
  }> = [];

  for (const item of sortedItems) {
    if (isMergedTool(item)) {
      mergedContent.push({ type: "tool", merged: item });
    } else if (item.eventType === "agent_thought") {
      mergedContent.push({ type: "thought", trace: item });
    } else if (item.eventType === "agent_message") {
      const content = item.conversation?.fullContent || item.conversation?.contentPreview || "";
      // Try to merge with previous message
      const last = mergedContent[mergedContent.length - 1];
      if (last && last.type === "message" && last.content !== undefined) {
        last.content += content;
      } else {
        mergedContent.push({ type: "message", content });
      }
    }
  }

  return (
    <div className="flex items-start gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        <span className="text-sm">🤖</span>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Agent</span>
          {model && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{model}</span>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(turn.startTime)}
            {turn.startTime !== turn.endTime && ` → ${formatTime(turn.endTime)}`}
          </span>
        </div>

        {/* Thoughts toggle (if any) */}
        {thoughts.length > 0 && (
          <button
            onClick={() => setThoughtsExpanded(!thoughtsExpanded)}
            className="flex items-center gap-1.5 mb-2 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${thoughtsExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.trace.thoughtsLabel} {t.trace.thoughtsCount.replace("{count}", String(thoughts.length))}
          </button>
        )}
        {thoughtsExpanded && thoughts.map((t) => <InlineThoughtView key={t.id} trace={t} />)}

        {/* Main content flow */}
        <div className="space-y-1">
          {mergedContent.map((item, idx) => {
            if (item.type === "thought" && !thoughtsExpanded) {
              // Thoughts handled above
              return null;
            }
            if (item.type === "thought" && thoughtsExpanded) {
              // Already rendered above
              return null;
            }
            if (item.type === "message") {
              return (
                <div key={idx} className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                  <MarkdownViewer content={item.content || ""} className="text-sm" />
                </div>
              );
            }
            if (item.type === "tool" && item.merged) {
              return (
                <InlineToolView
                  key={`tool-${idx}-${item.merged.toolCallId}`}
                  merged={item.merged}
                  formatTime={formatTime}
                  t={t}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export function TracePanel({ sessionId }: TracePanelProps) {
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [kanbanContext, setKanbanContext] = useState<SessionKanbanContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const { t } = useTranslation();

  const [stats, setStats] = useState<{
    totalDays: number;
    totalFiles: number;
    totalRecords: number;
    uniqueSessions: number;
    eventTypes: Record<string, number>;
  } | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState(false);

  const fetchTraces = useCallback(async () => {
    if (!sessionId) {
      setTraces([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ sessionId });
      const res = await desktopAwareFetch(`/api/traces?${params}`, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(`Failed to fetch traces: ${res.statusText}`);
      }

      const data = await res.json();
      setTraces(data.traces || []);
    } catch (err) {
      console.error("[TracePanel] Failed to fetch traces:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchSessionContext = useCallback(async () => {
    if (!sessionId) {
      setKanbanContext(null);
      return;
    }

    try {
      const res = await desktopAwareFetch(`/api/sessions/${sessionId}/context`, { cache: "no-store" });
      if (!res.ok) {
        setKanbanContext(null);
        return;
      }
      const data = await res.json();
      setKanbanContext(data.kanbanContext ?? null);
    } catch {
      setKanbanContext(null);
    }
  }, [sessionId]);

  const fetchStats = useCallback(async () => {
    try {
      const statsUrl = sessionId
        ? `/api/traces/stats?${new URLSearchParams({ sessionId }).toString()}`
        : "/api/traces/stats";
      const res = await desktopAwareFetch(statsUrl, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error("[TracePanel] Failed to fetch stats:", err);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTraces();
    fetchStats();
    fetchSessionContext();
  }, [fetchSessionContext, fetchTraces, fetchStats]);

  const exportTraces = useCallback(async () => {
    if (!sessionId) return;

    try {
      const params = new URLSearchParams({ sessionId });
      const res = await desktopAwareFetch(`/api/traces/export?${params}`, {
        cache: "no-store",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Failed to export traces: ${res.statusText}`);
      }

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.export, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traces-${sessionId}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[TracePanel] Failed to export traces:", err);
    }
  }, [sessionId]);

  // Merge tool_call and tool_result by toolCallId
  const mergedRecords = useMemo(() => mergeToolTraces(traces), [traces]);

  // Filter records based on selected filter
  const filteredRecords = useMemo(() => {
    if (filter === "all") return mergedRecords;
    if (filter === "tools") {
      // Show only merged tool records
      return mergedRecords.filter((r) => isMergedTool(r));
    }
    // For tool_call or tool_result filters, show the merged view but only matching items
    if (filter === "tool_call" || filter === "tool_result") {
      return mergedRecords.filter((r) => {
        if (isMergedTool(r)) return true; // Show merged tools
        return r.eventType === filter;
      });
    }
    // For other filters, show non-merged items matching the filter
    return mergedRecords.filter((r) => {
      if (isMergedTool(r)) return false;
      return r.eventType === filter;
    });
  }, [mergedRecords, filter]);

  // Group into conversation turns for continuous flow
  const conversationTurns = useMemo(
    () => groupIntoConversationTurns(filteredRecords),
    [filteredRecords]
  );



  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const copySessionId = useCallback(() => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopiedSessionId(true);
      window.setTimeout(() => setCopiedSessionId(false), 1500);
    }).catch(() => {
      setCopiedSessionId(false);
    });
  }, [sessionId]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#13151d]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t.trace.agentTrace}
          </span>
          {traces.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full">
              {traces.length}
            </span>
          )}
          {sessionId && (
            <>
              <span
                className="ml-1 min-w-0 max-w-[18rem] break-all rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                title={sessionId}
              >
                {sessionId}
              </span>
              <button
                type="button"
                onClick={copySessionId}
                className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                title={t.common.copyToClipboard}
                aria-label={t.common.copyToClipboard}
              >
                {copiedSessionId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTraces}
            disabled={loading}
            className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 disabled:opacity-50 transition-colors"
          >
            {loading ? "..." : t.trace.refresh}
          </button>
          <button
            onClick={exportTraces}
            disabled={traces.length === 0}
            className="px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t.trace.export}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>{stats.totalRecords} {t.trace.totalRecords}</span>
          <span>{stats.uniqueSessions} {t.trace.sessions}</span>
          <span>{stats.totalDays} {t.trace.days}</span>
        </div>
      )}

      {!loading && !error && sessionId && traces.length === 0 && (
        <div className="px-4 py-2 border-b border-amber-200 bg-amber-50/70 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200">
          {t.trace.noTracesForSession}
        </div>
      )}

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 shrink-0 overflow-x-auto">
        {(
          [
            { key: "all", label: t.trace.all, active: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
            { key: "user_message", label: t.trace.user, active: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
            { key: "agent_message", label: "Agent", active: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
            { key: "tools", label: t.trace.tools, active: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" },
            { key: "agent_thought", label: t.trace.thoughts, active: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" },
          ] as const
        ).map(({ key, label, active }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${filter === key
              ? active
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {kanbanContext && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-900/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
              {t.trace.kanbanStory}
            </span>
            {kanbanContext.columnId && (
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-[#13151d] dark:text-emerald-300">
                {kanbanContext.columnId}
              </span>
            )}
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-mono text-slate-600 dark:bg-[#13151d] dark:text-slate-300">
              {kanbanContext.taskId.slice(0, 8)}
            </span>
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {kanbanContext.taskTitle}
          </div>
          {kanbanContext.currentLaneSession && (
            <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
              {t.trace.currentLaneSession}: {formatLaneSessionSummary(kanbanContext.currentLaneSession, t)}
              {" · "}
              <span className="font-semibold uppercase tracking-wide">
                {kanbanContext.currentLaneSession.status}
              </span>
            </div>
          )}
          {kanbanContext.previousLaneSession && (
            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              {t.trace.previousLaneSession}: {formatLaneSessionSummary(kanbanContext.previousLaneSession, t)}
            </div>
          )}
          {kanbanContext.previousLaneRun && (
            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              {t.trace.previousLaneRun}: {formatLaneSessionSummary(kanbanContext.previousLaneRun, t)}
            </div>
          )}
          {kanbanContext.relatedHandoffs.length > 0 && (
            <div className="mt-3 space-y-2">
              {kanbanContext.relatedHandoffs.slice(0, 3).map((handoff) => (
                <div
                  key={handoff.id}
                  className="rounded-lg border border-slate-200 bg-white/90 px-3 py-2 dark:border-slate-700 dark:bg-[#13151d]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {handoff.direction}
                    </span>
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                      {formatHandoffRequestType(handoff.requestType)}
                    </span>
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {handoff.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">
                    {handoff.request}
                  </div>
                  {handoff.responseSummary && (
                    <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-200">
                      {handoff.responseSummary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredRecords.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <FileText className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {sessionId ? t.trace.noTracesForSession : t.trace.selectSessionToView}
            </p>
            {sessionId && (
              <p className="mt-2 break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">
                {sessionId}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Trace content - continuous conversation flow */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6">
          {conversationTurns.map((turn, idx) => {
            if (turn.type === "user") {
              const trace = turn.items[0];
              if (!isMergedTool(trace)) {
                return (
                  <UserMessageBubble
                    key={trace.id}
                    trace={trace}
                    formatTime={formatTime}
                    t={t}
                  />
                );
              }
            }
            return (
              <AgentResponseBlock
                key={`turn-${idx}`}
                turn={turn}
                formatTime={formatTime}
                t={t}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
