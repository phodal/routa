"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpState, UseAcpActions } from "@/client/hooks/use-acp";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { KanbanCreateModal, EMPTY_DRAFT, type DraftIssue } from "../kanban-create-modal";
import { KanbanCard } from "./kanban-card";
import { KanbanSettingsModal, type ColumnAutomationConfig } from "./kanban-settings-modal";
import { KanbanCardDetail } from "./kanban-card-detail";
import { buildKanbanTaskAgentPrompt, scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import { KanbanBgAgentPanel } from "./kanban-bg-agent-panel";
import { ChatPanel } from "@/client/components/chat-panel";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";

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
  /** ACP state and actions for agent input and session management */
  acp?: UseAcpState & UseAcpActions;
  /** Handler for agent prompt - creates session and sends prompt */
  onAgentPrompt?: (
    prompt: string,
    options?: {
      provider?: string;
      role?: string;
      toolMode?: "essential" | "full";
      allowedNativeTools?: string[];
    },
  ) => Promise<string | null>;
}

const KANBAN_DETAIL_SPLIT_RATIO_KEY = "routa:kanban-detail-split-ratio";
const MIN_DETAIL_SPLIT_RATIO = 0.32;
const MAX_DETAIL_SPLIT_RATIO = 0.72;

function QueueStatusBadge({
  label,
  count,
  cards,
  className,
}: {
  label: string;
  count: number;
  cards: Array<{ cardId: string; cardTitle: string }>;
  className: string;
}) {
  const tooltip = cards.length > 0
    ? `${label}\n${cards.map((card, index) => `${index + 1}. ${card.cardTitle}`).join("\n")}`
    : `${label}\nNo cards`;

  return (
    <span
      className={`group relative rounded-full px-2.5 py-1 ${className}`}
      title={tooltip}
    >
      {label} {count}
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-xl border border-gray-200 bg-white p-3 text-left text-xs text-gray-700 shadow-xl group-hover:block dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-200">
        <div className="mb-2 font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        {cards.length > 0 ? (
          <div className="space-y-1">
            {cards.map((card, index) => (
              <div key={card.cardId} className="truncate">
                {index + 1}. {card.cardTitle}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 dark:text-gray-400">No cards</div>
        )}
      </span>
    </span>
  );
}

function resolveAutomationProviderName(
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
): string {
  if (!automation?.providerId) return "Default";
  return providers.find((provider) => provider.id === automation.providerId)?.name ?? automation.providerId;
}

function resolveAutomationSpecialistName(
  automation: ColumnAutomationConfig | undefined,
  specialists: SpecialistOption[],
): string | null {
  if (!automation?.specialistId && !automation?.specialistName) return null;
  return specialists.find((specialist) => specialist.id === automation.specialistId)?.name ?? automation.specialistName ?? null;
}

function formatLaneAutomationSummary(
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  const provider = resolveAutomationProviderName(automation, providers);
  const role = automation?.role ?? "DEVELOPER";
  const specialist = resolveAutomationSpecialistName(automation, specialists);
  const core = [provider, role, specialist].filter(Boolean).join(" · ");
  if (automation?.transitionType === "exit") return `${core} ->`;
  if (automation?.transitionType === "both") return `-> ${core} ->`;
  return `-> ${core}`;
}

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
  const autoPatchedTasksRef = useRef(new Set<string>());
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draft, setDraft] = useState<DraftIssue>({
    ...EMPTY_DRAFT,
    createGitHubIssue: false,
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // For card detail view;
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Agent input state
  const [agentInput, setAgentInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [bgAgentPanelOpen, setBgAgentPanelOpen] = useState(false);
  const [detailSplitRatio, setDetailSplitRatio] = useState(0.48);
  const [isDraggingDetailSplit, setIsDraggingDetailSplit] = useState(false);

  // Codebase detail popup state
  const [selectedCodebase, setSelectedCodebase] = useState<CodebaseData | null>(null);
  const [codebaseWorktrees, setCodebaseWorktrees] = useState<WorktreeInfo[]>([]);
  // Codebase edit state - use RepoPicker for re-selecting/cloning
  const [editingCodebase, setEditingCodebase] = useState(false);
  const [editRepoSelection, setEditRepoSelection] = useState<RepoSelection | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Re-clone state
  const [recloning, setRecloning] = useState(false);
  const [recloneError, setRecloneError] = useState<string | null>(null);
  const [recloneSuccess, setRecloneSuccess] = useState<string | null>(null);
  // Replace all repos state
  const [showReplaceAllConfirm, setShowReplaceAllConfirm] = useState(false);
  const [replacingAll, setReplacingAll] = useState(false);
  // Delete codebase state
  const [showDeleteCodebaseConfirm, setShowDeleteCodebaseConfirm] = useState(false);
  const [deletingCodebase, setDeletingCodebase] = useState(false);
  // Live branch info for selected codebase
  const [liveBranchInfo, setLiveBranchInfo] = useState<{ current: string; branches: string[] } | null>(null);

  // Worktree cache: worktreeId -> WorktreeInfo
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});

  // Settings state - column automation rules (initialized from board columns)
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>({});

  // Delete confirmation modal state
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const detailSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const bgAgentPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const localStorageApi = window.localStorage;
    if (!localStorageApi || typeof localStorageApi.getItem !== "function") return;
    const stored = Number(localStorageApi.getItem(KANBAN_DETAIL_SPLIT_RATIO_KEY));
    if (!Number.isFinite(stored)) return;
    setDetailSplitRatio(Math.min(MAX_DETAIL_SPLIT_RATIO, Math.max(MIN_DETAIL_SPLIT_RATIO, stored)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const localStorageApi = window.localStorage;
    if (!localStorageApi || typeof localStorageApi.setItem !== "function") return;
    localStorageApi.setItem(KANBAN_DETAIL_SPLIT_RATIO_KEY, String(detailSplitRatio));
  }, [detailSplitRatio]);

  useEffect(() => {
    if (!bgAgentPanelOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const panel = bgAgentPanelRef.current;
      if (!panel) return;
      if (panel.contains(event.target as Node)) return;
      setBgAgentPanelOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBgAgentPanelOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [bgAgentPanelOpen]);

  useEffect(() => {
    if (!isDraggingDetailSplit) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = detailSplitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const nextRatio = (event.clientX - rect.left) / rect.width;
      setDetailSplitRatio(Math.min(MAX_DETAIL_SPLIT_RATIO, Math.max(MIN_DETAIL_SPLIT_RATIO, nextRatio)));
    };

    const handleMouseUp = () => setIsDraggingDetailSplit(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingDetailSplit]);

  const openAgentPanel = useCallback((sessionId: string) => {
    setAgentSessionId(sessionId);
    setAgentPanelOpen(true);
    acp?.selectSession(sessionId);
  }, [acp]);

  // Handle agent input submission
  const handleAgentSubmit = useCallback(async () => {
    if (!agentInput.trim() || !onAgentPrompt || agentLoading) return;

    setAgentLoading(true);
    try {
      const systemPrompt = buildKanbanTaskAgentPrompt({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId ?? "default",
        repoPath: defaultCodebase?.repoPath,
        agentInput,
      });

      const sessionId = await onAgentPrompt(systemPrompt, {
        provider: acp?.selectedProvider,
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: [],
      });
      if (sessionId) {
        openAgentPanel(sessionId);
        scheduleKanbanRefreshBurst(onRefresh);
      }
      setAgentInput("");
    } finally {
      setAgentLoading(false);
    }
  }, [
    acp?.selectedProvider,
    agentInput,
    agentLoading,
    defaultBoardId,
    defaultCodebase?.repoPath,
    onAgentPrompt,
    onRefresh,
    openAgentPanel,
    selectedBoardId,
    workspaceId,
  ]);

  useEffect(() => {
    setSelectedBoardId(defaultBoardId);
  }, [defaultBoardId]);

  const patchTask = useCallback(async (taskId: string, payload: Record<string, unknown>) => {
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
  }, []);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (codebases.length === 0 || localTasks.length === 0) return;

    const codebaseById = new Map(codebases.map((codebase) => [codebase.id, codebase]));
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));

    const pendingPatches: Array<{ taskId: string; codebaseId: string }> = [];

    for (const task of localTasks) {
      if (autoPatchedTasksRef.current.has(task.id)) continue;

      const taskCodebaseIds = task.codebaseIds ?? [];
      const hasValidCodebase = taskCodebaseIds.some((id) => codebaseById.has(id));
      if (hasValidCodebase) continue;

      let resolved: CodebaseData | null = null;
      const session = task.triggerSessionId ? sessionById.get(task.triggerSessionId) : null;
      if (session?.cwd) {
        resolved = codebases.find((codebase) => codebase.repoPath === session.cwd) ?? null;
      }

      if (!resolved && defaultCodebase) {
        resolved = defaultCodebase;
      }

      if (resolved) {
        pendingPatches.push({ taskId: task.id, codebaseId: resolved.id });
      }
    }

    if (pendingPatches.length === 0) return;

    for (const patch of pendingPatches) {
      autoPatchedTasksRef.current.add(patch.taskId);
      void patchTask(patch.taskId, { codebaseIds: [patch.codebaseId] });
    }
  }, [codebases, defaultCodebase, localTasks, patchTask, sessions]);

  const repoHealth = useMemo(() => {
    if (codebases.length === 0) {
      return { missingRepoTasks: 0, cwdMismatchTasks: 0 };
    }

    const codebaseById = new Map(codebases.map((cb) => [cb.id, cb]));
    const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
    let missingRepoTasks = 0;
    let cwdMismatchTasks = 0;

    for (const task of localTasks) {
      const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0
        ? task.codebaseIds
        : [];
      const hasMissingRepo = taskCodebaseIds.length > 0 &&
        taskCodebaseIds.every((cbId) => !codebaseById.has(cbId));
      if (hasMissingRepo) {
        missingRepoTasks += 1;
      }

      if (task.triggerSessionId) {
        const session = sessionById.get(task.triggerSessionId);
        if (session?.cwd) {
          const primaryCodebase = taskCodebaseIds.length > 0
            ? codebaseById.get(taskCodebaseIds[0]) ?? defaultCodebase
            : defaultCodebase;
          if (primaryCodebase?.repoPath && session.cwd !== primaryCodebase.repoPath) {
            cwdMismatchTasks += 1;
          }
        }
      }
    }

    return { missingRepoTasks, cwdMismatchTasks };
  }, [codebases, defaultCodebase, localTasks, sessions]);

  // Sync task's assignedProvider to ACP state when activeTaskId changes
  useEffect(() => {
    if (!activeTaskId) return;
    const task = localTasks.find((t) => t.id === activeTaskId);
    if (task?.assignedProvider && acp?.setProvider) {
      acp.setProvider(task.assignedProvider);
    }
    // Only trigger when activeTaskId changes, not when acp changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  const board = useMemo(
    () => boards.find((item) => item.id === selectedBoardId) ?? null,
    [boards, selectedBoardId],
  );
  const boardQueue = board?.queue;
  const queuedPositions = boardQueue?.queuedPositions ?? {};

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
      const automation: Record<string, ColumnAutomationConfig> = {};
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
  const agentSession = agentSessionId ? sessionMap.get(agentSessionId) : undefined;
  const kanbanRepoSelection = useMemo<RepoSelection | null>(() => {
    if (!defaultCodebase) return null;
    return {
      path: defaultCodebase.repoPath,
      branch: defaultCodebase.branch ?? "",
      name: defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? "",
    };
  }, [defaultCodebase]);

  const ensureKanbanAgentSession = useCallback(async (
    cwd?: string,
    provider?: string,
    _modeId?: string,
    model?: string,
  ) => {
    if (!acp) return null;
    if (agentSessionId) {
      return agentSessionId;
    }

    const result = await acp.createSession(
      cwd ?? defaultCodebase?.repoPath,
      provider ?? acp.selectedProvider,
      undefined,
      "DEVELOPER",
      workspaceId,
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "full",
      [],
    );

    if (!result?.sessionId) {
      return null;
    }

    openAgentPanel(result.sessionId);
    return result.sessionId;
  }, [acp, agentSessionId, defaultCodebase?.repoPath, openAgentPanel, workspaceId]);

  const openTaskDetail = useCallback(async (task: TaskInfo) => {
    setActiveTaskId(task.id);
    // Use triggerSessionId if available, otherwise show the latest session from history
    const latestSession = task.triggerSessionId
      ?? (task.sessionIds && task.sessionIds.length > 0 ? task.sessionIds[task.sessionIds.length - 1] : null);
    setActiveSessionId(latestSession ?? null);

    if (task.codebaseIds?.length === 0 && defaultCodebase) {
      try {
        await patchTask(task.id, { codebaseIds: [defaultCodebase.id] });
      } catch (error) {
        console.error("Failed to auto-assign default repo to task", error);
      }
    }

    // Select the session in ACP if it exists
    if (latestSession && acp) {
      acp.selectSession(latestSession);
    }
  }, [acp, defaultCodebase, patchTask]);

  const openSession = useCallback((sessionId: string | null) => {
    setActiveTaskId(null);
    setActiveSessionId(sessionId);
    // Select the session in ACP
    if (sessionId && acp) {
      acp.selectSession(sessionId);
    }
  }, [acp]);

  const closeTaskDetail = useCallback(() => {
    setActiveTaskId(null);
    setActiveSessionId(null);
  }, []);

  useEffect(() => {
    if (!agentSessionId || !agentPanelOpen) return;

    return scheduleKanbanRefreshBurst(onRefresh);
  }, [agentPanelOpen, agentSessionId, onRefresh]);

  // Codebase edit handlers - use RepoPicker for re-selecting/cloning
  const handleStartEditCodebase = useCallback(() => {
    if (!selectedCodebase) return;
    // Initialize with current selection
    setEditRepoSelection({
      path: selectedCodebase.repoPath,
      branch: selectedCodebase.branch ?? "",
      name: selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop() ?? "",
    });
    setEditError(null);
    setEditingCodebase(true);
  }, [selectedCodebase]);

  const handleRepoSelectionChange = useCallback(async (selection: RepoSelection | null) => {
    if (!selection || !selectedCodebase) return;
    setEditRepoSelection(selection);
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: selection.name, repoPath: selection.path, branch: selection.branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update repository");
      setEditingCodebase(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh(); // Refresh to get updated codebase data
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update repository");
    } finally {
      setEditSaving(false);
    }
  }, [selectedCodebase, onRefresh]);

  const handleCancelEditCodebase = useCallback(() => {
    setEditingCodebase(false);
    setEditRepoSelection(null);
    setEditError(null);
  }, []);

  // Re-clone handler - triggers a fresh clone of the repository
  const handleReclone = useCallback(async () => {
    if (!selectedCodebase?.sourceUrl) return;
    setRecloning(true);
    setRecloneError(null);
    setRecloneSuccess(null);
    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: selectedCodebase.sourceUrl, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to re-clone repository");

      // Update the codebase with the new path if it changed
      if (data.path && data.path !== selectedCodebase.repoPath) {
        await fetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath: data.path, branch: data.branch }),
        });
      }
      setRecloneSuccess(`Repository re-cloned successfully${data.existed ? " (pulled latest)" : ""}`);
      onRefresh();
    } catch (err) {
      setRecloneError(err instanceof Error ? err.message : "Failed to re-clone repository");
    } finally {
      setRecloning(false);
    }
  }, [selectedCodebase, onRefresh]);

  // Replace all repos handler - updates all codebases to use the new cloned path
  const handleReplaceAllRepos = useCallback(async () => {
    if (!selectedCodebase?.sourceUrl || !editRepoSelection) return;
    setReplacingAll(true);
    setRecloneError(null);
    try {
      // Update all codebases in the workspace to use the new repo path
      const updatePromises = codebases.map(async (cb) => {
        const res = await fetch(`/api/codebases/${encodeURIComponent(cb.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoPath: editRepoSelection.path,
            branch: editRepoSelection.branch,
            label: editRepoSelection.name,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? `Failed to update codebase ${cb.id}`);
        }
      });
      await Promise.all(updatePromises);
      setShowReplaceAllConfirm(false);
      setEditingCodebase(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh();
    } catch (err) {
      setRecloneError(err instanceof Error ? err.message : "Failed to replace repositories");
    } finally {
      setReplacingAll(false);
    }
  }, [selectedCodebase, editRepoSelection, codebases, onRefresh]);

  // Remove codebase handler
  const handleRemoveCodebase = useCallback(async () => {
    if (!selectedCodebase) return;
    setDeletingCodebase(true);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(selectedCodebase.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove repository");
      }
      setShowDeleteCodebaseConfirm(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to remove repository");
    } finally {
      setDeletingCodebase(false);
    }
  }, [selectedCodebase, workspaceId, onRefresh]);

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
    // Reset live branch info
    setLiveBranchInfo(null);

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

    // Fetch live branch info from the repo
    try {
      const branchRes = await fetch(`/api/clone/branches?repoPath=${encodeURIComponent(codebase.repoPath)}`, { cache: "no-store" });
      if (branchRes.ok) {
        const branchData = await branchRes.json();
        setLiveBranchInfo({ current: branchData.current, branches: branchData.local || [] });
      }
    } catch { /* ignore */ }
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
        creationSource: "manual",
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
    setDraft({ ...EMPTY_DRAFT, objectiveHtml: "", createGitHubIssue: false });
    setShowCreateModal(false);
    onRefresh();
  }

  async function retryTaskTrigger(taskId: string) {
    const updated = await patchTask(taskId, { retryTrigger: true });
    if (updated.triggerSessionId) {
      // Keep the task detail open and update the session ID
      setActiveSessionId(updated.triggerSessionId);
      // Select the new session in ACP
      if (acp) {
        acp.selectSession(updated.triggerSessionId);
      }
    }
    onRefresh();
  }

  function confirmDeleteTask(task: TaskInfo) {
    setIsDeleting(false);
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
      // Keep the modal open so the user can retry.
    } finally {
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
      <div className="flex h-full flex-col space-y-4">
        <div className="flex justify-end">
          <div ref={bgAgentPanelRef} className="relative">
            <button
              type="button"
              onClick={() => setBgAgentPanelOpen((current) => !current)}
              data-testid="kanban-bg-agent-toggle"
              aria-expanded={bgAgentPanelOpen}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-300 dark:hover:bg-[#191c28]"
            >
              <svg
                className={`h-3.5 w-3.5 text-gray-400 transition-transform ${bgAgentPanelOpen ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Background Agents
            </button>
            {bgAgentPanelOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-[min(72rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl">
                <KanbanBgAgentPanel workspaceId={workspaceId} />
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200/60 bg-white p-6 text-sm text-gray-500 dark:border-[#1c1f2e] dark:bg-[#12141c] dark:text-gray-400">
          No board available yet.
        </div>
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
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#0d1018]">
                  <span className="text-sm text-gray-400 dark:text-gray-500">No repositories linked.</span>
                  <div className="flex items-center gap-2">
                    <RepoPicker
                      value={null}
                      onChange={async (selection) => {
                        if (!selection) return;
                        try {
                          const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              repoPath: selection.path,
                              branch: selection.branch,
                              label: selection.name
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
                          // Refresh codebases
                          onRefresh?.();
                        } catch (err) {
                          console.error("Failed to add repository:", err);
                          alert(err instanceof Error ? err.message : "Failed to add repository");
                        }
                      }}
                      additionalRepos={[]}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  {/* Show default repo badge */}
                  {defaultCodebase && (
                    <button
                      onClick={() => {
                        setSelectedCodebase(defaultCodebase);
                        void fetchCodebaseWorktrees(defaultCodebase);
                      }}
                      className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-amber-900/10"
                      data-testid="codebase-badge"
                      title={`${defaultCodebase.label ?? defaultCodebase.repoPath} - ${defaultCodebase.branch ? `@${defaultCodebase.branch}` : ''}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${defaultCodebase.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                      <span className="truncate font-medium">{defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? defaultCodebase.repoPath}</span>
                      {defaultCodebase.branch && <span className="shrink-0 text-gray-400 dark:text-gray-500">@{defaultCodebase.branch}</span>}
                    </button>
                  )}
                  {/* Show count for additional repos */}
                  {codebases.length > 1 && (
                    <button
                      onClick={() => {
                        // Select first non-default repo
                        const otherRepo = codebases.find(cb => cb.id !== defaultCodebase?.id);
                        if (otherRepo) {
                          setSelectedCodebase(otherRepo);
                          void fetchCodebaseWorktrees(otherRepo);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:bg-amber-900/10"
                      title={`+${codebases.length - 1} more ${codebases.length - 1 === 1 ? 'repository' : 'repositories'} - click to view all`}
                    >
                      <span className="font-medium">+{codebases.length - 1}</span>
                    </button>
                  )}
                </div>
              )}
            </div>



            {onAgentPrompt && (
              <div className="flex min-w-[20rem] flex-1 items-center gap-2 xl:max-w-none">
                <div className="group relative flex min-w-0 flex-1 items-center rounded-2xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-amber-400/80 focus-within:ring-2 focus-within:ring-amber-400/15 dark:border-gray-700 dark:bg-[#12141c]">
                  <div className="relative shrink-0">
                    <select
                      value={acp?.selectedProvider ?? ""}
                      onChange={(event) => acp?.setProvider(event.target.value)}
                      disabled={!acp?.connected || availableProviders.length === 0}
                      className="h-10 appearance-none rounded-l-2xl border-r border-gray-200 bg-transparent pl-3 pr-8 text-sm font-medium text-gray-700 outline-none transition-colors disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                      aria-label="KanbanTask Agent provider"
                      data-testid="kanban-agent-provider"
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
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
                    placeholder={acp?.connected ? "Describe work to plan in Kanban..." : "Connecting..."}
                    disabled={agentLoading || !acp?.connected}
                    className="h-10 w-full bg-transparent px-3 pr-2 text-sm text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50 dark:text-gray-200 dark:placeholder-gray-500"
                  />
                  <button
                    onClick={() => void handleAgentSubmit()}
                    disabled={!agentInput.trim() || agentLoading || !acp?.connected}
                    className="mr-1.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-xl bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:bg-amber-500 dark:hover:bg-amber-400 dark:disabled:bg-[#1a1d29] dark:disabled:text-gray-500"
                  >
                    {agentLoading ? (
                      "..."
                    ) : (
                      <>
                        <span>Send</span>
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
                {agentSessionId && (
                  <button
                    onClick={() => openAgentPanel(agentSessionId)}
                    className="shrink-0 text-xs text-amber-600 hover:underline dark:text-amber-400"
                    title="Open the KanbanTask Agent panel"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {(repoHealth.missingRepoTasks > 0 || repoHealth.cwdMismatchTasks > 0) && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                <span className="font-medium">Repo health</span>
                {repoHealth.missingRepoTasks > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                    {repoHealth.missingRepoTasks} missing
                  </span>
                )}
                {repoHealth.cwdMismatchTasks > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {repoHealth.cwdMismatchTasks} session mismatch
                  </span>
                )}
              </div>
            )}
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
            <div ref={bgAgentPanelRef} className="relative">
              <button
                type="button"
                onClick={() => setBgAgentPanelOpen((current) => !current)}
                data-testid="kanban-bg-agent-toggle"
                aria-expanded={bgAgentPanelOpen}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-300 dark:hover:bg-[#191c28]"
              >
                <svg
                  className={`h-3.5 w-3.5 text-gray-400 transition-transform ${bgAgentPanelOpen ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Background Agents
              </button>
              {bgAgentPanelOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[min(72rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl">
                  <KanbanBgAgentPanel workspaceId={workspaceId} />
                </div>
              )}
            </div>
            <div className="inline-flex items-center rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-[#12141c]">
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-[10px] px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#191c28]"
                title="Board settings"
              >
                Settings
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-[10px] bg-gradient-to-r from-amber-500 to-orange-500 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-amber-600 hover:to-orange-500"
              >
                Manual
              </button>
            </div>
          </div>
        </div>
      </div>

      {board && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-[#191c28]">
            Limit {board.sessionConcurrencyLimit ?? 1}
          </span>
          <QueueStatusBadge
            label="Running"
            count={boardQueue?.runningCount ?? 0}
            cards={boardQueue?.runningCards ?? []}
            className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
          />
          <QueueStatusBadge
            label="Queued"
            count={boardQueue?.queuedCount ?? 0}
            cards={boardQueue?.queuedCards ?? []}
            className="bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          />
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-4">
        <div className={`${agentPanelOpen && agentSessionId ? "min-w-0 flex-1" : "w-full"} flex min-h-0 flex-col`}>
          <div className="flex-1 min-h-0 overflow-auto pb-2">
            <div className="flex min-h-full items-start gap-3" style={{ minWidth: `${visibleColumns.length * 18}rem` }}>
              {board.columns
                .slice()
                .sort((left, right) => left.position - right.position)
                .filter((column) => visibleColumns.includes(column.id))
                .map((column) => {
                  const columnTasks = boardTasks.filter((task) => (task.columnId ?? "backlog") === column.id);
                  const laneAutomation = columnAutomation[column.id] ?? column.automation;
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
                      <div className="mb-3 space-y-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{column.name}</div>
                          <div className="text-[11px] text-gray-400 dark:text-gray-500">{columnTasks.length} cards</div>
                        </div>
                        {laneAutomation?.enabled && (
                          <div
                            className="truncate text-[10px] leading-4 text-gray-500 dark:text-gray-400"
                            data-testid={`kanban-column-automation-${column.id}`}
                            title={formatLaneAutomationSummary(laneAutomation, providers, specialists)}
                          >
                            {formatLaneAutomationSummary(laneAutomation, providers, specialists)}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                        {columnTasks.map((task) => (
                          <KanbanCard
                            key={task.id}
                            task={task}
                            linkedSession={task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : undefined}
                            availableProviders={availableProviders}
                            specialists={specialists}
                            codebases={codebases}
                            allCodebaseIds={allCodebaseIds}
                            worktreeCache={worktreeCache}
                            queuePosition={queuedPositions[task.id]}
                            onDragStart={() => setDragTaskId(task.id)}
                            onOpenDetail={() => openTaskDetail(task)}
                            onOpenSession={openSession}
                            onDelete={() => confirmDeleteTask(task)}
                            onPatchTask={patchTask}
                            onRetryTrigger={retryTaskTrigger}
                            onRefresh={onRefresh}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {agentPanelOpen && agentSessionId && acp && (
          <aside
            className="flex h-full w-lg min-w-md flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c]"
            data-testid="kanban-agent-panel"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-[#191c28]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">KanbanTask Agent</div>
                <div className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                  {agentSession?.provider ?? acp.selectedProvider} · {agentSessionId.slice(0, 12)}...
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/workspace/${workspaceId}/sessions/${agentSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Open
                </a>
                <button
                  onClick={() => setAgentPanelOpen(false)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel
                acp={acp}
                activeSessionId={agentSessionId}
                onEnsureSession={ensureKanbanAgentSession}
                onSelectSession={async (sessionId) => {
                  openAgentPanel(sessionId);
                }}
                repoSelection={kanbanRepoSelection}
                onRepoChange={() => {}}
                codebases={codebases}
                activeWorkspaceId={workspaceId}
                agentRole="DEVELOPER"
              />
            </div>
          </aside>
        )}
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

      {(activeSessionId || activeTaskId) && (() => {
        const activeTask = activeTaskId ? localTasks.find((t) => t.id === activeTaskId) : null;
        const hasSessionPane = Boolean(activeSessionId && acp);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 animate-in fade-in duration-150">
            <div className="relative h-[88vh] w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
              <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4 dark:border-[#191c28]">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {activeTask ? activeTask.title : "ACP Session"}
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
            <div ref={detailSplitContainerRef} className="flex h-[calc(88vh-48px)]">
              {/* Left: Card Detail (if activeTaskId exists) */}
              {activeTaskId && (() => {
                const task = localTasks.find((t) => t.id === activeTaskId);
                if (!task) return null;
                const sessionInfo = task.triggerSessionId ? sessions.find((s) => s.sessionId === task.triggerSessionId) : null;
                return (
                  <div
                    className={`${hasSessionPane ? "shrink-0" : "flex-1"} h-full min-w-0 border-r border-gray-200/80 dark:border-[#202433]`}
                    style={hasSessionPane ? { width: `${detailSplitRatio * 100}%` } : undefined}
                  >
                    <KanbanCardDetail
                      key={task.id}
                      task={task}
                      boardColumns={board?.columns ?? []}
                      availableProviders={availableProviders}
                      specialists={specialists}
                      codebases={codebases}
                      allCodebaseIds={allCodebaseIds}
                      worktreeCache={worktreeCache}
                      sessionInfo={sessionInfo}
                      sessions={sessions}
                      fullWidth={!hasSessionPane}
                      onPatchTask={patchTask}
                      onRetryTrigger={retryTaskTrigger}
                      onDelete={() => confirmDeleteTask(task)}
                      onRefresh={onRefresh}
                      onProviderChange={(providerId) => {
                        if (acp && providerId) {
                          acp.setProvider(providerId);
                        }
                      }}
                      onRepositoryChange={(codebaseIds) => {
                        void codebaseIds;
                      }}
                      onSelectSession={(sessionId) => {
                        setActiveSessionId(sessionId);
                        acp?.selectSession(sessionId);
                      }}
                    />
                  </div>
                );
              })()}
              {activeTaskId && hasSessionPane && (
                <div
                  className="hidden md:flex h-full w-3 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-amber-50/80 dark:hover:bg-amber-900/10"
                  onMouseDown={() => setIsDraggingDetailSplit(true)}
                  data-testid="kanban-detail-split-handle"
                >
                  <div className="h-12 w-1 rounded-full bg-gray-300 transition-colors hover:bg-amber-400 dark:bg-gray-700 dark:hover:bg-amber-500" />
                </div>
              )}
              {/* Right: Session (if activeSessionId exists) */}
              {hasSessionPane ? (() => {
                // Build repoSelection and agentRole from active task
                const activeTask = activeTaskId ? localTasks.find((t) => t.id === activeTaskId) : null;
                const taskCodebaseIds = activeTask?.codebaseIds && activeTask.codebaseIds.length > 0
                  ? activeTask.codebaseIds
                  : allCodebaseIds;
                const primaryCodebase = taskCodebaseIds.length > 0
                  ? codebases.find((c) => c.id === taskCodebaseIds[0])
                  : null;
                const repoSelection = primaryCodebase
                  ? {
                      path: primaryCodebase.repoPath,
                      branch: primaryCodebase.branch ?? "",
                      name: primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop() ?? ""
                    }
                  : null;
                const taskAgentRole = activeTask?.assignedRole ?? undefined;

                return (
                  <div
                    className="h-full min-w-0 flex-1 overflow-hidden"
                    style={activeTaskId ? { width: `${(1 - detailSplitRatio) * 100}%` } : undefined}
                  >
                    {acp && (
                    <ChatPanel
                      acp={acp}
                      activeSessionId={activeSessionId}
                      onEnsureSession={async () => activeSessionId}
                      onSelectSession={async (sessionId) => {
                        setActiveSessionId(sessionId);
                        acp.selectSession(sessionId);
                      }}
                      repoSelection={repoSelection}
                      onRepoChange={() => {}}
                      codebases={codebases}
                      activeWorkspaceId={workspaceId}
                      agentRole={taskAgentRole}
                    />
                    )}
                  </div>
                );
              })() : null}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Settings Modal */}
      {showSettings && board && (
        <KanbanSettingsModal
          board={board}
          visibleColumns={visibleColumns}
          columnAutomation={columnAutomation}
          availableProviders={availableProviders}
          specialists={specialists}
          onClose={() => setShowSettings(false)}
          onSave={async (newVisibleColumns, newColumnAutomation, sessionConcurrencyLimit) => {
            // Merge automation config and visibility into columns
            const updatedColumns = board.columns.map((col) => ({
              ...col,
              visible: newVisibleColumns.includes(col.id),
              automation: newColumnAutomation[col.id]?.enabled
                ? newColumnAutomation[col.id]
                : undefined,
            }));

            const response = await fetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ columns: updatedColumns, sessionConcurrencyLimit }),
            });

            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error ?? "Failed to save settings");
            }

            setVisibleColumns(newVisibleColumns);
            setColumnAutomation(newColumnAutomation);
            setShowSettings(false);
            onRefresh();
          }}
        />
      )}

      {/* Requirement 1: Codebase detail popup */}
      {selectedCodebase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]" data-testid="codebase-detail-modal">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}
              </h3>
              <div className="flex items-center gap-2">
                {!editingCodebase && (
                  <>
                    <button
                      onClick={() => setShowDeleteCodebaseConfirm(true)}
                      className="text-sm text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300"
                    >
                      Remove
                    </button>
                    <button
                      onClick={handleStartEditCodebase}
                      className="text-sm text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
                    >
                      Edit
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setSelectedCodebase(null); setCodebaseWorktrees([]); setEditingCodebase(false); setLiveBranchInfo(null); setRecloneError(null); setRecloneSuccess(null); }}
                  className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Edit mode - use RepoPicker to select/clone repository */}
            {editingCodebase ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Select or clone a repository
                  </label>
                  <RepoPicker
                    value={editRepoSelection}
                    onChange={handleRepoSelectionChange}
                    additionalRepos={codebases.map((cb) => ({
                      name: cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath,
                      path: cb.repoPath,
                      branch: cb.branch,
                    }))}
                  />
                </div>
                {editError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400">{editError}</div>
                )}
                {recloneError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
                )}
                {editSaving && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">Updating repository...</div>
                )}

                {/* Replace All Repos option - only show when there are multiple codebases */}
                {codebases.length > 1 && editRepoSelection && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          You have {codebases.length} repositories in this workspace. Would you like to replace all of them with this repository?
                        </p>
                        <button
                          onClick={() => setShowReplaceAllConfirm(true)}
                          disabled={editSaving || replacingAll}
                          className="mt-2 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                          Replace All Repositories →
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={handleCancelEditCodebase}
                    disabled={editSaving || replacingAll}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Path</div>
                    <div className="text-gray-700 dark:text-gray-300 font-mono text-xs truncate">{selectedCodebase.repoPath}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Branch</div>
                    <div className="text-gray-700 dark:text-gray-300">
                      {liveBranchInfo?.current ?? selectedCodebase.branch ?? "—"}
                      {liveBranchInfo && liveBranchInfo.current !== selectedCodebase.branch && selectedCodebase.branch && (
                        <span className="ml-1 text-[10px] text-amber-500">(stored: {selectedCodebase.branch})</span>
                      )}
                    </div>
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

                {/* Re-clone section - only show for GitHub repos */}
                {selectedCodebase.sourceType === "github" && selectedCodebase.sourceUrl && (
                  <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Re-clone Repository</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">Pull latest or re-clone if the local copy is corrupted</div>
                      </div>
                      <button
                        onClick={handleReclone}
                        disabled={recloning}
                        className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                      >
                        {recloning ? "Cloning..." : "Re-clone"}
                      </button>
                    </div>
                    {recloneError && (
                      <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
                    )}
                    {recloneSuccess && (
                      <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{recloneSuccess}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Codebase Confirmation Modal */}
      {showDeleteCodebaseConfirm && selectedCodebase && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
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
                    Remove Repository
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Are you sure you want to remove <span className="font-medium text-gray-900 dark:text-gray-100">&quot;{selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}&quot;</span> from this workspace?
                  </p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                    This will only unlink the repository from this workspace. The repository files will not be deleted from your computer.
                  </p>
                </div>
              </div>
              {editError && (
                <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{editError}</div>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowDeleteCodebaseConfirm(false)}
                  disabled={deletingCodebase}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemoveCodebase}
                  disabled={deletingCodebase}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
                >
                  {deletingCodebase ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Replace All Repos Confirmation Modal */}
      {showReplaceAllConfirm && editRepoSelection && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
                  <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Replace All Repositories
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    This will update all <span className="font-medium text-gray-900 dark:text-gray-100">{codebases.length} repositories</span> in this workspace to use:
                  </p>
                  <div className="mt-2 rounded-lg bg-gray-50 p-2 dark:bg-[#0d1018]">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{editRepoSelection.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{editRepoSelection.path}</div>
                  </div>
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    This is useful when the codebase path has changed or you need to fix repository references.
                  </p>
                </div>
              </div>
              {recloneError && (
                <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowReplaceAllConfirm(false)}
                  disabled={replacingAll}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReplaceAllRepos}
                  disabled={replacingAll}
                  className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {replacingAll ? "Replacing..." : "Replace All"}
                </button>
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
