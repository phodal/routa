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

import { useState, useRef, useEffect } from "react";
import type { ParsedTask } from "../utils/task-block-parser";
import { MarkdownViewer } from "./markdown-viewer";
import { MermaidRenderer } from "./mermaid-renderer";

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
}: TaskPanelProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PanelView>("tasks");

  // Auto-switch to crafters view when agents appear
  useEffect(() => {
    if (crafterAgents.length > 0 && viewMode === "tasks") {
      setViewMode("crafters");
    }
  }, [crafterAgents.length, viewMode]);

  if (tasks.length === 0 && crafterAgents.length === 0) return null;

  const hasPending = tasks.some((t) => t.status === "pending");
  const hasConfirmed = tasks.some((t) => t.status === "confirmed");
  const hasRunning = tasks.some((t) => t.status === "running");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {crafterAgents.length > 0 ? "ROUTA / CRAFTERs" : "Sub Tasks"}
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">
              {tasks.length}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {hasPending && onConfirmAll && (
              <button
                onClick={onConfirmAll}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Confirm All
              </button>
            )}
            {hasConfirmed && !hasRunning && onExecuteAll && (
              <button
                onClick={() => onExecuteAll(concurrency)}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Execute All
              </button>
            )}
            {hasRunning && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 animate-pulse">
                Executing...
              </span>
            )}
          </div>
        </div>

        {/* Concurrency control + View toggle */}
        <div className="flex items-center justify-between">
          {/* Concurrency selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Concurrency
            </span>
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              {[1, 2].map((n) => (
                <button
                  key={n}
                  onClick={() => onConcurrencyChange?.(n)}
                  className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    concurrency === n
                      ? "bg-indigo-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* View toggle */}
          {crafterAgents.length > 0 && (
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setViewMode("tasks")}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  viewMode === "tasks"
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Tasks
              </button>
              <button
                onClick={() => setViewMode("crafters")}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  viewMode === "crafters"
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                CRAFTERs ({crafterAgents.length})
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
        />
      )}
    </div>
  );
}

// ─── CRAFTERs View ──────────────────────────────────────────────────────

function CraftersView({
  agents,
  activeCrafterId,
  onSelectCrafter,
}: {
  agents: CrafterAgent[];
  activeCrafterId?: string | null;
  onSelectCrafter?: (id: string) => void;
}) {
  const activeAgent = agents.find((a) => a.id === activeCrafterId) ?? agents[0];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeAgent?.messages.length]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 p-4">
        No CRAFTER agents running yet. Execute tasks to spawn agents.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Agent Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        {agents.map((agent, i) => {
          const isActive = agent.id === (activeCrafterId ?? agents[0]?.id);
          const statusColor =
            agent.status === "running"
              ? "bg-amber-500"
              : agent.status === "completed"
              ? "bg-green-500"
              : "bg-red-500";

          return (
            <button
              key={agent.id}
              onClick={() => onSelectCrafter?.(agent.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title={agent.taskTitle}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${agent.status === "running" ? "animate-pulse" : ""}`} />
              <span className="truncate max-w-[120px]">
                CRAFTER #{i + 1}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Agent Info */}
      {activeAgent && (
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#161922]">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              activeAgent.status === "running" ? "bg-amber-500 animate-pulse" :
              activeAgent.status === "completed" ? "bg-green-500" : "bg-red-500"
            }`} />
            <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
              {activeAgent.taskTitle}
            </span>
            <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 capitalize">
              {activeAgent.status}
            </span>
          </div>
        </div>
      )}

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-2">
          {activeAgent?.messages.length === 0 && (
            <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
              {activeAgent.status === "running" ? (
                <div className="space-y-2">
                  <div className="w-5 h-5 mx-auto border-2 border-gray-300 dark:border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
                  <div>Agent is working...</div>
                </div>
              ) : (
                "No messages yet."
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
            <svg
              className={`w-3 h-3 text-purple-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[10px] font-medium text-purple-500 dark:text-purple-400 uppercase tracking-wide">
              Thinking
            </span>
          </div>
          <div
            className={`px-2 py-1.5 rounded-md bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/50 text-[11px] text-purple-700 dark:text-purple-300 whitespace-pre-wrap transition-all duration-150 ${
              expanded ? "max-h-40 overflow-y-auto" : "max-h-[2em] overflow-hidden"
            }`}
          >
            {message.content}
          </div>
        </button>
      </div>
    );
  }

  if (message.role === "tool") {
    const statusColor =
      message.toolStatus === "completed" ? "bg-green-500" :
      message.toolStatus === "failed" ? "bg-red-500" :
      "bg-yellow-500 animate-pulse";

    return (
      <div className="rounded-md border border-gray-100 dark:border-gray-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-2.5 py-1 bg-gray-50 dark:bg-[#161922] border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-300 truncate">
            {message.toolName ?? "tool"}
          </span>
          <span className="text-[9px] text-gray-400 dark:text-gray-500 ml-auto">
            {message.toolStatus ?? "pending"}
          </span>
          <svg
            className={`w-2.5 h-2.5 text-gray-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="px-2.5 py-1.5 text-[10px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-32 overflow-y-auto bg-white dark:bg-[#0f1117]">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  // Assistant message
  return (
    <div className="text-xs text-gray-900 dark:text-gray-100">
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
  const statusColors = {
    pending: "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700",
    confirmed: "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800",
    running: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800",
    completed: "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800",
  };

  const statusIcons = {
    pending: (
      <div className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />
    ),
    confirmed: (
      <div className="w-5 h-5 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    ),
    running: (
      <div className="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center flex-shrink-0 animate-pulse">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
    ),
    completed: (
      <div className="w-5 h-5 rounded-md bg-green-500 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    ),
  };

  return (
    <div className={`rounded-lg border transition-all ${statusColors[task.status]}`}>
      {/* Header - always visible */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
        onClick={onToggleExpand}
      >
        {statusIcons[task.status]}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500">
              #{index + 1}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {task.title}
            </span>
          </div>
          {!expanded && task.objective && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
              {task.objective}
            </p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 mt-0.5 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700/50">
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
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/50">
                {task.status === "pending" && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(); }}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      Edit
                    </button>
                  </>
                )}
                {task.status === "confirmed" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExecute(); }}
                    className="text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    Execute
                  </button>
                )}
                {task.status === "running" && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    Running...
                  </span>
                )}
                {task.status === "completed" && (
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Completed
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
  return (
    <div className="mt-2.5 space-y-2.5 text-xs">
      {task.objective && (
        <Section title="Objective">
          <MarkdownViewer content={task.objective} className="text-gray-600 dark:text-gray-300" />
        </Section>
      )}
      {task.scope && (
        <Section title="Scope">
          <MarkdownViewer content={task.scope} className="text-gray-600 dark:text-gray-300" />
        </Section>
      )}
      {task.definitionOfDone && (
        <Section title="Definition of Done">
          <MarkdownViewer content={task.definitionOfDone} className="text-gray-600 dark:text-gray-300" />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
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
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Title</label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Objective</label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={2}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Scope</label>
        <textarea
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={3}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Definition of Done</label>
        <textarea
          value={dod}
          onChange={(e) => setDod(e.target.value)}
          rows={3}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ title, objective, scope, definitionOfDone: dod })}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
