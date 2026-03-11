"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpState } from "@/client/hooks/use-acp";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { KanbanCreateModal, EMPTY_DRAFT, type DraftIssue } from "../kanban-create-modal";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

interface KanbanTabProps {
  workspaceId: string;
  boards: KanbanBoardInfo[];
  tasks: TaskInfo[];
  sessions: SessionInfo[];
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  codebases: CodebaseData[];
  onRefresh: () => void;
  /** ACP state for agent input */
  acp?: UseAcpState;
  /** Handler for agent prompt - creates session and sends prompt */
  onAgentPrompt?: (prompt: string) => Promise<string | null>;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

export function KanbanTab({ workspaceId, boards, tasks, sessions, providers, specialists, codebases, onRefresh, acp, onAgentPrompt }: KanbanTabProps) {
  const defaultBoardId = useMemo(
    () => boards.find((board) => board.isDefault)?.id ?? boards[0]?.id ?? null,
    [boards],
  );
  const allCodebaseIds = useMemo(
    () => codebases.map((codebase) => codebase.id),
    [codebases],
  );
  const defaultCodebase = useMemo(
    () => codebases.find((codebase) => codebase.isDefault) ?? codebases[0] ?? null,
    [codebases],
  );
  const githubAvailable = Boolean(defaultCodebase?.sourceUrl?.includes("github.com"));

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(defaultBoardId);
  const [localTasks, setLocalTasks] = useState<TaskInfo[]>(tasks);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draft, setDraft] = useState<DraftIssue>({
    ...EMPTY_DRAFT,
    createGitHubIssue: githubAvailable,
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // For card detail view;
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Agent input state
  const [agentInput, setAgentInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);

  // Codebase detail popup state
  const [selectedCodebase, setSelectedCodebase] = useState<CodebaseData | null>(null);
  const [codebaseWorktrees, setCodebaseWorktrees] = useState<WorktreeInfo[]>([]);

  // Worktree cache: worktreeId -> WorktreeInfo
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});
  const [detailUpdateError, setDetailUpdateError] = useState<string | null>(null);

  // Inline edit state for task detail panel
  const [detailEditTitle, setDetailEditTitle] = useState("");
  const [detailEditObjective, setDetailEditObjective] = useState("");
  const [detailEditPriority, setDetailEditPriority] = useState("medium");

  // Settings state - column automation rules (initialized from board columns)
  const [columnAutomation, setColumnAutomation] = useState<Record<string, {
    enabled: boolean;
    providerId?: string;
    role?: string;
    specialistId?: string;
    specialistName?: string;
    transitionType?: "entry" | "exit" | "both";
    requiredArtifacts?: ("screenshot" | "test_results" | "code_diff")[];
    autoAdvanceOnSuccess?: boolean;
  }>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Delete confirmation modal state
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Handle agent input submission
  const handleAgentSubmit = useCallback(async () => {
    if (!agentInput.trim() || !onAgentPrompt || agentLoading) return;

    setAgentLoading(true);
    try {
      // Build a system prompt that instructs the Kanban Agent to decompose tasks
      const systemPrompt = `You are the Kanban Agent — an orchestrator that transforms natural language input into structured Kanban tasks.

Your primary tool is decompose_tasks which creates multiple cards in bulk. You can also use individual card tools.

Available Kanban tools:
- decompose_tasks: Create multiple cards from a task breakdown (preferred for multi-task input)
- create_card: Create a single card/task
- move_card: Move a card to a different column
- update_card: Update card details
- delete_card: Delete a card
- search_cards: Search for cards
- list_cards_by_column: List cards in a specific column

Current workspace: ${workspaceId}
Default board ID: ${defaultBoardId ?? "default"}

Instructions:
1. Parse the user's input to identify discrete, actionable tasks
2. Each task should be self-contained and completable independently
3. Use decompose_tasks to create all tasks at once on the backlog
4. Assign appropriate priorities and labels
5. Report what was created

User request: ${agentInput}`;

      const sessionId = await onAgentPrompt(systemPrompt);
      if (sessionId) {
        setAgentSessionId(sessionId);
        // Refresh to show any new cards created
        setTimeout(() => {
          onRefresh();
        }, 2000);
      }
      setAgentInput("");
    } finally {
      setAgentLoading(false);
    }
  }, [agentInput, onAgentPrompt, agentLoading, workspaceId, defaultBoardId, onRefresh]);

  useEffect(() => {
    setSelectedBoardId(defaultBoardId);
  }, [defaultBoardId]);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const board = useMemo(
    () => boards.find((item) => item.id === selectedBoardId) ?? null,
    [boards, selectedBoardId],
  );

  // Initialize visible columns when board changes
  useEffect(() => {
    if (board) {
      // Use persisted visibility if available, otherwise show all columns
      const columnsWithVisibility = board.columns.filter((col) => 
        col.visible !== undefined ? col.visible : true
      );
      setVisibleColumns(columnsWithVisibility.map((col) => col.id));
    }
  }, [board]);

  // Initialize column automation from board when it changes
  useEffect(() => {
    if (board) {
      const automation: Record<string, { enabled: boolean; providerId?: string; role?: string; specialistId?: string; specialistName?: string }> = {};
      for (const col of board.columns) {
        if (col.automation) {
          automation[col.id] = { ...col.automation };
        }
      }
      setColumnAutomation(automation);
    }
  }, [board]);

  const boardTasks = useMemo(() => {
    const effectiveBoardId = selectedBoardId ?? defaultBoardId;
    return localTasks
      .filter((task) => (task.boardId ?? defaultBoardId) === effectiveBoardId)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  }, [defaultBoardId, localTasks, selectedBoardId]);

  const availableProviders = useMemo(() => {
    const uniqueProviders = new Map<string, AcpProviderInfo>();
    for (const provider of providers) {
      if (provider.status !== "available") continue;
      if (!uniqueProviders.has(provider.id)) {
        uniqueProviders.set(provider.id, provider);
      }
    }
    return Array.from(uniqueProviders.values());
  }, [providers]);

  const sessionMap = useMemo(
    () => new Map(sessions.map((session) => [session.sessionId, session])),
    [sessions],
  );

  const openTaskDetail = useCallback((task: TaskInfo) => {
    setActiveTaskId(task.id);
    setActiveSessionId(task.triggerSessionId ?? null);
    setIframeLoaded(false); // Reset iframe loaded state
  }, []);

  const openSession = useCallback((sessionId: string | null) => {
    setActiveTaskId(null);
    setActiveSessionId(sessionId);
    setIframeLoaded(false);
  }, []);

  const closeTaskDetail = useCallback(() => {
    setActiveTaskId(null);
    setActiveSessionId(null);
    setIframeLoaded(false);
  }, []);

  const stopCardInteraction = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  }, []);

  // Reset detail edit state when the active task changes
  useEffect(() => {
    if (activeTaskId) {
      const activeTask = localTasks.find((t) => t.id === activeTaskId);
      if (activeTask) {
        setDetailEditTitle(activeTask.title);
        setDetailEditObjective(activeTask.objective ?? "");
        setDetailEditPriority(activeTask.priority ?? "medium");
      }
    }
  }, [activeTaskId, localTasks]);

  // Close modal on Escape key
  useEffect(() => {
    if (!activeTaskId && !activeSessionId && !showSettings && !selectedCodebase) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeTaskId || activeSessionId) {
          closeTaskDetail();
        } else if (showSettings) {
          setShowSettings(false);
        } else if (selectedCodebase) {
          setSelectedCodebase(null);
          setCodebaseWorktrees([]);
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeTaskId, activeSessionId, showSettings, selectedCodebase, closeTaskDetail]);

  // Fetch worktrees for tasks that have worktreeId
  useEffect(() => {
    const worktreeIds = [...new Set(localTasks.map((t) => t.worktreeId).filter((id): id is string => Boolean(id)))];
    const missing = worktreeIds.filter((id) => !worktreeCache[id]);
    if (missing.length === 0) return;

    (async () => {
      const results: Record<string, WorktreeInfo> = {};
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await fetch(`/api/worktrees/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (res.ok) {
              const data = await res.json();
              if (data.worktree) results[id] = data.worktree as WorktreeInfo;
            }
          } catch { /* ignore */ }
        })
      );
      if (Object.keys(results).length > 0) {
        setWorktreeCache((prev) => ({ ...prev, ...results }));
      }
    })();
  }, [localTasks, worktreeCache]);

  async function fetchCodebaseWorktrees(codebase: CodebaseData) {
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(codebase.id)}/worktrees`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setCodebaseWorktrees(Array.isArray(data.worktrees) ? data.worktrees as WorktreeInfo[] : []);
      }
    } catch { /* ignore */ }
  }

  async function patchTask(taskId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to update task");
    }
    const updated = data.task as TaskInfo;
    setLocalTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
    return updated;
  }

  async function createIssue() {
    const effectiveCodebaseIds = draft.codebaseIds.length > 0 ? draft.codebaseIds : allCodebaseIds;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId,
        title: draft.title,
        objective: draft.objectiveHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        priority: draft.priority,
        labels: draft.labels.split(",").map((label) => label.trim()).filter(Boolean),
        createGitHubIssue: draft.createGitHubIssue,
        repoPath: effectiveCodebaseIds.length > 0
          ? codebases.find((codebase) => codebase.id === effectiveCodebaseIds[0])?.repoPath
          : defaultCodebase?.repoPath,
        codebaseIds: effectiveCodebaseIds,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to create issue");
    }
    setLocalTasks((current) => [...current, data.task as TaskInfo]);
    setDraft({ ...EMPTY_DRAFT, objectiveHtml: "", createGitHubIssue: githubAvailable });
    setShowCreateModal(false);
    onRefresh();
  }

  async function retryTaskTrigger(taskId: string) {
    const updated = await patchTask(taskId, { retryTrigger: true });
    if (updated.triggerSessionId) {
      openSession(updated.triggerSessionId);
    }
    onRefresh();
  }

  function confirmDeleteTask(task: TaskInfo) {
    setDeleteConfirmTask(task);
  }

  async function executeDeleteTask() {
    if (!deleteConfirmTask) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(deleteConfirmTask.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete task");
      }
      setLocalTasks((current) => current.filter((task) => task.id !== deleteConfirmTask.id));
      setDeleteConfirmTask(null);
      closeTaskDetail();
      onRefresh();
    } catch (error) {
      console.error("Failed to delete task:", error);
      // Show error in the modal instead of alert
      setIsDeleting(false);
    }
  }

  function cancelDeleteTask() {
    setDeleteConfirmTask(null);
    setIsDeleting(false);
  }

  async function moveTask(taskId: string, targetColumnId: string) {
    const movingTask = localTasks.find((task) => task.id === taskId);
    if (!movingTask) return;

    let shouldCleanupWorktree = false;
    if (targetColumnId === "done" && movingTask.worktreeId) {
      shouldCleanupWorktree = window.confirm(
        "This issue has an attached worktree. Clean it up now?"
      );
    }

    const nextPosition = boardTasks.filter((task) => task.columnId === targetColumnId).length;
    const optimistic = localTasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            columnId: targetColumnId,
            position: nextPosition,
            status: targetColumnId === "dev" ? "IN_PROGRESS"
              : targetColumnId === "review" ? "REVIEW_REQUIRED"
              : targetColumnId === "blocked" ? "BLOCKED"
              : targetColumnId === "done" ? "COMPLETED"
              : "PENDING",
          }
        : task,
    );
    setLocalTasks(optimistic);

    try {
      let updated = await patchTask(taskId, { columnId: targetColumnId, position: nextPosition });
      if (shouldCleanupWorktree && movingTask.worktreeId) {
        const response = await fetch(`/api/worktrees/${encodeURIComponent(movingTask.worktreeId)}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to remove worktree");
        }
        updated = await patchTask(taskId, { worktreeId: null });
        setWorktreeCache((current) => {
          const next = { ...current };
          delete next[movingTask.worktreeId!];
          return next;
        });
      }
      if (updated.triggerSessionId && updated.triggerSessionId !== movingTask.triggerSessionId) {
        openSession(updated.triggerSessionId);
      }
      onRefresh();
    } catch (error) {
      console.error(error);
      setLocalTasks(tasks);
    }
  }

  async function _createBoard() {
    const name = window.prompt("Board name");
    if (!name?.trim()) return;
    const response = await fetch("/api/kanban/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, name: name.trim() }),
    });
    if (response.ok) {
      onRefresh();
    }
  }

  if (!board) {
    return (
      <div className="rounded-2xl border border-gray-200/60 dark:border-[#1c1f2e] bg-white dark:bg-[#12141c] p-6 text-sm text-gray-500 dark:text-gray-400">
        No board available yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="shrink-0 rounded-2xl border border-gray-200/70 bg-white px-4 py-3 dark:border-[#1c1f2e] dark:bg-[#12141c]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex min-w-0 items-start gap-2 xl:max-w-xl">
              <span className="pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Repos</span>
              {codebases.length === 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-500">
                  <span>No repositories linked.</span>
                  <a
                    href={`/workspace/${workspaceId}?tab=settings`}
                    className="text-amber-600 hover:underline dark:text-amber-400"
                  >
                    Add one in Settings →
                  </a>
                </div>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {codebases.map((cb) => (
                    <button
                      key={cb.id}
                      onClick={() => {
                        setSelectedCodebase(cb);
                        void fetchCodebaseWorktrees(cb);
                      }}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-amber-900/10"
                      data-testid="codebase-badge"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cb.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                      <span className="truncate font-medium">{cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}</span>
                      {cb.branch && <span className="shrink-0 text-gray-400 dark:text-gray-500">@{cb.branch}</span>}
                      <span className={`shrink-0 rounded px-1 text-[10px] ${cb.isDefault ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                        {cb.isDefault ? "default" : cb.sourceType ?? "local"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>



            {onAgentPrompt && (
              <div className="flex min-w-[20rem] flex-1 items-center gap-2 xl:max-w-none">
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleAgentSubmit();
                      }
                    }}
                    placeholder={acp?.connected ? "Ask agent to create issues..." : "Connecting..."}
                    disabled={agentLoading || !acp?.connected}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-16 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-200 dark:placeholder-gray-500"
                  />
                  <button
                    onClick={() => void handleAgentSubmit()}
                    disabled={!agentInput.trim() || agentLoading || !acp?.connected}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {agentLoading ? "..." : "Send"}
                  </button>
                </div>
                {agentSessionId && (
                  <button
                    onClick={() => openSession(agentSessionId)}
                    className="shrink-0 text-xs text-amber-600 hover:underline dark:text-amber-400"
                    title="View last agent response"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {boards.length > 1 && (
              <select
                value={selectedBoardId ?? ""}
                onChange={(event) => setSelectedBoardId(event.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-200"
              >
                {boards.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
              title="Board settings"
            >
              Settings
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Manual
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-2">
        <div className="flex min-h-full items-start gap-3" style={{ minWidth: `${visibleColumns.length * 18}rem` }}>
          {board.columns
            .slice()
            .sort((left, right) => left.position - right.position)
            .filter((column) => visibleColumns.includes(column.id))
            .map((column) => {
              const columnTasks = boardTasks.filter((task) => (task.columnId ?? "backlog") === column.id);
              return (
                <div
                  key={column.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={async () => {
                    if (!dragTaskId) return;
                    await moveTask(dragTaskId, column.id);
                    setDragTaskId(null);
                  }}
                  className="flex h-full min-h-26.25 w-[18rem] shrink-0 flex-col rounded-2xl border border-gray-200/70 bg-white p-3 dark:border-[#1c1f2e] dark:bg-[#12141c]"
                  data-testid="kanban-column"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{column.name}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">{columnTasks.length} cards</div>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {columnTasks.map((task) => {
                      const linkedSession = task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : undefined;
                      const sessionStatus = linkedSession?.acpStatus;
                      const sessionError = linkedSession?.acpError;
                      const canRetry = Boolean(task.assignedProvider) && (
                        sessionStatus === "error" || (!task.triggerSessionId && task.columnId === "dev")
                      );
                      const canRun = Boolean(task.assignedProvider) && !task.triggerSessionId && task.columnId !== "done";
                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={() => setDragTaskId(task.id)}
                          onClick={() => openTaskDetail(task)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openTaskDetail(task);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open ${task.title}`}
                          className="group relative cursor-grab rounded-xl border border-gray-200/70 bg-gray-50/80 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400/50 active:cursor-grabbing dark:border-[#262938] dark:bg-[#0d1018]"
                          data-testid="kanban-card"
                        >
                          {/* Delete button - shown on hover */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDeleteTask(task);
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900/20"
                            title="Delete task"
                            data-testid="kanban-card-delete"
                          >
                            <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>

                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{task.title}</div>
                              {task.githubNumber ? (
                                <a
                                  href={task.githubUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={stopCardInteraction}
                                  className="mt-1 inline-flex text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                                >
                                  #{task.githubNumber}
                                </a>
                              ) : (
                                <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Local issue</div>
                              )}
                            </div>
                            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600 dark:bg-[#1c1f2e] dark:text-gray-300">
                              {task.priority ?? "medium"}
                            </span>
                          </div>

                          <p className="mt-2 line-clamp-4 text-[12px] leading-5 text-gray-600 dark:text-gray-400">{task.objective}</p>

                          {task.labels && task.labels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {task.labels.map((label) => (
                                <span key={label} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Repository badge (Requirement 2 + 4) */}
                          {((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0) && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).map((cbId) => {
                                const cb = codebases.find((c) => c.id === cbId);
                                return cb ? (
                                  <span
                                    key={cbId}
                                    className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/20 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-300"
                                    data-testid="repo-badge"
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                    {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
                                  </span>
                                ) : (
                                  <span key={cbId} className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-600 dark:bg-red-900/20 dark:text-red-400" title="Repository no longer available">
                                    ⚠ repo missing
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Worktree status badge (Requirement 4) */}
                          {task.worktreeId && (() => {
                            const wt = worktreeCache[task.worktreeId];
                            if (!wt) return <div className="mt-2 text-[10px] text-gray-400">Loading worktree...</div>;
                            const wtBadgeColor = wt.status === "active"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                              : wt.status === "creating"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300";
                            return (
                              <button
                                onClick={() => openTaskDetail(task)}
                                onClickCapture={stopCardInteraction}
                                className="mt-2 flex items-center gap-1.5 group"
                                title="Click to view worktree details"
                                data-testid="worktree-badge"
                              >
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${wtBadgeColor}`}>
                                  {wt.status}
                                </span>
                                <span className="max-w-30 truncate text-[10px] text-gray-500 dark:text-gray-400">{wt.branch}</span>
                              </button>
                            );
                          })()}

                          {/* Assignment Section */}
                          <div className="mt-3 space-y-2 border-t border-gray-200/50 pt-3 dark:border-[#262938]">
                            {/* Row 1: Provider */}
                            <div className="flex items-center gap-2">
                              <span className="w-16 shrink-0 text-[10px] font-medium text-gray-500 dark:text-gray-400">Provider</span>
                              <select
                                value={task.assignedProvider ?? ""}
                                onClick={stopCardInteraction}
                                onChange={async (event) => {
                                  const providerId = event.target.value;
                                  if (providerId) {
                                    await patchTask(task.id, {
                                      assignedProvider: providerId,
                                      assignedRole: task.assignedRole ?? "DEVELOPER",
                                    });
                                  } else {
                                    await patchTask(task.id, {
                                      assignedProvider: undefined,
                                      assignedRole: undefined,
                                      assignedSpecialistId: undefined,
                                      assignedSpecialistName: undefined,
                                    });
                                  }
                                  onRefresh();
                                }}
                                className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-[#12141c]"
                              >
                                <option value="">Select...</option>
                                {availableProviders.map((provider) => (
                                  <option key={provider.id} value={provider.id}>
                                    {provider.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Row 2: Role (only show if provider is assigned) */}
                            {task.assignedProvider && (
                              <div className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-[10px] font-medium text-gray-500 dark:text-gray-400">Role</span>
                                <select
                                  value={task.assignedRole ?? "DEVELOPER"}
                                  onClick={stopCardInteraction}
                                  onChange={async (event) => {
                                    await patchTask(task.id, { assignedRole: event.target.value });
                                    onRefresh();
                                  }}
                                  className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-[#12141c]"
                                >
                                  {ROLE_OPTIONS.map((role) => (
                                    <option key={role} value={role}>{role}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Row 3: Specialist (only show if provider is assigned) */}
                            {task.assignedProvider && (
                              <div className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-[10px] font-medium text-gray-500 dark:text-gray-400">Specialist</span>
                                <select
                                  value={task.assignedSpecialistId ?? ""}
                                  onClick={stopCardInteraction}
                                  onChange={async (event) => {
                                    const specialist = specialists.find((item) => item.id === event.target.value);
                                    await patchTask(task.id, {
                                      assignedSpecialistId: event.target.value || undefined,
                                      assignedSpecialistName: specialist?.name ?? undefined,
                                      assignedRole: specialist?.role ?? task.assignedRole,
                                    });
                                    onRefresh();
                                  }}
                                  className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-[#12141c]"
                                >
                                  <option value="">None</option>
                                  {specialists.map((specialist) => (
                                    <option key={specialist.id} value={specialist.id}>
                                      {specialist.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-gray-400 dark:text-gray-500">
                                {sessionStatus === "connecting"
                                  ? "Session starting..."
                                  : sessionStatus === "error"
                                    ? (sessionError ?? "Session failed")
                                    : task.lastSyncError
                                      ? task.lastSyncError
                                      : task.githubSyncedAt
                                        ? `Synced ${new Date(task.githubSyncedAt).toLocaleString()}`
                                        : "Not synced"}
                              </div>
                              {sessionStatus && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    sessionStatus === "ready"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                      : sessionStatus === "error"
                                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                  }`}>
                                    {sessionStatus}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {canRun && !canRetry && (
                                <button
                                  onClick={() => void retryTaskTrigger(task.id)}
                                  onClickCapture={stopCardInteraction}
                                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/10 dark:text-emerald-300"
                                >
                                  Run
                                </button>
                              )}
                              {canRetry && (
                                <button
                                  onClick={() => void retryTaskTrigger(task.id)}
                                  onClickCapture={stopCardInteraction}
                                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300"
                                >
                                  Rerun
                                </button>
                              )}
                              <button
                                onClick={() => openTaskDetail(task)}
                                onClickCapture={stopCardInteraction}
                                className="rounded-md bg-blue-100 px-2 py-1 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/20 dark:text-blue-300"
                              >
                                View detail
                              </button>
                              {task.triggerSessionId && (
                                <button
                                  onClick={() => openSession(task.triggerSessionId ?? null)}
                                  onClickCapture={stopCardInteraction}
                                  className="rounded-md bg-violet-100 px-2 py-1 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/20 dark:text-violet-300"
                                >
                                  View session
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {showCreateModal && (
        <KanbanCreateModal
          draft={draft}
          setDraft={setDraft}
          onClose={() => setShowCreateModal(false)}
          onCreate={() => void createIssue()}
          githubAvailable={githubAvailable}
          codebases={codebases}
          allCodebaseIds={allCodebaseIds}
        />
      )}

      {(activeSessionId || activeTaskId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 animate-in fade-in duration-150">
          <div className="relative h-[88vh] w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
            <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4 dark:border-[#191c28]">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {activeTaskId ? "Card Detail" : "ACP Session"}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">
                  {activeTaskId ? `Task: ${activeTaskId}` : activeSessionId}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeSessionId && (
                  <a
                    href={`/workspace/${workspaceId}/sessions/${activeSessionId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                  >
                    Open full page
                  </a>
                )}
                <button
                  onClick={closeTaskDetail}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex h-[calc(88vh-48px)]">
              {/* Left: Card Detail (if activeTaskId exists) */}
              {activeTaskId && (() => {
                const task = localTasks.find((t) => t.id === activeTaskId);
                if (!task) return null;
                return (
                  <div className="w-1/3 border-r border-gray-200 dark:border-[#191c28] overflow-y-auto p-4">
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title</div>
                        <input
                          value={detailEditTitle}
                          onChange={(e) => setDetailEditTitle(e.target.value)}
                          onBlur={async () => {
                            if (detailEditTitle !== task.title) {
                              await patchTask(task.id, { title: detailEditTitle });
                              onRefresh();
                            }
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold text-gray-900 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Objective</div>
                        <textarea
                          value={detailEditObjective}
                          onChange={(e) => setDetailEditObjective(e.target.value)}
                          onBlur={async () => {
                            if (detailEditObjective !== (task.objective ?? "")) {
                              await patchTask(task.id, { objective: detailEditObjective });
                              onRefresh();
                            }
                          }}
                          rows={6}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</div>
                          <select
                            value={detailEditPriority}
                            onChange={async (e) => {
                              setDetailEditPriority(e.target.value);
                              await patchTask(task.id, { priority: e.target.value });
                              onRefresh();
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Column</div>
                          <div className="text-sm text-gray-700 dark:text-gray-300">{task.columnId ?? "backlog"}</div>
                        </div>
                      </div>
                      {task.labels && task.labels.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Labels</div>
                          <div className="flex flex-wrap gap-1">
                            {task.labels.map((label) => (
                              <span key={label} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Provider</div>
                        <select
                          value={task.assignedProvider ?? ""}
                          onChange={async (e) => {
                            if (e.target.value) {
                              await patchTask(task.id, { assignedProvider: e.target.value, assignedRole: task.assignedRole ?? "DEVELOPER" });
                            } else {
                              await patchTask(task.id, { assignedProvider: undefined, assignedRole: undefined, assignedSpecialistId: undefined, assignedSpecialistName: undefined });
                            }
                            onRefresh();
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
                        >
                          <option value="">Unassigned</option>
                          {availableProviders.map((p) => (
                            <option key={`${p.id}-${p.name}`} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {task.assignedProvider && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <select
                              value={task.assignedRole ?? "DEVELOPER"}
                              onChange={async (e) => {
                                await patchTask(task.id, { assignedRole: e.target.value });
                                onRefresh();
                              }}
                              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
                            >
                              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <select
                              value={task.assignedSpecialistId ?? ""}
                              onChange={async (e) => {
                                const sp = specialists.find((s) => s.id === e.target.value);
                                await patchTask(task.id, { assignedSpecialistId: e.target.value || undefined, assignedSpecialistName: sp?.name, assignedRole: sp?.role ?? task.assignedRole });
                                onRefresh();
                              }}
                              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
                            >
                              <option value="">No specialist</option>
                              {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        )}
                        {task.assignedProvider && (
                          <button
                            onClick={async () => {
                              await retryTaskTrigger(task.id);
                            }}
                            className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
                          >
                            {task.triggerSessionId ? "Rerun" : "Run"}
                          </button>
                        )}
                      </div>
                      {task.githubNumber && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">GitHub</div>
                          <a
                            href={task.githubUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            #{task.githubNumber}
                          </a>
                        </div>
                      )}

                      {/* Requirement 2: Associated Codebases in detail panel */}
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Repositories</div>
                        {((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0) ? (
                          <div className="space-y-1">
                            {(task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).map((cbId) => {
                              const cb = codebases.find((c) => c.id === cbId);
                              return cb ? (
                                <div key={cbId} className="flex items-center gap-2 text-sm">
                                  <span className={`w-2 h-2 rounded-full ${cb.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                                  <span className="text-gray-700 dark:text-gray-300">{cb.label ?? cb.repoPath.split("/").pop()}</span>
                                  {cb.branch && <span className="text-gray-400">@{cb.branch}</span>}
                                </div>
                              ) : (
                                <div key={cbId} className="text-sm text-red-500">⚠ Repository no longer available</div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-400 dark:text-gray-500">No repositories linked</div>
                        )}
                        {codebases.length > 0 && (
                          <div className="mt-3">
                            <div className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Edit linked repositories</div>
                            <div className="flex flex-wrap gap-2">
                              {codebases.map((cb) => {
                                const currentCodebaseIds = (task.codebaseIds && task.codebaseIds.length > 0)
                                  ? task.codebaseIds
                                  : allCodebaseIds;
                                const selected = currentCodebaseIds.includes(cb.id);
                                return (
                                  <button
                                    key={cb.id}
                                    type="button"
                                    onClick={async () => {
                                      setDetailUpdateError(null);
                                      try {
                                        const nextCodebaseIds = selected
                                          ? currentCodebaseIds.filter((id) => id !== cb.id)
                                          : [...currentCodebaseIds, cb.id];
                                        await patchTask(task.id, { codebaseIds: nextCodebaseIds });
                                        onRefresh();
                                      } catch (error) {
                                        setDetailUpdateError(
                                          error instanceof Error ? error.message : "Failed to update repositories"
                                        );
                                      }
                                    }}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                                      selected
                                        ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
                                        : "border-gray-200 bg-white text-gray-600 hover:border-violet-300 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400"
                                    }`}
                                    data-testid="detail-repo-toggle"
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${cb.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                                    {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
                                  </button>
                                );
                              })}
                            </div>
                            {detailUpdateError && (
                              <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{detailUpdateError}</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Requirement 3: Worktree info in card detail panel */}
                      {task.worktreeId && (() => {
                        const wt = worktreeCache[task.worktreeId];
                        return (
                          <div data-testid="worktree-detail">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Worktree</div>
                            {wt ? (
                              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    wt.status === "active"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                      : wt.status === "creating"
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                                  }`}>{wt.status}</span>
                                  <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{wt.branch}</span>
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-500 font-mono truncate" title={wt.worktreePath}>
                                  {wt.worktreePath}
                                </div>
                                {wt.errorMessage && (
                                  <div className="text-xs text-red-600 dark:text-red-400">{wt.errorMessage}</div>
                                )}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-400">Loading worktree info...</div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Delete Task Button */}
                      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => confirmDeleteTask(task)}
                          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 hover:border-red-300 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Delete Task
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* Right: Session (if activeSessionId exists) */}
              {activeSessionId ? (
                <div className={`relative ${activeTaskId ? "w-2/3" : "w-full"} h-full`}>
                  {!iframeLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-[#12141c]">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-amber-500 dark:border-gray-700 dark:border-t-amber-400" />
                        <div className="text-sm text-gray-500 dark:text-gray-400">Loading session...</div>
                      </div>
                    </div>
                  )}
                  <iframe
                    title="ACP session"
                    src={`/workspace/${workspaceId}/sessions/${activeSessionId}?embed=true`}
                    className="border-0 w-full h-full"
                    onLoad={() => setIframeLoaded(true)}
                  />
                </div>
              ) : activeTaskId ? (
                <div className="w-2/3 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  No session available for this task
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && board && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#12141c] p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Board Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            {/* Column Visibility */}
            <div className="space-y-3 pb-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Column Visibility</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Select which columns to display on the board.
              </p>
              <div className="flex flex-wrap gap-2">
                {board.columns
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((col) => (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0d1018] px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVisibleColumns((prev) => [...prev, col.id]);
                          } else {
                            const remaining = visibleColumns.filter((id) => id !== col.id);
                            setVisibleColumns(remaining.length > 0 ? remaining : [col.id]);
                          }
                        }}
                        className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-gray-700 dark:text-gray-300">{col.name}</span>
                    </label>
                  ))}
              </div>
            </div>

            {/* Column Configuration */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Column Automation</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Configure automatic agent triggers when cards are moved to specific columns.
              </p>

              {board.columns
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((column) => {
                  const automation = columnAutomation[column.id] ?? { enabled: false };
                  return (
                    <div
                      key={column.id}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {column.name}
                          </span>
                          <span className="text-xs text-gray-400">({column.id})</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={automation.enabled}
                            onChange={(e) => {
                              setColumnAutomation((prev) => ({
                                ...prev,
                                [column.id]: { ...automation, enabled: e.target.checked },
                              }));
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 rounded-full bg-gray-200 peer dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:content-[''] after:transition-all dark:border-gray-600 dark:peer-focus:ring-amber-800"></div>
                        </label>
                      </div>

                      {automation.enabled && (
                        <div className="space-y-2 pl-2 border-l-2 border-amber-400 mt-2">
                          {/* Provider */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Provider</span>
                            <select
                              value={automation.providerId ?? ""}
                              onChange={(e) => {
                                setColumnAutomation((prev) => ({
                                  ...prev,
                                  [column.id]: { ...automation, providerId: e.target.value || undefined },
                                }));
                              }}
                              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
                            >
                              <option value="">Default</option>
                              {availableProviders.map((p) => (
                                <option key={`${p.id}-${p.name}`} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          {/* Role */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Role</span>
                            <select
                              value={automation.role ?? "DEVELOPER"}
                              onChange={(e) => {
                                setColumnAutomation((prev) => ({
                                  ...prev,
                                  [column.id]: { ...automation, role: e.target.value },
                                }));
                              }}
                              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
                            >
                              {ROLE_OPTIONS.map((role) => (
                                <option key={role} value={role}>{role}</option>
                              ))}
                            </select>
                          </div>
                          {/* Specialist */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Specialist</span>
                            <select
                              value={automation.specialistId ?? ""}
                              onChange={(e) => {
                                const specialist = specialists.find((s) => s.id === e.target.value);
                                setColumnAutomation((prev) => ({
                                  ...prev,
                                  [column.id]: {
                                    ...automation,
                                    specialistId: e.target.value || undefined,
                                    specialistName: specialist?.name,
                                    role: specialist?.role ?? automation.role,
                                  },
                                }));
                              }}
                              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
                            >
                              <option value="">None</option>
                              {specialists.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </div>
                          {/* Transition Type */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Trigger</span>
                            <select
                              value={automation.transitionType ?? "entry"}
                              onChange={(e) => {
                                setColumnAutomation((prev) => ({
                                  ...prev,
                                  [column.id]: { ...automation, transitionType: e.target.value as "entry" | "exit" | "both" },
                                }));
                              }}
                              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
                            >
                              <option value="entry">On entry</option>
                              <option value="exit">On exit</option>
                              <option value="both">Both</option>
                            </select>
                          </div>
                          {/* Auto-advance */}
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mt-1">
                            <input
                              type="checkbox"
                              checked={automation.autoAdvanceOnSuccess ?? false}
                              onChange={(e) => {
                                setColumnAutomation((prev) => ({
                                  ...prev,
                                  [column.id]: { ...automation, autoAdvanceOnSuccess: e.target.checked },
                                }));
                              }}
                            />
                            Auto-advance on success
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowSettings(false)}
                disabled={settingsSaving}
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#191c28] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!board) return;
                  setSettingsSaving(true);
                  try {
                    // Merge automation config and visibility into columns
                    const updatedColumns = board.columns.map((col) => ({
                      ...col,
                      visible: visibleColumns.includes(col.id),
                      automation: columnAutomation[col.id]?.enabled
                        ? columnAutomation[col.id]
                        : undefined,
                    }));

                    const response = await fetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ columns: updatedColumns }),
                    });

                    if (!response.ok) {
                      const data = await response.json();
                      throw new Error(data.error ?? "Failed to save settings");
                    }

                    setShowSettings(false);
                    onRefresh();
                  } catch (error) {
                    console.error("Failed to save board settings:", error);
                    alert(error instanceof Error ? error.message : "Failed to save settings");
                  } finally {
                    setSettingsSaving(false);
                  }
                }}
                disabled={settingsSaving}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {settingsSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Requirement 1: Codebase detail popup */}
      {selectedCodebase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]" data-testid="codebase-detail-modal">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}
              </h3>
              <button
                onClick={() => { setSelectedCodebase(null); setCodebaseWorktrees([]); }}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Path</div>
                  <div className="text-gray-700 dark:text-gray-300 font-mono text-xs truncate">{selectedCodebase.repoPath}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Branch</div>
                  <div className="text-gray-700 dark:text-gray-300">{selectedCodebase.branch ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Source Type</div>
                  <div className="text-gray-700 dark:text-gray-300">{selectedCodebase.sourceType ?? "local"}</div>
                </div>
                {selectedCodebase.sourceUrl && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Source URL</div>
                    <a href={selectedCodebase.sourceUrl} target="_blank" rel="noreferrer" className="text-amber-600 dark:text-amber-400 hover:underline text-xs truncate block">
                      {selectedCodebase.sourceUrl}
                    </a>
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Worktrees ({codebaseWorktrees.length})</div>
                {codebaseWorktrees.length === 0 ? (
                  <div className="text-gray-400 dark:text-gray-500 text-xs">No worktrees created yet</div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {codebaseWorktrees.map((wt) => (
                      <div key={wt.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            wt.status === "active"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                              : wt.status === "creating"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                          }`}>{wt.status}</span>
                          <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{wt.branch}</span>
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">{wt.worktreePath}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
                  <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Delete Task
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Are you sure you want to delete <span className="font-medium text-gray-900 dark:text-gray-100">&quot;{deleteConfirmTask.title}&quot;</span>? This action cannot be undone.
                  </p>
                  {deleteConfirmTask.githubNumber && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Note: This will only delete the local task. The GitHub issue #{deleteConfirmTask.githubNumber} will remain unchanged.
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={cancelDeleteTask}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDeleteTask}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}