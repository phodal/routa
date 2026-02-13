"use client";

/**
 * ChatPanel - ACP-based chat interface
 *
 * Renders streaming `session/update` SSE notifications from an opencode process.
 * Handles all ACP sessionUpdate types:
 *   - agent_message_chunk  → accumulated assistant message
 *   - agent_thought_chunk  → accumulated collapsible thought block
 *   - tool_call            → tool call card
 *   - tool_call_update     → updates existing tool call card
 *   - plan                 → plan entries list
 *   - usage_update         → token/cost badge
 *   - current_mode_update  → mode change notice
 *   - available_commands_update → silent
 *   - config_option_update → silent
 *   - session_info_update  → silent
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactElement,
} from "react";
import type { AcpSessionNotification } from "../acp-client";
import type { UseAcpActions, UseAcpState } from "../hooks/use-acp";

// ─── Message Types ─────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "thought" | "tool" | "plan" | "info";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  // Tool fields
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolKind?: string;
  // Plan fields
  planEntries?: PlanEntry[];
  // Usage fields
  usageUsed?: number;
  usageSize?: number;
  costAmount?: number;
  costCurrency?: string;
}

interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status?: "pending" | "in_progress" | "completed";
}

interface ChatPanelProps {
  acp: UseAcpState & UseAcpActions;
  activeSessionId: string | null;
  onEnsureSession: () => Promise<string | null>;
}

// ─── Main Component ────────────────────────────────────────────────────

export function ChatPanel({
  acp,
  activeSessionId,
  onEnsureSession,
}: ChatPanelProps) {
  const { connected, loading, error, updates, connect, prompt, disconnect } =
    acp;

  const [input, setInput] = useState("");
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track streaming IDs per session for accumulation
  const streamingMsgIdRef = useRef<Record<string, string | null>>({});
  const streamingThoughtIdRef = useRef<Record<string, string | null>>({});

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  // When active session changes, swap visible transcript
  useEffect(() => {
    if (!activeSessionId) {
      setVisibleMessages([]);
      return;
    }
    setVisibleMessages(messagesBySession[activeSessionId] ?? []);
  }, [activeSessionId, messagesBySession]);

  // ── Process ACP SSE updates ──────────────────────────────────────────

  useEffect(() => {
    if (!updates.length) return;
    const last = updates[updates.length - 1] as AcpSessionNotification;
    const sid = last.sessionId;

    // Support both nested (update.sessionUpdate) and flat (params.sessionUpdate)
    const update = (last.update ?? last) as Record<string, unknown>;
    const kind = update.sessionUpdate as string | undefined;
    if (!kind) return;

    const extractText = (): string => {
      const content = update.content as
        | { type: string; text?: string }
        | undefined;
      if (content?.text) return content.text;
      if (typeof update.text === "string") return update.text;
      return "";
    };

    // Helper to update messages for a session
    const updateMessages = (
      fn: (arr: ChatMessage[]) => ChatMessage[]
    ) => {
      setMessagesBySession((prev) => {
        const next = { ...prev };
        next[sid] = fn(next[sid] ? [...next[sid]] : []);
        return next;
      });
    };

    switch (kind) {
      // ── Agent message (accumulated) ──────────────────────────────────
      case "agent_message_chunk": {
        const text = extractText();
        if (!text) return;

        // Close any open thought block
        streamingThoughtIdRef.current[sid] = null;

        // Resolve or create the streaming message ID synchronously
        // (refs must be updated outside setState to avoid race conditions)
        let msgId = streamingMsgIdRef.current[sid];
        if (!msgId) {
          msgId = crypto.randomUUID();
          streamingMsgIdRef.current[sid] = msgId;
        }
        const targetId = msgId;

        updateMessages((arr) => {
          const idx = arr.findIndex((m) => m.id === targetId);
          if (idx >= 0) {
            arr[idx] = {
              ...arr[idx],
              content: arr[idx].content + text,
            };
          } else {
            arr.push({
              id: targetId,
              role: "assistant",
              content: text,
              timestamp: new Date(),
            });
          }
          return arr;
        });
        break;
      }

      // ── Thought (accumulated, collapsible) ───────────────────────────
      case "agent_thought_chunk": {
        const text = extractText();
        if (!text) return;

        // Resolve or create the streaming thought ID synchronously
        let thoughtId = streamingThoughtIdRef.current[sid];
        if (!thoughtId) {
          thoughtId = crypto.randomUUID();
          streamingThoughtIdRef.current[sid] = thoughtId;
        }
        const targetId = thoughtId;

        updateMessages((arr) => {
          const idx = arr.findIndex((m) => m.id === targetId);
          if (idx >= 0) {
            arr[idx] = {
              ...arr[idx],
              content: arr[idx].content + text,
            };
          } else {
            arr.push({
              id: targetId,
              role: "thought",
              content: text,
              timestamp: new Date(),
            });
          }
          return arr;
        });
        break;
      }

      // ── Tool call ────────────────────────────────────────────────────
      case "tool_call": {
        const toolCallId = update.toolCallId as string | undefined;
        const title = (update.title as string) ?? "tool";
        const status = (update.status as string) ?? "running";
        const toolKind = update.kind as string | undefined;

        // Build content from various fields
        let contentParts: string[] = [];
        if (update.rawInput) {
          contentParts.push(
            `Input:\n${typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput, null, 2)}`
          );
        }
        // ACP spec: content is ToolCallContent[]
        const toolContent = update.content as
          | Array<{ type: string; text?: string }>
          | undefined;
        if (Array.isArray(toolContent)) {
          for (const c of toolContent) {
            if (c.text) contentParts.push(c.text);
          }
        }

        updateMessages((arr) => {
          arr.push({
            id: toolCallId ?? crypto.randomUUID(),
            role: "tool",
            content: contentParts.join("\n\n") || title,
            timestamp: new Date(),
            toolName: title,
            toolStatus: status,
            toolCallId,
            toolKind,
          });
          return arr;
        });
        break;
      }

      // ── Tool call update ─────────────────────────────────────────────
      case "tool_call_update": {
        const toolCallId = update.toolCallId as string | undefined;
        const status = update.status as string | undefined;

        // Build updated content
        let outputParts: string[] = [];
        if (update.rawOutput) {
          outputParts.push(
            typeof update.rawOutput === "string"
              ? update.rawOutput
              : JSON.stringify(update.rawOutput, null, 2)
          );
        }
        const toolContent = update.content as
          | Array<{ type: string; text?: string }>
          | null
          | undefined;
        if (Array.isArray(toolContent)) {
          for (const c of toolContent) {
            if (c.text) outputParts.push(c.text);
          }
        }

        if (toolCallId) {
          updateMessages((arr) => {
            const idx = arr.findIndex((m) => m.toolCallId === toolCallId);
            if (idx >= 0) {
              const existing = arr[idx];
              arr[idx] = {
                ...existing,
                toolStatus: status ?? existing.toolStatus,
                toolName: (update.title as string) ?? existing.toolName,
                toolKind: (update.kind as string) ?? existing.toolKind,
                content: outputParts.length
                  ? `${existing.toolName ?? "tool"}\n\nOutput:\n${outputParts.join("\n")}`
                  : existing.content,
              };
            } else {
              arr.push({
                id: crypto.randomUUID(),
                role: "tool",
                content: outputParts.join("\n") || `Tool ${status ?? "update"}`,
                timestamp: new Date(),
                toolStatus: status ?? "completed",
                toolCallId,
              });
            }
            return arr;
          });
        }
        break;
      }

      // ── Plan ─────────────────────────────────────────────────────────
      case "plan": {
        const entries = update.entries as PlanEntry[] | undefined;
        const planText = entries
          ? entries
              .map(
                (e) =>
                  `[${e.status ?? "pending"}] ${e.content}${e.priority ? ` (${e.priority})` : ""}`
              )
              .join("\n")
          : typeof update.plan === "string"
            ? update.plan
            : JSON.stringify(update, null, 2);

        updateMessages((arr) => {
          arr.push({
            id: crypto.randomUUID(),
            role: "plan",
            content: planText,
            timestamp: new Date(),
            planEntries: entries,
          });
          return arr;
        });
        break;
      }

      // ── Usage update ─────────────────────────────────────────────────
      case "usage_update": {
        const used = update.used as number | undefined;
        const size = update.size as number | undefined;
        const cost = update.cost as
          | { amount: number; currency: string }
          | null
          | undefined;

        updateMessages((arr) => {
          // Replace existing usage message or add new
          const usageIdx = arr.findIndex(
            (m) => m.role === "info" && m.usageUsed !== undefined
          );
          const usageMsg: ChatMessage = {
            id: usageIdx >= 0 ? arr[usageIdx].id : crypto.randomUUID(),
            role: "info",
            content: "",
            timestamp: new Date(),
            usageUsed: used,
            usageSize: size,
            costAmount: cost?.amount,
            costCurrency: cost?.currency,
          };
          if (usageIdx >= 0) {
            arr[usageIdx] = usageMsg;
          } else {
            arr.push(usageMsg);
          }
          return arr;
        });
        break;
      }

      // ── Mode update ──────────────────────────────────────────────────
      case "current_mode_update": {
        const modeId = update.currentModeId as string | undefined;
        if (modeId) {
          updateMessages((arr) => {
            arr.push({
              id: crypto.randomUUID(),
              role: "info",
              content: `Mode changed to: ${modeId}`,
              timestamp: new Date(),
            });
            return arr;
          });
        }
        break;
      }

      // ── Silent updates ───────────────────────────────────────────────
      case "available_commands_update":
      case "config_option_update":
      case "session_info_update":
        // No visible UI needed
        break;

      default:
        console.log(`[ChatPanel] Unhandled sessionUpdate: ${kind}`);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    await connect();
  }, [connect]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    const sid = activeSessionId ?? (await onEnsureSession());
    if (!sid) return;

    const text = input;
    setInput("");

    // Clear streaming IDs so the next response starts fresh
    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // Store user msg
    setMessagesBySession((prev) => {
      const next = { ...prev };
      const arr = next[sid] ? [...next[sid]] : [];
      arr.push({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date(),
      });
      next[sid] = arr;
      return next;
    });

    await prompt(text);

    // After prompt completes, clear streaming IDs
    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;
  }, [input, activeSessionId, onEnsureSession, prompt]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Chat
          </h2>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
          />
          {activeSessionId && (
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
              {activeSessionId.slice(0, 8)}
            </span>
          )}
        </div>
        {!connected ? (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
        {visibleMessages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
            {connected
              ? activeSessionId
                ? "Send a message. Each session runs its own opencode instance."
                : "Select or create a session on the left."
              : "Click Connect to start."}
          </div>
        )}
        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              connected
                ? activeSessionId
                  ? "Type a message..."
                  : "Type a message to auto-create a session..."
                : "Connect first..."
            }
            disabled={!connected || loading}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && handleSend()
            }
          />
          <button
            onClick={handleSend}
            disabled={!connected || loading || !input.trim()}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble Component ──────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const { role } = message;

  switch (role) {
    case "user":
      return <UserBubble content={message.content} />;
    case "assistant":
      return <AssistantBubble content={message.content} />;
    case "thought":
      return <ThoughtBubble content={message.content} />;
    case "tool":
      return (
        <ToolBubble
          content={message.content}
          toolName={message.toolName}
          toolStatus={message.toolStatus}
          toolKind={message.toolKind}
        />
      );
    case "plan":
      return (
        <PlanBubble
          content={message.content}
          entries={message.planEntries}
        />
      );
    case "info":
      if (message.usageUsed !== undefined) {
        return (
          <UsageBadge
            used={message.usageUsed}
            size={message.usageSize}
            costAmount={message.costAmount}
            costCurrency={message.costCurrency}
          />
        );
      }
      return <InfoBubble content={message.content} />;
    default:
      return null;
  }
}

// ─── User Bubble ───────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-blue-600 text-white text-sm whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ─── Assistant Bubble ──────────────────────────────────────────────────

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] px-4 py-3 rounded-2xl bg-gray-100 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
        <FormattedContent content={content} />
      </div>
    </div>
  );
}

// ─── Thought Bubble (collapsible, max 2 lines) ────────────────────────

function ThoughtBubble({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full text-left group"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <svg
              className={`w-3 h-3 text-purple-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
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
            <span className="text-[11px] font-medium text-purple-500 dark:text-purple-400 uppercase tracking-wide">
              Thinking
            </span>
          </div>
          <div
            className={`px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-700 dark:text-purple-300 whitespace-pre-wrap transition-all duration-150 ${
              expanded
                ? "max-h-60 overflow-y-auto"
                : "max-h-[2.8em] overflow-hidden"
            }`}
          >
            {content}
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Tool Bubble ───────────────────────────────────────────────────────

function ToolBubble({
  content,
  toolName,
  toolStatus,
  toolKind,
}: {
  content: string;
  toolName?: string;
  toolStatus?: string;
  toolKind?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    toolStatus === "completed"
      ? "bg-green-500"
      : toolStatus === "failed"
        ? "bg-red-500"
        : toolStatus === "in_progress" || toolStatus === "running"
          ? "bg-yellow-500 animate-pulse"
          : "bg-gray-400";

  const kindLabel = toolKind ? ` (${toolKind})` : "";

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
            {toolName ?? "tool"}{kindLabel}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto shrink-0">
            {toolStatus ?? "pending"}
          </span>
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="px-3 py-2 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50/50 dark:bg-gray-800/50">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plan Bubble ───────────────────────────────────────────────────────

function PlanBubble({
  content,
  entries,
}: {
  content: string;
  entries?: PlanEntry[];
}) {
  const [expanded, setExpanded] = useState(true);

  const statusIcon = (s?: string) => {
    switch (s) {
      case "completed":
        return "✓";
      case "in_progress":
        return "●";
      default:
        return "○";
    }
  };
  const priorityColor = (p?: string) => {
    switch (p) {
      case "high":
        return "text-red-500";
      case "medium":
        return "text-yellow-500";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-xl border border-indigo-200 dark:border-indigo-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-800 flex items-center gap-2 text-left"
        >
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Plan
          </span>
          <svg
            className={`w-3 h-3 text-indigo-400 transition-transform duration-150 ml-auto ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="px-3 py-2 bg-white dark:bg-gray-800">
            {entries ? (
              <div className="space-y-1">
                {entries.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span
                      className={`shrink-0 ${e.status === "completed" ? "text-green-500" : e.status === "in_progress" ? "text-blue-500" : "text-gray-400"}`}
                    >
                      {statusIcon(e.status)}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {e.content}
                    </span>
                    {e.priority && (
                      <span
                        className={`ml-auto shrink-0 text-[10px] ${priorityColor(e.priority)}`}
                      >
                        {e.priority}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {content}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Usage Badge ───────────────────────────────────────────────────────

function UsageBadge({
  used,
  size,
  costAmount,
  costCurrency,
}: {
  used?: number;
  size?: number;
  costAmount?: number;
  costCurrency?: string;
}) {
  if (used === undefined) return null;

  const pct = size ? Math.round((used / size) * 100) : 0;
  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400">
        <span>
          {formatTokens(used)}{size ? ` / ${formatTokens(size)}` : ""} tokens
        </span>
        {size ? (
          <div className="w-12 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-400" : pct > 50 ? "bg-yellow-400" : "bg-green-400"}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        ) : null}
        {costAmount !== undefined && costAmount > 0 && (
          <span className="text-gray-400">
            ${costAmount.toFixed(4)} {costCurrency ?? "USD"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Info Bubble ───────────────────────────────────────────────────────

function InfoBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-center">
      <div className="px-3 py-1 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400">
        {content}
      </div>
    </div>
  );
}

// ─── Simple Markdown-like formatter ────────────────────────────────────

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);

  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={j} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={j}
              className="px-1 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs font-mono"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={j}>{part}</span>;
      })}
    </>
  );
}

function FormattedContent({ content }: { content: string }) {
  const lines = content.split("\n");
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";
  const elements: ReactElement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block handling
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        inCodeBlock = false;
        elements.push(
          <div
            key={i}
            className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600"
          >
            {codeBlockLang && (
              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                {codeBlockLang}
              </div>
            )}
            <pre className="px-3 py-2 text-xs font-mono overflow-x-auto bg-gray-50 dark:bg-gray-800">
              {codeBlockLines.join("\n")}
            </pre>
          </div>
        );
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <div key={i} className="font-semibold mt-2 text-sm">
          {line.slice(4)}
        </div>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <div key={i} className="font-bold mt-2">
          {line.slice(3)}
        </div>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <div key={i} className="font-bold mt-2 text-lg">
          {line.slice(2)}
        </div>
      );
      continue;
    }

    // List items
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="pl-3 flex gap-1.5">
          <span className="text-gray-400 shrink-0">•</span>
          <span>
            <InlineMarkdown text={line.slice(2)} />
          </span>
        </div>
      );
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numberedMatch) {
      elements.push(
        <div key={i} className="pl-3 flex gap-1.5">
          <span className="text-gray-400 shrink-0">
            {numberedMatch[1]}.
          </span>
          <span>
            <InlineMarkdown text={numberedMatch[2]} />
          </span>
        </div>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      elements.push(
        <div
          key={i}
          className="pl-3 border-l-2 border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-400 italic"
        >
          <InlineMarkdown text={line.slice(2)} />
        </div>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1" />);
      continue;
    }

    // Normal text
    elements.push(
      <div key={i}>
        <InlineMarkdown text={line} />
      </div>
    );
  }

  // Unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <div
        key="unclosed-code"
        className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600"
      >
        {codeBlockLang && (
          <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
            {codeBlockLang}
          </div>
        )}
        <pre className="px-3 py-2 text-xs font-mono overflow-x-auto bg-gray-50 dark:bg-gray-800">
          {codeBlockLines.join("\n")}
        </pre>
      </div>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}
