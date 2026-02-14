"use client";

/**
 * ChatPanel - Full-screen ACP chat interface
 *
 * Renders streaming `session/update` SSE notifications from an opencode process.
 * Handles all ACP sessionUpdate types.
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
import { TiptapInput, type InputContext } from "./tiptap-input";
import type { SkillSummary } from "../skill-client";
import { RepoPicker, type RepoSelection } from "./repo-picker";

// ─── Message Types ─────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "thought" | "tool" | "plan" | "info";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolKind?: string;
  planEntries?: PlanEntry[];
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
  onEnsureSession: (cwd?: string, provider?: string, modeId?: string) => Promise<string | null>;
  skills?: SkillSummary[];
  onLoadSkill?: (name: string) => Promise<string | null>;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;
}

// ─── Main Component ────────────────────────────────────────────────────

export function ChatPanel({
  acp,
  activeSessionId,
  onEnsureSession,
  skills = [],
  onLoadSkill,
  repoSelection,
  onRepoChange,
}: ChatPanelProps) {
  const { connected, loading, error, updates, prompt } = acp;
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

    const updateMessages = (fn: (arr: ChatMessage[]) => ChatMessage[]) => {
      setMessagesBySession((prev) => {
        const next = { ...prev };
        next[sid] = fn(next[sid] ? [...next[sid]] : []);
        return next;
      });
    };

    switch (kind) {
      case "agent_message_chunk": {
        const text = extractText();
        if (!text) return;
        streamingThoughtIdRef.current[sid] = null;
        let msgId = streamingMsgIdRef.current[sid];
        if (!msgId) {
          msgId = crypto.randomUUID();
          streamingMsgIdRef.current[sid] = msgId;
        }
        const targetId = msgId;
        updateMessages((arr) => {
          const idx = arr.findIndex((m) => m.id === targetId);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], content: arr[idx].content + text };
          } else {
            arr.push({ id: targetId, role: "assistant", content: text, timestamp: new Date() });
          }
          return arr;
        });
        break;
      }

      case "agent_thought_chunk": {
        const text = extractText();
        if (!text) return;
        let thoughtId = streamingThoughtIdRef.current[sid];
        if (!thoughtId) {
          thoughtId = crypto.randomUUID();
          streamingThoughtIdRef.current[sid] = thoughtId;
        }
        const targetId = thoughtId;
        updateMessages((arr) => {
          const idx = arr.findIndex((m) => m.id === targetId);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], content: arr[idx].content + text };
          } else {
            arr.push({ id: targetId, role: "thought", content: text, timestamp: new Date() });
          }
          return arr;
        });
        break;
      }

      case "tool_call": {
        const toolCallId = update.toolCallId as string | undefined;
        const title = (update.title as string) ?? "tool";
        const status = (update.status as string) ?? "running";
        const toolKind = update.kind as string | undefined;
        const contentParts: string[] = [];
        if (update.rawInput) {
          contentParts.push(
            `Input:\n${typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput, null, 2)}`
          );
        }
        const toolContent = update.content as Array<{ type: string; text?: string }> | undefined;
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

      case "tool_call_update": {
        const toolCallId = update.toolCallId as string | undefined;
        const status = update.status as string | undefined;
        const outputParts: string[] = [];
        if (update.rawOutput) {
          outputParts.push(
            typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput, null, 2)
          );
        }
        const toolContent = update.content as Array<{ type: string; text?: string }> | null | undefined;
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

      case "plan": {
        const entries = update.entries as PlanEntry[] | undefined;
        const planText = entries
          ? entries.map((e) => `[${e.status ?? "pending"}] ${e.content}${e.priority ? ` (${e.priority})` : ""}`).join("\n")
          : typeof update.plan === "string" ? update.plan : JSON.stringify(update, null, 2);
        updateMessages((arr) => {
          arr.push({ id: crypto.randomUUID(), role: "plan", content: planText, timestamp: new Date(), planEntries: entries });
          return arr;
        });
        break;
      }

      case "usage_update": {
        const used = update.used as number | undefined;
        const size = update.size as number | undefined;
        const cost = update.cost as { amount: number; currency: string } | null | undefined;
        updateMessages((arr) => {
          const usageIdx = arr.findIndex((m) => m.role === "info" && m.usageUsed !== undefined);
          const usageMsg: ChatMessage = {
            id: usageIdx >= 0 ? arr[usageIdx].id : crypto.randomUUID(),
            role: "info", content: "", timestamp: new Date(),
            usageUsed: used, usageSize: size, costAmount: cost?.amount, costCurrency: cost?.currency,
          };
          if (usageIdx >= 0) { arr[usageIdx] = usageMsg; } else { arr.push(usageMsg); }
          return arr;
        });
        break;
      }

      case "current_mode_update": {
        const modeId = update.currentModeId as string | undefined;
        if (modeId) {
          updateMessages((arr) => {
            arr.push({ id: crypto.randomUUID(), role: "info", content: `Mode changed to: ${modeId}`, timestamp: new Date() });
            return arr;
          });
        }
        break;
      }

      case "available_commands_update":
      case "config_option_update":
      case "session_info_update":
        break;

      default:
        console.log(`[ChatPanel] Unhandled sessionUpdate: ${kind}`);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleRepoChange = onRepoChange;

  const handleSend = useCallback(async (text: string, context: InputContext) => {
    if (!text.trim()) return;

    // Use cwd from repo selection if set
    const cwd = context.cwd || repoSelection?.path || undefined;

    // If user selected a provider via @mention, switch to it
    if (context.provider) {
      acp.setProvider(context.provider);
    }

    // Ensure we have a session — pass cwd and provider
    const sid = activeSessionId ?? (await onEnsureSession(cwd, context.provider, context.mode));
    if (!sid) return;
    if (context.mode) {
      await acp.setMode(context.mode);
    }


    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // Build the final prompt:
    // - If a skill is selected, prepend its content
    let finalPrompt = text;
    if (context.skill && onLoadSkill) {
      const skillContent = await onLoadSkill(context.skill);
      if (skillContent) {
        finalPrompt = `[Skill: ${context.skill}]\n${skillContent}\n\n---\n\n${text}`;
      }
    }

    // Show the user message
    setMessagesBySession((prev) => {
      const next = { ...prev };
      const arr = next[sid] ? [...next[sid]] : [];
      const displayParts: string[] = [];
      if (context.provider) displayParts.push(`@${context.provider}`);
      if (context.mode) displayParts.push(`#${context.mode}`);
      if (context.skill) displayParts.push(`/${context.skill}`);
      const prefix = displayParts.length ? displayParts.join(" ") + " " : "";
      arr.push({ id: crypto.randomUUID(), role: "user", content: prefix + text, timestamp: new Date() });
      next[sid] = arr;
      return next;
    });

    await prompt(finalPrompt);

    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;
  }, [activeSessionId, onEnsureSession, prompt, repoSelection, onLoadSkill, acp]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f1117]">
      {/* Session info bar */}
      {activeSessionId && (
        <div className="px-5 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
            Session: {activeSessionId.slice(0, 12)}...
          </span>
        </div>
      )}

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs border-b border-red-100 dark:border-red-900/20">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-4">
          {visibleMessages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                {connected
                  ? activeSessionId
                    ? "Send a message to start."
                    : "Select or create a session from the sidebar."
                  : "Connect via the top bar to get started."}
              </div>

              {/* ── Repo Picker in center when no messages ── */}
              {connected && (
                <div className="inline-block text-left">
                  <RepoPicker
                    value={repoSelection}
                    onChange={handleRepoChange}
                  />
                </div>
              )}
            </div>
          )}
          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-[#0f1117]">
        <div className="max-w-3xl mx-auto px-5 py-3">
          <div className="flex gap-2 items-end">
            <TiptapInput
              onSend={handleSend}
              placeholder={
                connected
                  ? activeSessionId
                    ? "Type a message... @ provider, / skill, Enter to send"
                    : "Type a message to auto-create a session..."
                  : "Connect first..."
              }
              disabled={!connected}
              loading={loading}
              skills={skills}
              providers={acp.providers}
              selectedProvider={acp.selectedProvider}
              repoSelection={repoSelection}
              onRepoChange={handleRepoChange}
            />
          </div>
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
      return <PlanBubble content={message.content} entries={message.planEntries} />;
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
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-blue-600 text-white text-sm whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ─── Assistant Bubble ──────────────────────────────────────────────────

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-gray-50 dark:bg-[#1a1d2e] text-sm text-gray-900 dark:text-gray-100">
        <FormattedContent content={content} />
      </div>
    </div>
  );
}

// ─── Thought Bubble ────────────────────────────────────────────────────

function ThoughtBubble({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full text-left group">
          <div className="flex items-center gap-1.5 mb-0.5">
            <svg
              className={`w-3 h-3 text-purple-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[11px] font-medium text-purple-500 dark:text-purple-400 uppercase tracking-wide">
              Thinking
            </span>
          </div>
          <div
            className={`px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/50 text-xs text-purple-700 dark:text-purple-300 whitespace-pre-wrap transition-all duration-150 ${
              expanded ? "max-h-60 overflow-y-auto" : "max-h-[2.8em] overflow-hidden"
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
  content, toolName, toolStatus, toolKind,
}: {
  content: string; toolName?: string; toolStatus?: string; toolKind?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor =
    toolStatus === "completed" ? "bg-green-500"
      : toolStatus === "failed" ? "bg-red-500"
        : toolStatus === "in_progress" || toolStatus === "running" ? "bg-yellow-500 animate-pulse"
          : "bg-gray-400";
  const kindLabel = toolKind ? ` (${toolKind})` : "";

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-[#161922] border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
            {toolName ?? "tool"}{kindLabel}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto shrink-0">
            {toolStatus ?? "pending"}
          </span>
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="px-3 py-2 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto bg-white dark:bg-[#0f1117]">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plan Bubble ───────────────────────────────────────────────────────

function PlanBubble({ content, entries }: { content: string; entries?: PlanEntry[] }) {
  const [expanded, setExpanded] = useState(true);
  const statusIcon = (s?: string) => {
    switch (s) { case "completed": return "\u2713"; case "in_progress": return "\u25CF"; default: return "\u25CB"; }
  };
  const priorityColor = (p?: string) => {
    switch (p) { case "high": return "text-red-500"; case "medium": return "text-yellow-500"; default: return "text-gray-400"; }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center gap-2 text-left"
        >
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Plan</span>
          <svg
            className={`w-3 h-3 text-indigo-400 transition-transform duration-150 ml-auto ${expanded ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="px-3 py-2 bg-white dark:bg-[#0f1117]">
            {entries ? (
              <div className="space-y-1">
                {entries.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={`shrink-0 ${e.status === "completed" ? "text-green-500" : e.status === "in_progress" ? "text-blue-500" : "text-gray-400"}`}>
                      {statusIcon(e.status)}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{e.content}</span>
                    {e.priority && (
                      <span className={`ml-auto shrink-0 text-[10px] ${priorityColor(e.priority)}`}>{e.priority}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{content}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Usage Badge ───────────────────────────────────────────────────────

function UsageBadge({ used, size, costAmount, costCurrency }: { used?: number; size?: number; costAmount?: number; costCurrency?: string }) {
  if (used === undefined) return null;
  const pct = size ? Math.round((used / size) * 100) : 0;
  const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-50 dark:bg-[#161922] border border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
        <span>{formatTokens(used)}{size ? ` / ${formatTokens(size)}` : ""} tokens</span>
        {size ? (
          <div className="w-12 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-400" : pct > 50 ? "bg-yellow-400" : "bg-green-400"}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        ) : null}
        {costAmount !== undefined && costAmount > 0 && (
          <span className="text-gray-400">${costAmount.toFixed(4)} {costCurrency ?? "USD"}</span>
        )}
      </div>
    </div>
  );
}

// ─── Info Bubble ───────────────────────────────────────────────────────

function InfoBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-center">
      <div className="px-3 py-1 rounded-full bg-gray-50 dark:bg-[#161922] border border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
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
          return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={j} className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
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
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        inCodeBlock = false;
        elements.push(
          <div key={i} className="my-2 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800">
            {codeBlockLang && (
              <div className="px-3 py-1 bg-gray-50 dark:bg-[#161922] text-[10px] text-gray-400 border-b border-gray-100 dark:border-gray-800">
                {codeBlockLang}
              </div>
            )}
            <pre className="px-3 py-2 text-xs font-mono overflow-x-auto bg-gray-50 dark:bg-[#0d0f17]">
              {codeBlockLines.join("\n")}
            </pre>
          </div>
        );
        continue;
      }
    }
    if (inCodeBlock) { codeBlockLines.push(line); continue; }
    if (line.startsWith("### ")) {
      elements.push(<div key={i} className="font-semibold mt-2 text-sm">{line.slice(4)}</div>);
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<div key={i} className="font-bold mt-2">{line.slice(3)}</div>);
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(<div key={i} className="font-bold mt-2 text-lg">{line.slice(2)}</div>);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="pl-3 flex gap-1.5">
          <span className="text-gray-400 shrink-0">&bull;</span>
          <span><InlineMarkdown text={line.slice(2)} /></span>
        </div>
      );
      continue;
    }
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numberedMatch) {
      elements.push(
        <div key={i} className="pl-3 flex gap-1.5">
          <span className="text-gray-400 shrink-0">{numberedMatch[1]}.</span>
          <span><InlineMarkdown text={numberedMatch[2]} /></span>
        </div>
      );
      continue;
    }
    if (line.startsWith("> ")) {
      elements.push(
        <div key={i} className="pl-3 border-l-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 italic">
          <InlineMarkdown text={line.slice(2)} />
        </div>
      );
      continue;
    }
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1" />);
      continue;
    }
    elements.push(<div key={i}><InlineMarkdown text={line} /></div>);
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <div key="unclosed-code" className="my-2 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800">
        {codeBlockLang && (
          <div className="px-3 py-1 bg-gray-50 dark:bg-[#161922] text-[10px] text-gray-400 border-b border-gray-100 dark:border-gray-800">
            {codeBlockLang}
          </div>
        )}
        <pre className="px-3 py-2 text-xs font-mono overflow-x-auto bg-gray-50 dark:bg-[#0d0f17]">
          {codeBlockLines.join("\n")}
        </pre>
      </div>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}
