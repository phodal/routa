"use client";

/**
 * TaskPanel - Right-side panel for Routa Agent sub-tasks.
 *
 * Two views:
 *   1. Tasks View: Displays parsed @@@task blocks. Users can confirm, edit, execute.
 *   2. CRAFTERs View: After execution, shows per-agent chat history tabs.
 *
 * Features:
 *   - Concurrency control (1 or 2 parallel agents) for Execute All
 *   - Switchable tabs for each CRAFTER agent's chat history
 *   - Mermaid diagram rendering in agent responses
 */

import { startTransition, useState, useRef, useEffect } from "react";
import type { ParsedTask } from "../utils/task-block-parser";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { MermaidRenderer } from "./markdown/mermaid-renderer";
import { normalizeThoughtContent } from "./chat-panel/thought-content";
import { getToolEventLabel } from "./chat-panel/tool-call-name";
import { useTranslation } from "@/i18n";
import { Check, ChevronDown, ChevronRight, TriangleAlert, Zap } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


// ─── Types ──────────────────────────────────────────────────────────────

export interface CrafterAgent {
  id: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  status: "running" | "completed" | "error";
  messages: CrafterMessage[];
}

export interface CrafterMessage {
  id: string;
  role: "assistant" | "thought" | "tool" | "info";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolStatus?: string;
}

type PanelView = "tasks" | "crafters";

interface TaskPanelProps {
  tasks: ParsedTask[];
  onConfirmAll?: () => void;
  onExecuteAll?: (concurrency: number) => void;
  onConfirmTask?: (taskId: string) => void;
  onEditTask?: (taskId: string, updated: Partial<ParsedTask>) => void;
  onExecuteTask?: (taskId: string) => void;
  /** CRAFTER agents spawned from tasks */
  crafterAgents?: CrafterAgent[];
  /** Currently active crafter agent ID in the view */
  activeCrafterId?: string | null;
  /** Callback when user selects a crafter tab */
  onSelectCrafter?: (agentId: string) => void;
  /** Current concurrency setting */
  concurrency?: number;
  /** Callback when concurrency changes */
  onConcurrencyChange?: (n: number) => void;
  /** Abort a running CRAFTER agent */
  onAbortCrafter?: (agentId: string, sessionId: string) => Promise<void>;
  /** Manually mark a CRAFTER agent as done */
  onMarkDoneCrafter?: (agentId: string) => void;
  /** Callback to update agent messages after lazy-loading from DB */
  onUpdateAgentMessages?: (agentId: string, messages: CrafterMessage[]) => void;
}

export function TaskPanel({
  tasks,
  onConfirmAll,
  onExecuteAll,
  onConfirmTask,
  onEditTask,
  onExecuteTask,
  crafterAgents = [],
  activeCrafterId,
  onSelectCrafter,
  concurrency = 1,
  onConcurrencyChange,
  onAbortCrafter: _onAbortCrafter,
  onMarkDoneCrafter: _onMarkDoneCrafter,
  onUpdateAgentMessages,
}: TaskPanelProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [userViewMode, setUserViewMode] = useState<PanelView | null>(null);
  const viewMode = userViewMode ?? (crafterAgents.length > 0 ? "crafters" : "tasks");
  const { t } = useTranslation();

  if (tasks.length === 0 && crafterAgents.length === 0) return null;

  const hasPending = tasks.some((t) => t.status === "pending");
  const hasConfirmed = tasks.some((t) => t.status === "confirmed");
  const hasRunning = tasks.some((t) => t.status === "running");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {crafterAgents.length > 0 ? t.tasks.routaCrafters : t.tasks.subTasks}
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
              {tasks.length}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {hasPending && onConfirmAll && (
              <button
                onClick={onConfirmAll}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                {t.tasks.confirmAll}
              </button>
            )}
            {hasConfirmed && !hasRunning && onExecuteAll && (
              <button
                onClick={() => onExecuteAll(concurrency)}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {t.tasks.executeAll}
              </button>
            )}
            {hasRunning && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 animate-pulse">
                {t.tasks.executing}
              </span>
            )}
          </div>
        </div>

        {/* Concurrency control + View toggle */}
        <div className="flex items-center justify-between">
          {/* Concurrency selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.tasks.concurrency}
            </span>
            <div className="flex items-center rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              {[1, 2].map((n) => (
                <button
                  key={n}
                  onClick={() => onConcurrencyChange?.(n)}
                  className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${concurrency === n
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* View toggle */}
          {crafterAgents.length > 0 && (
            <div className="flex items-center rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => setUserViewMode("tasks")}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${viewMode === "tasks"
                  ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
              >
                {t.tasks.viewTasks}
              </button>
              <button
                onClick={() => setUserViewMode("crafters")}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${viewMode === "crafters"
                  ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
              >
                {t.tasks.viewCrafters} ({crafterAgents.length})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === "tasks" ? (
        /* ─── Task List ────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                expanded={expandedTaskId === task.id}
                editing={editingTaskId === task.id}
                onToggleExpand={() =>
                  setExpandedTaskId((prev) => (prev === task.id ? null : task.id))
                }
                onEdit={() => setEditingTaskId(task.id)}
                onCancelEdit={() => setEditingTaskId(null)}
                onSaveEdit={(updated) => {
                  onEditTask?.(task.id, updated);
                  setEditingTaskId(null);
                }}
                onConfirm={() => onConfirmTask?.(task.id)}
                onExecute={() => onExecuteTask?.(task.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        /* ─── CRAFTERs View ───────────────────────────────── */
        <CraftersView
          agents={crafterAgents}
          activeCrafterId={activeCrafterId}
          onSelectCrafter={onSelectCrafter}
          onUpdateAgentMessages={onUpdateAgentMessages}
        />
      )}
    </div>
  );
}

// ─── CRAFTERs View ──────────────────────────────────────────────────────

export function CraftersView({
  agents,
  activeCrafterId,
  onSelectCrafter,
  onUpdateAgentMessages,
}: {
  agents: CrafterAgent[];
  activeCrafterId?: string | null;
  onSelectCrafter?: (id: string) => void;
  /** Callback to update agent messages after lazy-loading from DB */
  onUpdateAgentMessages?: (agentId: string, messages: CrafterMessage[]) => void;
}) {
  const activeAgent = agents.find((a) => a.id === activeCrafterId) ?? agents[0];
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track which agents we've already fetched history for
  const fetchedHistoryRef = useRef<Set<string>>(new Set());
  const [historyStateByAgentId, setHistoryStateByAgentId] = useState<
    Record<string, "idle" | "loading" | "loaded">
  >({});
  const activeAgentHistoryState = activeAgent ? (historyStateByAgentId[activeAgent.id] ?? "idle") : "idle";

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeAgent?.messages.length]);

  // Lazy-load child session history for restored CRAFTERs with empty messages
  useEffect(() => {
    if (!activeAgent || activeAgent.messages.length > 0 || !activeAgent.sessionId) return;
    if (activeAgent.status === "running") return; // Don't load history for running agents
    if (fetchedHistoryRef.current.has(activeAgent.id)) return;
    fetchedHistoryRef.current.add(activeAgent.id);
    startTransition(() => {
      setHistoryStateByAgentId((prev) => ({ ...prev, [activeAgent.id]: "loading" }));
    });

    desktopAwareFetch(`/api/sessions/${activeAgent.sessionId}/history?consolidated=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.history?.length) {
          setHistoryStateByAgentId((prev) => ({ ...prev, [activeAgent.id]: "loaded" }));
          return;
        }
        const history = data.history as Array<{
          sessionId: string;
          update?: {
            sessionUpdate?: string;
            content?: { type: string; text?: string };
            title?: string;
            status?: string;
          };
        }>;

        // Convert session history notifications into CrafterMessages
        const messages: CrafterMessage[] = [];
        for (const entry of history) {
          const update = entry.update;
          if (!update?.sessionUpdate) continue;

          const text = update.content?.text ?? "";
          switch (update.sessionUpdate) {
            case "agent_message":
            case "agent_message_chunk":
              if (text) {
                const last = messages[messages.length - 1];
                if (last && last.role === "assistant" && !last.toolName) {
                  // Append to existing message, keep original ID
                  last.content += text;
                } else {
                  // Create new message with unique ID
                  messages.push({
                    id: `assistant-${crypto.randomUUID()}`,
                    role: "assistant",
                    content: text,
                    timestamp: new Date(),
                  });
                }
              }
              break;
            case "agent_thought":
            case "agent_thought_chunk":
              if (text) {
                const last = messages[messages.length - 1];
                if (last && last.role === "thought") {
                  // Append to existing thought message, keep original ID
                  last.content += text;
                } else {
                  // Create new thought message with unique ID
                  messages.push({
                    id: `thought-${crypto.randomUUID()}`,
                    role: "thought",
                    content: text,
                    timestamp: new Date(),
                  });
                }
              }
              break;
            case "tool_call": {
              const toolName = getToolEventLabel(update as Record<string, unknown>);
              messages.push({
                id: `tool-${crypto.randomUUID()}`,
                role: "tool",
                content: toolName,
                timestamp: new Date(),
                toolName,
                toolStatus: update.status ?? "completed",
              });
              break;
            }
          }
        }

        if (messages.length > 0 && onUpdateAgentMessages) {
          onUpdateAgentMessages(activeAgent.id, messages);
        }
        setHistoryStateByAgentId((prev) => ({ ...prev, [activeAgent.id]: "loaded" }));
      })
      .catch(() => {
        // Silently fail — history loading is best-effort
        setHistoryStateByAgentId((prev) => ({ ...prev, [activeAgent.id]: "loaded" }));
      });
  }, [activeAgent, onUpdateAgentMessages]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 p-4">
        {t.tasks.noCraftersYet}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Agent Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
        {agents.map((agent, i) => {
          const isActive = agent.id === (activeCrafterId ?? agents[0]?.id);
          const statusColor =
            agent.status === "running"
              ? "bg-amber-500"
              : agent.status === "completed"
                ? "bg-emerald-500"
                : "bg-red-500";

          return (
            <button
              key={agent.id}
              onClick={() => onSelectCrafter?.(agent.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${isActive
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              title={agent.taskTitle}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${agent.status === "running" ? "animate-pulse" : ""}`} />
              <span className="truncate max-w-30">
                {agent.taskTitle || t.tasks.crafterNumber.replace('{number}', String(i + 1))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Agent Info */}
      {activeAgent && (
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#161922]">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${activeAgent.status === "running" ? "bg-amber-500 animate-pulse" :
              activeAgent.status === "completed" ? "bg-emerald-500" : "bg-red-500"
              }`} />
            <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {activeAgent.taskTitle}
            </span>
            <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 capitalize">
              {activeAgent.status}
            </span>
          </div>
        </div>
      )}

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-2">
          {activeAgent?.messages.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-400 dark:text-slate-500">
              {activeAgent.status === "running" ? (
                <div className="space-y-2">
                  <div className="w-5 h-5 mx-auto border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin" />
                  <div>{t.tasks.agentWorking}</div>
                </div>
              ) : activeAgentHistoryState === "loading" ? (
                <div className="space-y-2">
                  <div className="w-5 h-5 mx-auto border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin" />
                  <div>{t.tasks.loadingHistory}</div>
                </div>
              ) : activeAgent.status === "error" ? (
                <div className="space-y-2 text-red-500 dark:text-red-400">
                  <TriangleAlert className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  <div>{t.tasks.agentFailedToStart}</div>
                </div>
              ) : (
                t.tasks.noMessagesYet
              )}
            </div>
          )}
          {activeAgent?.messages.map((msg) => (
            <CrafterMessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}

// ─── Crafter Message Bubble ──────────────────────────────────────────────

function CrafterMessageBubble({ message }: { message: CrafterMessage }) {
  const [expanded, setExpanded] = useState(message.role === "assistant");
  const { t } = useTranslation();
  const displayContent = message.role === "thought"
    ? normalizeThoughtContent(message.content)
    : message.content;

  // Check for mermaid code blocks
  const mermaidMatch = message.content.match(/```mermaid\n([\s\S]*?)```/);

  if (message.role === "thought") {
    return (
      <div className="group">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full text-left"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t.tasks.thinking}
            </span>
          </div>
          <div
            className={`px-2 py-1.5 rounded-md bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-700/50 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap transition-all duration-150 ${expanded ? "max-h-40 overflow-y-auto" : "max-h-[2em] overflow-hidden"
              }`}
          >
            {displayContent}
          </div>
        </button>
      </div>
    );
  }

  if (message.role === "tool") {
    const statusColor =
      message.toolStatus === "completed" ? "bg-emerald-500" :
        message.toolStatus === "failed" ? "bg-red-500" :
          "bg-amber-500 animate-pulse";

    return (
      <div className="rounded-md border border-slate-100 dark:border-slate-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-2.5 py-1 bg-slate-50 dark:bg-[#161922] border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
            {message.toolName ?? t.tasks.toolName}
          </span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500 ml-auto">
            {message.toolStatus ?? t.tasks.toolStatus}
          </span>
          <ChevronRight className={`w-2.5 h-2.5 text-slate-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </button>
        {expanded && (
          <div className="px-2.5 py-1.5 text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto bg-white dark:bg-[#0f1117]">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  if (message.role === "info") {
    const isError = message.content.toLowerCase().startsWith("error") || message.content.toLowerCase().includes("failed");
    return (
      <div className={`px-2.5 py-2 rounded-md text-[11px] border ${isError
        ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300"
        : "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-300"
        }`}>
        <MarkdownViewer content={message.content} className="text-[11px]" />
      </div>
    );
  }

  // Assistant message
  return (
    <div className="text-xs text-slate-900 dark:text-slate-100">
      {mermaidMatch ? (
        <div className="space-y-2">
          {/* Render text before mermaid */}
          {message.content.split(/```mermaid\n[\s\S]*?```/)[0].trim() && (
            <MarkdownViewer
              content={message.content.split(/```mermaid\n[\s\S]*?```/)[0].trim()}
              className="text-xs"
            />
          )}
          {/* Render mermaid diagram */}
          <MermaidRenderer code={mermaidMatch[1]} className="my-2" />
          {/* Render text after mermaid */}
          {message.content.split(/```mermaid\n[\s\S]*?```/).slice(1).join("").trim() && (
            <MarkdownViewer
              content={message.content.split(/```mermaid\n[\s\S]*?```/).slice(1).join("").trim()}
              className="text-xs"
            />
          )}
        </div>
      ) : (
        <MarkdownViewer content={message.content} className="text-xs" />
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────

interface TaskCardProps {
  task: ParsedTask;
  index: number;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updated: Partial<ParsedTask>) => void;
  onConfirm: () => void;
  onExecute: () => void;
}

function TaskCard({
  task,
  index,
  expanded,
  editing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onConfirm,
  onExecute,
}: TaskCardProps) {
  const { t } = useTranslation();
  const statusColors = {
    pending: "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700",
    confirmed: "bg-blue-50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800",
    running: "bg-amber-50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800",
    completed: "bg-emerald-50 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800",
  };

  const statusIcons = {
    pending: (
      <div className="h-5 w-5 shrink-0 rounded-md border-2 border-slate-300 dark:border-slate-600" />
    ),
    confirmed: (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-600">
        <Check className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}/>
      </div>
    ),
    running: (
      <div className="flex h-5 w-5 shrink-0 animate-pulse items-center justify-center rounded-md bg-amber-500">
        <Zap className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    ),
    completed: (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500">
        <Check className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}/>
      </div>
    ),
  };

  return (
    <div className={`rounded-lg border transition-all ${statusColors[task.status]}`}>
      {/* Header - always visible */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
        onClick={onToggleExpand}
      >
        {statusIcons[task.status]}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
              #{index + 1}
            </span>
            <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {task.title}
            </span>
          </div>
          {!expanded && task.objective && (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              {task.objective}
            </p>
          )}
        </div>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 dark:border-slate-700/50">
          {editing ? (
            <TaskEditor
              task={task}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
            />
          ) : (
            <>
              <TaskContent task={task} />
              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-700/50">
                {task.status === "pending" && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                      className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      {t.common.confirm}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(); }}
                      className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                      {t.common.edit}
                    </button>
                  </>
                )}
                {task.status === "confirmed" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExecute(); }}
                    className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    {t.common.execute}
                  </button>
                )}
                {task.status === "running" && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t.common.running}
                  </span>
                )}
                {task.status === "completed" && (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    {t.common.completed}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Content (Markdown-rendered via MarkdownViewer) ───────────────

function TaskContent({ task }: { task: ParsedTask }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2.5 space-y-2.5 text-xs">
      {task.objective && (
        <Section title={t.tasks.objective}>
          <MarkdownViewer content={task.objective} className="text-slate-600 dark:text-slate-300" />
        </Section>
      )}
      {task.scope && (
        <Section title={t.tasks.scope}>
          <MarkdownViewer content={task.scope} className="text-slate-600 dark:text-slate-300" />
        </Section>
      )}
      {task.definitionOfDone && (
        <Section title={t.tasks.definitionOfDone}>
          <MarkdownViewer content={task.definitionOfDone} className="text-slate-600 dark:text-slate-300" />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </h4>
      {children}
    </div>
  );
}

// ─── Task Editor ──────────────────────────────────────────────────────

function TaskEditor({
  task,
  onSave,
  onCancel,
}: {
  task: ParsedTask;
  onSave: (updated: Partial<ParsedTask>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(task.title);
  const [objective, setObjective] = useState(task.objective);
  const [scope, setScope] = useState(task.scope);
  const [dod, setDod] = useState(task.definitionOfDone);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="mt-2.5 space-y-2">
      <div>
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">{t.tasks.title}</label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">{t.tasks.objective}</label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={2}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">{t.tasks.scope}</label>
        <textarea
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={3}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">{t.tasks.definitionOfDone}</label>
        <textarea
          value={dod}
          onChange={(e) => setDod(e.target.value)}
          rows={3}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ title, objective, scope, definitionOfDone: dod })}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {t.common.save}
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
