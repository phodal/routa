"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "@/i18n";
import {SessionContextPanel} from "@/client/components/session-context-panel";
import {type CrafterAgent, TaskPanel} from "@/client/components/task-panel";
import {CollaborativeTaskEditor} from "@/client/components/collaborative-task-editor";
import {MarkdownViewer} from "@/client/components/markdown/markdown-viewer";
import type {ParsedTask} from "@/client/utils/task-block-parser";
import type {RepoSelection} from "@/client/components/repo-picker";
import type {NoteData} from "@/client/hooks/use-notes";
import { FileText, Folder, Plus, X, MessageSquareMore, ClipboardCheck, ChevronsRight, ChevronsLeft, Play } from "lucide-react";


type SidebarTab = "sessions" | "spec" | "tasks";
const SESSIONS_QUICK_ACCESS_RATIO_KEY = "routa.session.sidebar-sessions-quick-access-ratio";

interface LeftSidebarProps {
  // Sidebar dimensions & collapse
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobileSidebar?: () => void;
  width: number;
  showMobileSidebar: boolean;
  onResizeStart: (e: React.MouseEvent) => void;

  // Session & workspace
  sessionId: string;
  focusedSessionId?: string | null;
  workspaceId: string;
  refreshKey: number;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (provider: string) => void;

  // Codebase
  codebases: Array<{ repoPath: string; branch?: string; label?: string; isDefault?: boolean }>;
  repoSelection: RepoSelection | null;

  // ACP (provider state for new-session button)
  hasProviders: boolean;
  hasSelectedProvider: boolean;

  // Tasks
  routaTasks: ParsedTask[];
  onConfirmAllTasks: () => void;
  onExecuteAllTasks: (concurrency: number) => void;
  onConfirmTask: (taskId: string) => void;
  onEditTask: (taskId: string, updated: Partial<ParsedTask>) => void;
  onExecuteTask: (taskId: string) => Promise<CrafterAgent | null>;
  concurrency: number;
  onConcurrencyChange: (n: number) => void;

  // Collaborative notes
  hasCollabNotes: boolean;
  sessionNotes: NoteData[];
  notesConnected: boolean;
  onUpdateNote: (noteId: string, update: { title?: string; content?: string; metadata?: Record<string, unknown> }) => Promise<NoteData | null>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onExecuteNoteTask: (noteId: string) => Promise<CrafterAgent | null>;
  onExecuteQuickAccessNoteTask: (noteId: string) => Promise<CrafterAgent | null>;
  onExecuteAllNoteTasks: (concurrency: number) => Promise<void>;
  onExecuteSelectedNoteTasks: (noteIds: string[], concurrency: number) => Promise<void>;
  crafterAgents: CrafterAgent[];
  onSelectNoteTask: (noteId: string) => void;
}

/* ─── Spec Viewer (inline in sidebar) ──────────────────────────────── */
function SpecViewer({ specNote, onDeleteNote }: {
  specNote?: NoteData;
  onDeleteNote?: (noteId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      {/* Spec header */}
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
            {specNote?.title || t.common.spec}
          </span>
        </div>
        {specNote && onDeleteNote && (
          <button
            onClick={() => onDeleteNote(specNote.id)}
            title={t.common.deleteSpec}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <X className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        )}
      </div>
      {/* Spec content — full scrollable area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {specNote ? (
          <MarkdownViewer
            content={specNote.content || t.common.noSpecContentYet}
            className="text-[12px] text-slate-700 dark:text-slate-300"
          />
        ) : (
          <div className="h-full rounded-xl border border-dashed border-blue-200 bg-blue-50/60 px-3 py-4 text-[12px] text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
            {t.common.noSpecNoteYet}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskSnapshotSummary({
  taskCount,
  runningCount,
  hasSpec,
  specPreviewLines,
  onOpenTasks,
  onOpenSpec,
}: {
  taskCount: number;
  runningCount: number;
  hasSpec: boolean;
  specPreviewLines: string[];
  onOpenTasks: () => void;
  onOpenSpec?: () => void;
}) {
  const { t } = useTranslation();
  if (taskCount === 0 && !hasSpec) return null;

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-[#171a23] shrink-0" data-testid="session-quick-access">
      <div className="px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            Quick Access
          </p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
            {taskCount > 0
              ? `${taskCount} task${taskCount === 1 ? "" : "s"}${runningCount > 0 ? `, ${runningCount} running` : ""}`
              : t.common.specAvailable}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasSpec && onOpenSpec && (
            <button
              type="button"
              onClick={onOpenSpec}
              className="px-2 py-1 rounded-md text-[10px] font-medium text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              Spec
            </button>
          )}
          {taskCount > 0 && (
            <button
              type="button"
              onClick={onOpenTasks}
              className="px-2 py-1 rounded-md text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              Open Tasks
            </button>
          )}
        </div>
      </div>
      {specPreviewLines.length > 0 && hasSpec && onOpenSpec && (
        <button
          type="button"
          onClick={onOpenSpec}
          data-testid="session-spec-preview"
          className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] flex-col gap-1 rounded-lg border border-blue-100 bg-white/80 px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-white dark:border-blue-900/40 dark:bg-[#121722] dark:hover:border-blue-800"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-500 dark:text-blue-300">
            Spec Preview
          </span>
          {specPreviewLines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              className="text-[11px] leading-5 text-slate-600 dark:text-slate-300 line-clamp-1"
            >
              {line}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}

/* ─── Sessions + Tasks split pane (resizable, 50/50 default) ───────── */
function SessionsSplitPane({
  sessionId,
  focusedSessionId,
  workspaceId,
  onSelectSession,
  refreshKey,
  hasCollabNotes,
  sessionNotes,
  routaTasks,
  specNote,
  onSwitchToTasks,
  onSwitchToSpec,
  onExecuteQuickAccessNoteTask,
  onExecuteTask,
  hasSpec,
}: {
  sessionId: string;
  focusedSessionId?: string | null;
  workspaceId: string;
  onSelectSession: (id: string) => void;
  refreshKey: number;
  hasCollabNotes: boolean;
  sessionNotes: NoteData[];
  routaTasks: ParsedTask[];
  specNote?: NoteData;
  onSwitchToTasks: () => void;
  onSwitchToSpec?: () => void;
  onExecuteQuickAccessNoteTask: (noteId: string) => Promise<CrafterAgent | null>;
  onExecuteTask: (taskId: string) => Promise<CrafterAgent | null>;
  hasSpec: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.46);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const hasTasks = hasCollabNotes
    ? sessionNotes.some((n) => n.metadata.type === "task")
    : routaTasks.length > 0;
  const taskCount = hasCollabNotes
    ? sessionNotes.filter((n) => n.metadata.type === "task").length
    : routaTasks.length;
  const runningCount = hasCollabNotes
    ? sessionNotes.filter((n) => n.metadata.taskStatus === "IN_PROGRESS").length
    : routaTasks.filter((task) => task.status === "running").length;
  const specPreviewLines = useMemo(() => {
    if (!specNote?.content) return [];
    return specNote.content
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-#*>\s`]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }, [specNote]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SESSIONS_QUICK_ACCESS_RATIO_KEY);
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
    if (Number.isFinite(parsed)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSplitRatio(Math.max(0.28, Math.min(0.78, parsed)));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSIONS_QUICK_ACCESS_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    if (!isDraggingSplit) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relativeY = event.clientY - rect.top;
      const nextRatio = relativeY / rect.height;
      setSplitRatio(Math.max(0.28, Math.min(0.78, nextRatio)));
    };

    const handleMouseUp = () => {
      setIsDraggingSplit(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDraggingSplit]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className="min-h-0 overflow-y-auto"
        style={(hasTasks || hasSpec) ? { flexBasis: `${splitRatio * 100}%` } : undefined}
      >
        <SessionContextPanel
          sessionId={sessionId}
          workspaceId={workspaceId}
          onSelectSession={onSelectSession}
          focusedSessionId={focusedSessionId}
          refreshTrigger={refreshKey}
        />
      </div>
      {(hasTasks || hasSpec) && (
        <>
          <div
            className="hidden md:flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-slate-100 bg-slate-50/90 transition-colors hover:bg-blue-50 dark:border-slate-800 dark:bg-[#13151d] dark:hover:bg-blue-950/20"
            onMouseDown={() => setIsDraggingSplit(true)}
            data-testid="session-sidebar-split-handle"
          >
            <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
          </div>
          <div
            className="min-h-44 shrink-0 overflow-hidden"
            style={{ flexBasis: `${(1 - splitRatio) * 100}%` }}
          >
          <TaskSnapshotSummary
            taskCount={taskCount}
            runningCount={runningCount}
            hasSpec={hasSpec}
            specPreviewLines={specPreviewLines}
            onOpenTasks={onSwitchToTasks}
            onOpenSpec={onSwitchToSpec}
          />
          {hasTasks && (
            <div className="flex-1 min-h-0 overflow-y-auto border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#13151d]">
              <MiniTaskList
                hasCollabNotes={hasCollabNotes}
                sessionNotes={sessionNotes}
                routaTasks={routaTasks}
                onExecuteNoteTask={onExecuteQuickAccessNoteTask}
                onExecuteTask={onExecuteTask}
              />
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Mini Task List (summary list in Sessions tab) ─────────────────── */
const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-slate-300 dark:bg-slate-600",
  confirmed:   "bg-blue-400 dark:bg-blue-500",
  running:     "bg-amber-400 animate-pulse",
  completed:   "bg-emerald-500",
  error:       "bg-red-500",
  IN_PROGRESS: "bg-amber-400 animate-pulse",
  COMPLETED:   "bg-emerald-500",
  FAILED:      "bg-red-500",
  PENDING:     "bg-slate-300 dark:bg-slate-600",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", confirmed: "Confirmed", running: "Running",
  completed: "Done", error: "Error",
  PENDING: "Pending", IN_PROGRESS: "Running", COMPLETED: "Done", FAILED: "Failed",
};

function MiniTaskList({
  hasCollabNotes,
  sessionNotes,
  routaTasks,
  onExecuteNoteTask,
  onExecuteTask,
}: {
  hasCollabNotes: boolean;
  sessionNotes: NoteData[];
  routaTasks: ParsedTask[];
  onExecuteNoteTask: (noteId: string) => Promise<CrafterAgent | null>;
  onExecuteTask: (taskId: string) => Promise<CrafterAgent | null>;
}) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const items = useMemo(() => {
    if (hasCollabNotes) {
      return sessionNotes
        .filter((n) => n.metadata.type === "task")
        .map((n) => ({
          id: n.id,
          title: n.title,
          status: (n.metadata.taskStatus as string) || "PENDING",
          actionLabel: ["COMPLETED", "IN_PROGRESS"].includes((n.metadata.taskStatus as string) || "PENDING")
            ? "Open"
            : "Run",
          run: () => onExecuteNoteTask(n.id),
        }));
    }
    return routaTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      actionLabel: ["completed", "running"].includes(t.status) ? "Open" : "Run",
      run: () => onExecuteTask(t.id),
    }));
  }, [hasCollabNotes, onExecuteNoteTask, onExecuteTask, routaTasks, sessionNotes]);

  if (items.length === 0) return null;

  const runningCount = items.filter((item) => ["running", "IN_PROGRESS"].includes(item.status)).length;
  const completedCount = items.filter((item) => ["completed", "COMPLETED"].includes(item.status)).length;

  return (
    <div className="px-3 py-2 space-y-2" data-testid="session-task-snapshot">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Task Snapshot
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            {items.length} total
          </span>
          {runningCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              {runningCount} running
            </span>
          )}
          {completedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
              {completedCount} done
            </span>
          )}
        </div>
        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
          quick run
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            data-testid="session-task-snapshot-item"
            className="w-full flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#171a23] px-2.5 py-2"
          >
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[item.status] ?? "bg-slate-300"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                  {item.title}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
            </div>
            <button
              type="button"
              data-testid="session-task-quick-run"
              disabled={executingId === item.id}
              onClick={async () => {
                setExecutingId(item.id);
                try {
                  await item.run();
                } finally {
                  setExecutingId((current) => current === item.id ? null : current);
                }
              }}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
              title={`${item.actionLabel ?? "Run"} ${item.title}`}
            >
              <Play className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              {executingId === item.id ? "Running" : (item.actionLabel ?? "Run")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Tab Button ───────────────────────────────────────────────────── */
function TabButton({ active, label, badge, badgePulse, icon, onClick }: {
  active: boolean;
  label: string;
  badge?: number;
  badgePulse?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
          : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full leading-none ${
          badgePulse
            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 animate-pulse"
            : active
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
              : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
        }`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/* ─── Main LeftSidebar Component ───────────────────────────────────── */
export function LeftSidebar({
  isCollapsed,
  onToggleCollapse,
  onCloseMobileSidebar,
  width,
  showMobileSidebar,
  onResizeStart,
  sessionId,
  focusedSessionId,
  workspaceId,
  refreshKey,
  onSelectSession,
  onCreateSession,
  codebases,
  repoSelection,
  hasProviders,
  hasSelectedProvider,
  routaTasks,
  onConfirmAllTasks,
  onExecuteAllTasks,
  onConfirmTask,
  onEditTask,
  onExecuteTask,
  concurrency,
  onConcurrencyChange,
  hasCollabNotes,
  sessionNotes,
  notesConnected,
  onUpdateNote,
  onDeleteNote,
  onExecuteNoteTask,
  onExecuteAllNoteTasks,
  onExecuteQuickAccessNoteTask,
  onExecuteSelectedNoteTasks,
  crafterAgents,
  onSelectNoteTask,
}: LeftSidebarProps) {
  const { t } = useTranslation();
  const canCreateSession = hasProviders && hasSelectedProvider;
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const isDesktopCollapsed = isCollapsed && !showMobileSidebar;

  const taskCount = hasCollabNotes
    ? sessionNotes.filter((n) => n.metadata.type === "task").length
    : routaTasks.length;

  const specNote = useMemo(
    () => sessionNotes.find((n) => n.metadata.type === "spec" && n.sessionId === sessionId)
      ?? sessionNotes.find((n) => n.metadata.type === "spec"),
    [sessionId, sessionNotes]
  );

  const hasRunningTasks = hasCollabNotes
    ? sessionNotes.some((n) => n.metadata.taskStatus === "IN_PROGRESS")
    : routaTasks.some((t) => t.status === "running");

  return (
    <>
      <aside
        className={`shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#13151d] flex flex-col relative transition-[width] duration-200
          ${showMobileSidebar ? "fixed inset-y-13 left-0 z-40 shadow-2xl overflow-hidden rounded-r-2xl" : "hidden md:flex overflow-hidden"}
        `}
        style={{ width: isDesktopCollapsed ? "44px" : showMobileSidebar ? "min(360px, calc(100vw - 16px))" : `${width}px` }}
      >
        {isDesktopCollapsed ? (
          /* ─── Collapsed: icon strip ──────────────────────────── */
          <div className="flex flex-col items-center py-2 gap-1.5 h-full">
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title={t.common.expandSidebar}
            >
              <ChevronsRight className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>

            {/* New session */}
            <button
              onClick={() => { onCreateSession(""); }}
              disabled={!canCreateSession}
              className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t.common.newSession}
            >
              <Plus className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>

            {/* Sessions */}
            <button
              onClick={() => { onToggleCollapse(); setActiveTab("sessions"); }}
              className={`p-1.5 rounded-md transition-colors ${activeTab === "sessions" ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              title={t.sessions.title}
            >
              <MessageSquareMore className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>

            {/* Spec */}
            <button
              onClick={() => { onToggleCollapse(); setActiveTab("spec"); }}
              className={`p-1.5 rounded-md transition-colors ${activeTab === "spec" ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              title={t.common.spec}
            >
              <FileText className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>

            {/* Tasks */}
            <button
              onClick={() => { onToggleCollapse(); setActiveTab("tasks"); }}
              className={`relative p-1.5 rounded-md transition-colors ${activeTab === "tasks" ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              title={t.common.tasks}
            >
              <ClipboardCheck className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              {taskCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full text-white text-[8px] font-bold ${hasRunningTasks ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`}>
                  {taskCount > 9 ? "9+" : taskCount}
                </span>
              )}
            </button>

          </div>
        ) : (
          /* ─── Expanded: tabbed sidebar ───────────────────────── */
          <>
            {/* Header: codebase + new session + collapse */}
            <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  onClick={() => {
                    if (showMobileSidebar) {
                      onCloseMobileSidebar?.();
                      return;
                    }
                    onToggleCollapse();
                  }}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                  title={showMobileSidebar ? t.nav.closeSidebar : t.common.collapseSidebar}
                >
                  <ChevronsLeft className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>
                {codebases.length > 0 && repoSelection && (
                  <>
                    <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {repoSelection.name ?? repoSelection.path.split("/").pop()}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => {
                    onCreateSession("");
                    onCloseMobileSidebar?.();
                  }}
                  disabled={!canCreateSession}
                  title={t.common.newSession}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  <span className="hidden sm:inline">{t.common.new}</span>
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex items-end px-1 pt-1 border-b border-slate-200 dark:border-slate-700 shrink-0 gap-0.5 overflow-x-auto">
              <TabButton
                active={activeTab === "sessions"}
                label={t.sessions.title}
                onClick={() => setActiveTab("sessions")}
                icon={
                  <MessageSquareMore className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                }
              />
              <TabButton
                active={activeTab === "spec"}
                label={t.common.spec}
                onClick={() => setActiveTab("spec")}
                icon={
                  <FileText className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                }
              />
              <TabButton
                active={activeTab === "tasks"}
                label={t.common.tasks}
                badge={taskCount}
                badgePulse={hasRunningTasks}
                onClick={() => setActiveTab("tasks")}
                icon={
                  <ClipboardCheck className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                }
              />
            </div>

            {/* Tab content — full remaining height */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {activeTab === "sessions" && (
                <SessionsSplitPane
                  sessionId={sessionId}
                  focusedSessionId={focusedSessionId}
                  workspaceId={workspaceId}
                  onSelectSession={(id: string) => {
                    onSelectSession(id);
                    onCloseMobileSidebar?.();
                  }}
                  refreshKey={refreshKey}
                  hasCollabNotes={hasCollabNotes}
                  sessionNotes={sessionNotes}
                  routaTasks={routaTasks}
                  specNote={specNote}
                  onSwitchToTasks={() => setActiveTab("tasks")}
                  onSwitchToSpec={() => setActiveTab("spec")}
                  onExecuteQuickAccessNoteTask={onExecuteQuickAccessNoteTask}
                  onExecuteTask={onExecuteTask}
                  hasSpec={Boolean(specNote)}
                />
              )}

              {activeTab === "spec" && (
                <SpecViewer specNote={specNote} onDeleteNote={onDeleteNote} />
              )}

              {activeTab === "tasks" && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  {hasCollabNotes ? (
                    <CollaborativeTaskEditor
                      notes={sessionNotes}
                      connected={notesConnected}
                      onUpdateNote={onUpdateNote}
                      onDeleteNote={onDeleteNote}
                      workspaceId={workspaceId}
                      crafterAgents={crafterAgents}
                      onSelectTaskNote={onSelectNoteTask}
                      onExecuteTask={onExecuteNoteTask}
                      onExecuteSelected={onExecuteSelectedNoteTasks}
                      onExecuteAll={onExecuteAllNoteTasks}
                      concurrency={concurrency}
                      onConcurrencyChange={onConcurrencyChange}
                    />
                  ) : (
                    <TaskPanel
                      tasks={routaTasks}
                      onConfirmAll={onConfirmAllTasks}
                      onExecuteAll={onExecuteAllTasks}
                      onConfirmTask={onConfirmTask}
                      onEditTask={onEditTask}
                      onExecuteTask={onExecuteTask}
                      concurrency={concurrency}
                      onConcurrencyChange={onConcurrencyChange}
                    />
                  )}
                </div>
              )}
            </div>

          </>
        )}

        {/* Left sidebar resize handle */}
        <div className="left-resize-handle hidden md:block" onMouseDown={onResizeStart}>
          <div className="resize-indicator" />
        </div>
      </aside>
    </>
  );
}
