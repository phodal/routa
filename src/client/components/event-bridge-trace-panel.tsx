"use client";

/**
 * EventBridge Trace Panel — Replays TraceRecords through AgentEventBridge
 * and renders WorkspaceAgentEvent[] as a semantic block timeline.
 *
 * This removes the need for frontend-side inferToolName / mergeToolTraces
 * logic, as AgentEventBridge already classifies tools into read_block,
 * file_changes_block, terminal_block, mcp_block, etc.
 */

import { useMemo, useState } from "react";
import type { TraceRecord } from "@/core/trace";
import type { WorkspaceAgentEvent } from "@/core/acp/agent-event-bridge/types";
import { replayTracesAsEventBridge } from "@/core/trace/trace-replay";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { CodeBlock } from "./code-block";
import { useTranslation } from "@/i18n";

// ─── Block colors ──────────────────────────────────────────────────────────

const BLOCK_COLORS: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  agent_started: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", icon: "▶" },
  agent_completed: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", icon: "✓" },
  agent_failed: { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-300", border: "border-red-200 dark:border-red-800", icon: "✗" },
  message_block: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800", icon: "💬" },
  thought_block: { bg: "bg-slate-50 dark:bg-slate-950/20", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800", icon: "💭" },
  read_block: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800", icon: "📖" },
  file_changes_block: { bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", icon: "📝" },
  terminal_block: { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800", icon: "⌨" },
  mcp_block: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800", icon: "🔌" },
  tool_call_block: { bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", icon: "🔧" },
  plan_updated: { bg: "bg-slate-50 dark:bg-slate-950/20", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-800", icon: "📋" },
  usage_reported: { bg: "bg-emerald-50 dark:bg-emerald-950/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", icon: "📊" },
};

const DEFAULT_COLOR = { bg: "bg-slate-50 dark:bg-slate-950/30", text: "text-slate-600 dark:text-slate-400", border: "border-slate-200 dark:border-slate-800", icon: "•" };

// ─── Event Group Helpers ──────────────────────────────────────────────────

type EventGroup = {
  kind: "lifecycle" | "user_message" | "agent_response";
  events: WorkspaceAgentEvent[];
};

/**
 * Group semantic events into logical conversation turns.
 * User messages (message_block with role=user) start a new user turn.
 * Agent content is grouped per turn — a turn ends at usage_reported
 * (which marks the end of one generation) or at the next user message.
 */
function groupSemanticEvents(events: WorkspaceAgentEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let currentAgent: WorkspaceAgentEvent[] = [];

  const flushAgent = () => {
    if (currentAgent.length > 0) {
      groups.push({ kind: "agent_response", events: [...currentAgent] });
      currentAgent = [];
    }
  };

  for (const evt of events) {
    if (evt.type === "agent_started" || evt.type === "agent_completed" || evt.type === "agent_failed") {
      flushAgent();
      groups.push({ kind: "lifecycle", events: [evt] });
    } else if (evt.type === "message_block" && evt.role === "user") {
      flushAgent();
      groups.push({ kind: "user_message", events: [evt] });
    } else if (evt.type === "usage_reported") {
      // usage_reported marks end of a generation turn — flush current group,
      // then add it as a standalone event in the new flushed group
      currentAgent.push(evt);
      flushAgent();
    } else {
      currentAgent.push(evt);
    }
  }
  flushAgent();
  return groups;
}

// ─── Sub-components ───────────────────────────────────────────────────────

function LifecycleBar({ event }: { event: WorkspaceAgentEvent }) {
  const color = BLOCK_COLORS[event.type] ?? DEFAULT_COLOR;
  let label = "";
  let detail = "";

  if (event.type === "agent_started") {
    label = "Session Started";
    detail = event.provider;
  } else if (event.type === "agent_completed") {
    label = "Completed";
    detail = event.stopReason;
  } else if (event.type === "agent_failed") {
    label = "Failed";
    detail = event.message;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${color.bg} ${color.border}`}>
      <span className={`text-xs font-semibold ${color.text}`}>
        {color.icon} {label}
      </span>
      {detail && (
        <span className="text-[10px] text-slate-500 dark:text-slate-400">{detail}</span>
      )}
      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
        {event.timestamp.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}

function UserBubble({ event }: { event: WorkspaceAgentEvent & { type: "message_block" } }) {
  return (
    <div className="flex items-start gap-3 group">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/30">
        <span className="text-sm">👤</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">User</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
            {event.timestamp.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-950/20">
          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {event.content || <span className="italic text-slate-400">(empty)</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function ThoughtBubble({ event }: { event: WorkspaceAgentEvent & { type: "thought_block" } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="group my-1 flex w-full items-start gap-2 rounded-lg border border-slate-100/50 bg-slate-50/50 px-3 py-1.5 text-left transition-colors hover:bg-slate-100/70 dark:border-slate-800/20 dark:bg-slate-900/10 dark:hover:bg-slate-900/20"
    >
      <span className="shrink-0 pt-0.5 text-[10px] text-slate-500">💭</span>
      <p className={`text-[11px] text-slate-500 dark:text-slate-400 italic leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {event.content}
      </p>
      {!expanded && event.content.length > 150 && (
        <span className="shrink-0 pt-0.5 text-[9px] text-slate-500 dark:text-slate-400">...</span>
      )}
    </button>
  );
}

function MessageBubble({ event }: { event: WorkspaceAgentEvent & { type: "message_block" } }) {
  return (
    <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
      <MarkdownViewer content={event.content || ""} className="text-sm" />
    </div>
  );
}

function ReadBlockCard({ event }: { event: WorkspaceAgentEvent & { type: "read_block" } }) {
  const [expanded, setExpanded] = useState(false);
  const color = BLOCK_COLORS.read_block;
  const statusIcon = event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳";

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} border ${color.border} hover:opacity-80 transition-colors w-full text-left`}
      >
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>{event.toolName}</span>
        <span className={`text-[10px] ${event.status === "completed" ? "text-emerald-600" : event.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{statusIcon}</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto">{event.files.length} file{event.files.length !== 1 ? "s" : ""}</span>
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 border-l-2 border-blue-200 pl-3 dark:border-blue-800/40">
          {event.files.map((f, i) => (
            <div key={i} className="text-[11px] font-mono text-slate-600 dark:text-slate-400 py-0.5">{f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileChangesCard({ event }: { event: WorkspaceAgentEvent & { type: "file_changes_block" } }) {
  const [expanded, setExpanded] = useState(false);
  const color = BLOCK_COLORS.file_changes_block;
  const statusIcon = event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳";

  const changeIcons: Record<string, string> = { create: "+", edit: "~", delete: "-", move: "→" };

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} border ${color.border} hover:opacity-80 transition-colors w-full text-left`}
      >
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>{event.toolName}</span>
        <span className={`text-[10px] ${event.status === "completed" ? "text-emerald-600" : event.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{statusIcon}</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto">{event.changes.length} change{event.changes.length !== 1 ? "s" : ""}</span>
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-1 border-l-2 border-amber-200 pl-3 dark:border-amber-800/40">
          {event.changes.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
              <span className={`w-4 text-center font-bold ${c.changeType === "create" ? "text-emerald-600" : c.changeType === "delete" ? "text-red-600" : "text-amber-600"}`}>
                {changeIcons[c.changeType] ?? "?"}
              </span>
              <span className="text-slate-600 dark:text-slate-400">{c.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TerminalCard({ event }: { event: WorkspaceAgentEvent & { type: "terminal_block" } }) {
  const [expanded, setExpanded] = useState(true);
  const color = BLOCK_COLORS.terminal_block;
  const statusIcon = event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳";

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} border ${color.border} hover:opacity-80 transition-colors w-full text-left`}
      >
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>Terminal</span>
        <span className={`text-[10px] ${event.status === "completed" ? "text-emerald-600" : event.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{statusIcon}</span>
        {event.command && (
          <code className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs">{event.command}</code>
        )}
        <svg className={`w-3 h-3 text-slate-400 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (event.command || event.output) && (
        <div className="mt-1 ml-4 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700/60">
          {event.command && (
            <div className="bg-slate-950 px-3 py-1.5 text-[11px] font-mono text-emerald-400">
              $ {event.command}
            </div>
          )}
          {event.output && (
            <CodeBlock
              content={event.output}
              language="bash"
              variant="simple"
              className="!border-0 !rounded-none"
              wordWrap={true}
            />
          )}
        </div>
      )}
    </div>
  );
}

function McpCard({ event }: { event: WorkspaceAgentEvent & { type: "mcp_block" } }) {
  const [expanded, setExpanded] = useState(false);
  const color = BLOCK_COLORS.mcp_block;
  const statusIcon = event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳";

  const outputStr = event.output == null ? "" : typeof event.output === "string" ? event.output : JSON.stringify(event.output, null, 2);

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} border ${color.border} hover:opacity-80 transition-colors w-full text-left`}
      >
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>{event.toolName}</span>
        <span className={`text-[10px] ${event.status === "completed" ? "text-emerald-600" : event.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{statusIcon}</span>
        <svg className={`w-3 h-3 text-slate-400 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-2 border-l-2 border-blue-200 pl-3 dark:border-blue-800/40">
          {event.input && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Input</span>
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-0.5 max-h-40 overflow-auto">
                {JSON.stringify(event.input, null, 2)}
              </pre>
            </div>
          )}
          {outputStr && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Output</span>
              <CodeBlock content={outputStr} language="json" variant="simple" className="!border-0 mt-0.5" wordWrap={true} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GenericToolCard({ event }: { event: WorkspaceAgentEvent & { type: "tool_call_block" } }) {
  const [expanded, setExpanded] = useState(false);
  const color = BLOCK_COLORS.tool_call_block;
  const statusIcon = event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳";

  const outputStr = event.output == null ? "" : typeof event.output === "string" ? event.output : JSON.stringify(event.output, null, 2);

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} border ${color.border} hover:opacity-80 transition-colors w-full text-left`}
      >
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>{event.toolName}</span>
        {event.title && <span className="text-[10px] text-slate-500 dark:text-slate-400">{event.title}</span>}
        <span className={`text-[10px] ${event.status === "completed" ? "text-emerald-600" : event.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{statusIcon}</span>
        <svg className={`w-3 h-3 text-slate-400 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 pl-3 border-l-2 border-amber-200 dark:border-amber-800/40 space-y-2">
          {event.input && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Input</span>
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-0.5 max-h-40 overflow-auto">
                {JSON.stringify(event.input, null, 2)}
              </pre>
            </div>
          )}
          {outputStr && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Output</span>
              <CodeBlock content={outputStr} language="auto" variant="simple" className="!border-0 mt-0.5" wordWrap={true} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({ event }: { event: WorkspaceAgentEvent & { type: "plan_updated" } }) {
  const color = BLOCK_COLORS.plan_updated;
  const statusIcons: Record<string, string> = { done: "✓", in_progress: "⏳", failed: "✗", canceled: "⊘", pending: "○" };

  return (
    <div className={`my-2 px-3 py-2 rounded-lg ${color.bg} border ${color.border}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]">{color.icon}</span>
        <span className={`text-[11px] font-medium ${color.text}`}>Plan Updated</span>
      </div>
      <div className="space-y-1 ml-4">
        {event.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className={`${item.status === "done" ? "text-emerald-600" : item.status === "failed" ? "text-red-600" : "text-slate-500"}`}>
              {statusIcons[item.status] ?? "○"}
            </span>
            <span className="text-slate-700 dark:text-slate-300">{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageCard({ event }: { event: WorkspaceAgentEvent & { type: "usage_reported" } }) {
  const color = BLOCK_COLORS.usage_reported;
  return (
    <div className={`my-2 px-3 py-2 rounded-lg ${color.bg} border ${color.border} flex items-center gap-4`}>
      <span className="text-[10px]">{color.icon}</span>
      <span className={`text-[11px] font-medium ${color.text}`}>Usage</span>
      {event.usage.inputTokens != null && (
        <span className="text-[10px] text-slate-500">in: {event.usage.inputTokens.toLocaleString()}</span>
      )}
      {event.usage.outputTokens != null && (
        <span className="text-[10px] text-slate-500">out: {event.usage.outputTokens.toLocaleString()}</span>
      )}
    </div>
  );
}

/** Render a single WorkspaceAgentEvent */
function SemanticEventCard({ event }: { event: WorkspaceAgentEvent }) {
  switch (event.type) {
    case "message_block":
      return event.role === "user"
        ? <UserBubble event={event} />
        : <MessageBubble event={event} />;
    case "thought_block":
      return <ThoughtBubble event={event} />;
    case "read_block":
      return <ReadBlockCard event={event} />;
    case "file_changes_block":
      return <FileChangesCard event={event} />;
    case "terminal_block":
      return <TerminalCard event={event} />;
    case "mcp_block":
      return <McpCard event={event} />;
    case "tool_call_block":
      return <GenericToolCard event={event} />;
    case "plan_updated":
      return <PlanCard event={event} />;
    case "usage_reported":
      return <UsageCard event={event} />;
    case "agent_started":
    case "agent_completed":
    case "agent_failed":
      return <LifecycleBar event={event} />;
    default:
      return null;
  }
}

/** Agent response group — avatar + content block */
function AgentGroup({ events }: { events: WorkspaceAgentEvent[] }) {
  // Merge consecutive assistant message_block events while preserving order
  const orderedEvents: WorkspaceAgentEvent[] = [];
  for (const evt of events) {
    if (evt.type === "message_block" && evt.role === "assistant") {
      const last = orderedEvents[orderedEvents.length - 1];
      if (last && last.type === "message_block" && last.role === "assistant") {
        // Merge into preceding message
        orderedEvents[orderedEvents.length - 1] = {
          ...last,
          content: last.content + evt.content,
        };
        continue;
      }
    }
    orderedEvents.push(evt);
  }

  const firstTimestamp = events[0]?.timestamp;
  const lastTimestamp = events[events.length - 1]?.timestamp;
  const sameSecond =
    firstTimestamp &&
    lastTimestamp &&
    firstTimestamp.toLocaleTimeString() === lastTimestamp.toLocaleTimeString();

  return (
    <div className="flex items-start gap-3 group">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/30">
        <span className="text-sm">🤖</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Agent</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
            {firstTimestamp?.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {!sameSecond && lastTimestamp && ` → ${lastTimestamp.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
          </span>
        </div>

        {/* Events rendered IN ORDER — thoughts appear inline where they occurred */}
        <div className="space-y-1">
          {orderedEvents.map((evt, i) => (
            <SemanticEventCard key={i} event={evt} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filter config ────────────────────────────────────────────────────────

const BLOCK_FILTERS = [
  { key: "all", label: "All", active: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  { key: "message", label: "Messages", active: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  { key: "tool", label: "Tools", active: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300" },
  { key: "thought", label: "Thoughts", active: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" },
] as const;

// ─── Main Component ───────────────────────────────────────────────────────

interface EventBridgeTracePanelProps {
  sessionId: string | null;
  traces: TraceRecord[];
}

export function EventBridgeTracePanel({ sessionId, traces }: EventBridgeTracePanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const { t } = useTranslation();

  // Replay traces through AgentEventBridge
  const semanticEvents = useMemo(() => {
    if (!sessionId || traces.length === 0) return [];
    return replayTracesAsEventBridge(traces, sessionId);
  }, [traces, sessionId]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (filter === "all") return semanticEvents;
    if (filter === "message") return semanticEvents.filter((e) => e.type === "message_block" || e.type === "agent_started" || e.type === "agent_completed" || e.type === "agent_failed");
    if (filter === "tool") return semanticEvents.filter((e) =>
      e.type === "read_block" || e.type === "file_changes_block" || e.type === "terminal_block" ||
      e.type === "mcp_block" || e.type === "tool_call_block"
    );
    if (filter === "thought") return semanticEvents.filter((e) => e.type === "thought_block");
    return semanticEvents;
  }, [semanticEvents, filter]);

  // Group into conversation structure
  const groups = useMemo(() => groupSemanticEvents(filteredEvents), [filteredEvents]);

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t.trace.selectSessionEventBridge}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#13151d]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">🔗</span>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.trace.eventBridgeView}</span>
          {semanticEvents.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full">
              {semanticEvents.length} {t.trace.events}
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 shrink-0">
        {BLOCK_FILTERS.map(({ key, label, active }) => (
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

      {/* Empty state */}
      {filteredEvents.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {traces.length === 0 ? t.trace.noTracesSession : t.trace.noMatchingEvents}
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6">
          {groups.map((group, idx) => {
            if (group.kind === "lifecycle") {
              return <LifecycleBar key={idx} event={group.events[0]} />;
            }
            if (group.kind === "user_message") {
              const evt = group.events[0];
              if (evt.type === "message_block") {
                return <UserBubble key={idx} event={evt} />;
              }
            }
            if (group.kind === "agent_response") {
              return <AgentGroup key={idx} events={group.events} />;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
