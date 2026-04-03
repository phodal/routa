"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpState, UseAcpActions } from "@/client/hooks/use-acp";
import {
  resolveEffectiveTaskAutomation,
} from "@/core/kanban/effective-task-automation";
import type {
  GitHubIssueListItemInfo,
  KanbanAgentPromptHandler,
  KanbanBoardInfo,
  SessionInfo,
  TaskInfo,
  WorktreeInfo,
} from "../types";
import { EMPTY_DRAFT, type TaskDraft } from "../kanban-create-modal";
import { KanbanGitHubImportModal } from "./kanban-github-import-modal";
import { KanbanSettingsModal, type ColumnAutomationConfig } from "./kanban-settings-modal";
import { scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import {
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";
import {
  buildKanbanTaskAgentPrompt,
  getKanbanTaskAgentCopy,
} from "./i18n/kanban-task-agent";
import { createKanbanSpecialistResolver } from "./kanban-card-session-utils";
import { useTranslation } from "@/i18n";
import { normalizeKanbanAutomation } from "@/core/models/kanban";
import type { RepoSelection } from "@/client/components/repo-picker";
import type { RepoSyncState } from "./kanban-repo-sync-status";
import type { KanbanRepoChanges } from "./kanban-file-changes-types";
import {
  canSelectTaskSessionInAcp,
  extractSessionLiveTail,
  getPreferredTaskSessionId,
  isA2ATaskSession,
  taskOwnsSession,
} from "./kanban-tab-helpers";
import { KanbanTabHeader } from "./kanban-tab-header";
import {
  KanbanCodebaseModal,
  KanbanDeleteCodebaseModal,
  KanbanDeleteTaskModal,
  KanbanReplaceAllReposModal,
} from "./kanban-tab-modals";
import {
  KanbanBoardSurface,
  KanbanCreateTaskModal,
  KanbanTaskDetailOverlay,
} from "./kanban-tab-panels";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

interface KanbanTabProps {
  workspaceId: string;
  refreshSignal?: number;
  boards: KanbanBoardInfo[];
  tasks: TaskInfo[];
  sessions: SessionInfo[];
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  onSpecialistLanguageChange?: (language: KanbanSpecialistLanguage) => void;
  codebases: CodebaseData[];
  onRefresh: () => void;
  repoSync?: RepoSyncState;
  repoChanges?: KanbanRepoChanges[];
  repoChangesLoading?: boolean;
  /** ACP state and actions for agent input and session management */
  acp?: UseAcpState & UseAcpActions;
  /** Handler for agent prompt - creates session and sends prompt */
  onAgentPrompt?: KanbanAgentPromptHandler;
}

const KANBAN_DETAIL_SPLIT_RATIO_KEY = "routa:kanban-detail-split-ratio";
const MIN_DETAIL_SPLIT_RATIO = 0.32;
const MAX_DETAIL_SPLIT_RATIO = 0.72;
const LIVE_SESSION_TAIL_POLL_MS = 2500;

export function KanbanTab({
  workspaceId,
  refreshSignal,
  boards,
  tasks,
  sessions,
  providers,
  specialists,
  specialistLanguage = "en",
  onSpecialistLanguageChange: _onSpecialistLanguageChange,
  codebases,
  onRefresh,
  repoSync,
  repoChanges = [],
  repoChangesLoading = false,
  acp,
  onAgentPrompt,
}: KanbanTabProps) {
  const { t } = useTranslation();
  const kanbanTaskAgentCopy = getKanbanTaskAgentCopy(specialistLanguage);
  const resolveSpecialist = useMemo(
    () => createKanbanSpecialistResolver(specialists),
    [specialists],
  );
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
  const githubImportEnabled = codebases.length > 0;
  const githubAvailable = Boolean(defaultCodebase?.sourceUrl?.includes("github.com"));

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(defaultBoardId);
  const [localTasks, setLocalTasks] = useState<TaskInfo[]>(tasks);
  const autoPatchedTasksRef = useRef(new Set<string>());
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGitHubImportModal, setShowGitHubImportModal] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>({
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
  const [deletingWorktreeId, setDeletingWorktreeId] = useState<string | null>(null);
  const [worktreeActionError, setWorktreeActionError] = useState<string | null>(null);
  // Live branch info for selected codebase
  const [liveBranchInfo, setLiveBranchInfo] = useState<{ current: string; branches: string[] } | null>(null);

  // Worktree cache: worktreeId -> WorktreeInfo
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});
  const [missingWorktreeIds, setMissingWorktreeIds] = useState<Record<string, true>>({});
  const [liveSessionTails, setLiveSessionTails] = useState<Record<string, string>>({});
  const [backfilledSessions, setBackfilledSessions] = useState<Record<string, SessionInfo>>({});

  // Settings state - column automation rules (initialized from board columns)
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>({});

  // Delete confirmation modal state
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const detailSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const sessionBackfillInFlightRef = useRef(new Set<string>());
  const emptySessionRecoveryRef = useRef<string | null>(null);

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const session of sessions) {
      map.set(session.sessionId, session);
    }
    for (const [sessionId, session] of Object.entries(backfilledSessions)) {
      if (!map.has(sessionId)) {
        map.set(sessionId, session);
      }
    }
    return map;
  }, [backfilledSessions, sessions]);
  const combinedSessions = useMemo(
    () => Array.from(sessionMap.values()),
    [sessionMap],
  );
  const activeTask = useMemo(
    () => activeTaskId ? localTasks.find((task) => task.id === activeTaskId) ?? null : null,
    [activeTaskId, localTasks],
  );
  const preferredActiveTaskSessionId = useMemo(
    () => getPreferredTaskSessionId(activeTask),
    [activeTask],
  );
  const board = useMemo(
    () => boards.find((item) => item.id === selectedBoardId) ?? null,
    [boards, selectedBoardId],
  );
  const boardQueue = board?.queue;
  const queuedPositions = boardQueue?.queuedPositions ?? {};

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
      const planningPrompt = buildKanbanTaskAgentPrompt({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId ?? "default",
        repoPath: defaultCodebase?.repoPath,
        agentInput,
        language: specialistLanguage,
      });

      const sessionId = await onAgentPrompt(agentInput, {
        provider: acp?.selectedProvider,
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: [],
        mcpProfile: "kanban-planning",
        systemPrompt: planningPrompt,
      });
      if (!sessionId) return;
      openAgentPanel(sessionId);
      scheduleKanbanRefreshBurst(onRefresh);
      setAgentInput("");
    } catch (error) {
      console.error("[kanban] Failed to submit Kanban agent prompt:", error);
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
    specialistLanguage,
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
    setBackfilledSessions((current) => {
      const next = { ...current };
      let changed = false;
      for (const session of sessions) {
        if (next[session.sessionId]) {
          delete next[session.sessionId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sessions]);

  useEffect(() => {
    if (codebases.length === 0 || localTasks.length === 0) return;

    const codebaseById = new Map(codebases.map((codebase) => [codebase.id, codebase]));

    const pendingPatches: Array<{ taskId: string; codebaseId: string }> = [];

    for (const task of localTasks) {
      if (autoPatchedTasksRef.current.has(task.id)) continue;

      const taskCodebaseIds = task.codebaseIds ?? [];
      const hasValidCodebase = taskCodebaseIds.some((id) => codebaseById.has(id));
      if (hasValidCodebase) continue;

      let resolved: CodebaseData | null = null;
      const session = task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : null;
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
  }, [codebases, defaultCodebase, localTasks, patchTask, sessionMap]);

  const repoHealth = useMemo(() => {
    if (codebases.length === 0) {
      return { missingRepoTasks: 0, cwdMismatchTasks: 0 };
    }

    const codebaseById = new Map(codebases.map((cb) => [cb.id, cb]));
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
        const session = sessionMap.get(task.triggerSessionId);
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
  }, [codebases, defaultCodebase, localTasks, sessionMap]);

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

  useEffect(() => {
    if (!activeTask || !preferredActiveTaskSessionId) return;
    setActiveSessionId((current) => {
      if (!current) return preferredActiveTaskSessionId;
      if (!taskOwnsSession(activeTask, current)) return preferredActiveTaskSessionId;
      return current;
    });
  }, [activeTask, preferredActiveTaskSessionId]);

  useEffect(() => {
    const targetSessionId = preferredActiveTaskSessionId ?? activeSessionId;
    const sessionsInFlight = sessionBackfillInFlightRef.current;
    if (!activeTask || !targetSessionId) return;
    if (isA2ATaskSession(activeTask, targetSessionId)) return;
    if (sessionMap.has(targetSessionId)) return;
    if (sessionsInFlight.has(targetSessionId)) return;

    const controller = new AbortController();
    sessionsInFlight.add(targetSessionId);

    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        const session = data?.session as SessionInfo | undefined;
        if (!session?.sessionId) return;
        setBackfilledSessions((current) => ({ ...current, [session.sessionId]: session }));
      } catch {
        // Ignore targeted backfill failures; the manual refresh control remains available.
      } finally {
        sessionsInFlight.delete(targetSessionId);
      }
    })();

    return () => {
      controller.abort();
      sessionsInFlight.delete(targetSessionId);
    };
  }, [activeSessionId, activeTask, preferredActiveTaskSessionId, sessionMap]);

  useEffect(() => {
    if (!activeTask) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (activeSessionId || preferredActiveTaskSessionId) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (!resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist).canRun || activeTask.columnId === "done") {
      emptySessionRecoveryRef.current = null;
      return;
    }

    const recoveryKey = `${activeTask.id}:${activeTask.columnId ?? "backlog"}`;
    if (emptySessionRecoveryRef.current === recoveryKey) {
      return;
    }

    emptySessionRecoveryRef.current = recoveryKey;
    return scheduleKanbanRefreshBurst(onRefresh);
  }, [activeSessionId, activeTask, board?.columns, onRefresh, preferredActiveTaskSessionId, resolveSpecialist]);

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
  const activeLiveSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of boardTasks) {
      if (!task.triggerSessionId) continue;
      const laneSession = task.laneSessions?.find((entry) => entry.sessionId === task.triggerSessionId);
      if (laneSession?.status !== "running") continue;
      const session = sessionMap.get(task.triggerSessionId);
      if (!session) continue;
      ids.add(task.triggerSessionId);
    }
    return Array.from(ids);
  }, [boardTasks, sessionMap]);
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
    const latestSession = getPreferredTaskSessionId(task);
    setActiveSessionId(latestSession ?? null);

    if (task.codebaseIds?.length === 0 && defaultCodebase) {
      try {
        await patchTask(task.id, { codebaseIds: [defaultCodebase.id] });
      } catch (error) {
        console.error("Failed to auto-assign default repo to task", error);
      }
    }

    // Select the session in ACP if it exists
    if (latestSession && acp && canSelectTaskSessionInAcp(task, latestSession, sessionMap)) {
      acp.selectSession(latestSession);
    }
  }, [acp, defaultCodebase, patchTask, sessionMap]);

  const openSession = useCallback((sessionId: string | null, task?: TaskInfo | null) => {
    setActiveTaskId(null);
    setActiveSessionId(sessionId);
    // Select the session in ACP
    if (sessionId && acp && (
      task ? canSelectTaskSessionInAcp(task, sessionId, sessionMap) : sessionMap.has(sessionId)
    )) {
      acp.selectSession(sessionId);
    }
  }, [acp, sessionMap]);

  const closeTaskDetail = useCallback(() => {
    setActiveTaskId(null);
    setActiveSessionId(null);
  }, []);

  useEffect(() => {
    if (!agentSessionId || !agentPanelOpen) return;

    return scheduleKanbanRefreshBurst(onRefresh);
  }, [agentPanelOpen, agentSessionId, onRefresh]);

  useEffect(() => {
    if (activeLiveSessionIds.length === 0) {
      setLiveSessionTails((previous) => (Object.keys(previous).length > 0 ? {} : previous));
      return;
    }

    const activeIdSet = new Set(activeLiveSessionIds);
    let disposed = false;

    const pollLiveSessionTail = async () => {
      const updates = await Promise.all(activeLiveSessionIds.map(async (sessionId) => {
        try {
          const response = await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/history?consolidated=true`,
            { cache: "no-store" },
          );
          if (!response.ok) return [sessionId, null] as const;
          const payload = await response.json();
          return [sessionId, extractSessionLiveTail(payload?.history)] as const;
        } catch {
          return [sessionId, null] as const;
        }
      }));

      if (disposed) return;

      setLiveSessionTails((previous) => {
        const next: Record<string, string> = {};
        let changed = false;

        for (const [sessionId, tail] of updates) {
          if (!activeIdSet.has(sessionId) || !tail) continue;
          next[sessionId] = tail;
          if (previous[sessionId] !== tail) changed = true;
        }

        for (const sessionId of Object.keys(previous)) {
          if (!activeIdSet.has(sessionId)) {
            changed = true;
            continue;
          }
          if (!next[sessionId] && previous[sessionId]) changed = true;
        }

        return changed ? next : previous;
      });
    };

    void pollLiveSessionTail();
    const timerId = window.setInterval(() => {
      void pollLiveSessionTail();
    }, LIVE_SESSION_TAIL_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [activeLiveSessionIds]);

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
    const missing = worktreeIds.filter((id) => !worktreeCache[id] && !missingWorktreeIds[id]);
    if (missing.length === 0) return;

    (async () => {
      const results: Record<string, WorktreeInfo> = {};
      const staleIds = new Set<string>();
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await fetch(`/api/worktrees/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (res.ok) {
              const data = await res.json();
              if (data.worktree) results[id] = data.worktree as WorktreeInfo;
              return;
            }
            if (res.status === 404) {
              staleIds.add(id);
            }
          } catch { /* ignore */ }
        })
      );
      if (Object.keys(results).length > 0) {
        setWorktreeCache((prev) => ({ ...prev, ...results }));
      }
      if (staleIds.size > 0) {
        const staleIdList = [...staleIds];
        setMissingWorktreeIds((prev) => ({
          ...prev,
          ...Object.fromEntries(staleIdList.map((id) => [id, true] as const)),
        }));
        setLocalTasks((current) => current.map((task) => (
          task.worktreeId && staleIds.has(task.worktreeId)
            ? { ...task, worktreeId: undefined }
            : task
        )));

        const linkedTasks = localTasks
          .filter((task) => task.worktreeId && staleIds.has(task.worktreeId))
          .map((task) => task.id);

        await Promise.allSettled(linkedTasks.map(async (taskId) => {
          try {
            await patchTask(taskId, { worktreeId: null });
          } catch {
            // Ignore patch failures; the missing worktree cache prevents repeated 404 noise.
          }
        }));
      }
    })();
  }, [localTasks, missingWorktreeIds, patchTask, worktreeCache]);

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

  const handleDeleteCodebaseWorktree = useCallback(async (worktree: WorktreeInfo) => {
    setWorktreeActionError(null);
    setDeletingWorktreeId(worktree.id);
    try {
      const linkedTasks = localTasks.filter((task) => task.worktreeId === worktree.id);
      await Promise.all(linkedTasks.map((task) => patchTask(task.id, { worktreeId: null })));

      const response = await fetch(`/api/worktrees/${encodeURIComponent(worktree.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? "Failed to delete worktree");
      }

      setCodebaseWorktrees((current) => current.filter((item) => item.id !== worktree.id));
      setWorktreeCache((current) => {
        const next = { ...current };
        delete next[worktree.id];
        return next;
      });
    } catch (error) {
      setWorktreeActionError(error instanceof Error ? error.message : "Failed to delete worktree");
    } finally {
      setDeletingWorktreeId(null);
    }
  }, [localTasks, patchTask]);

  async function createTaskCard() {
    const effectiveCodebaseIds = draft.codebaseIds.length > 0 ? draft.codebaseIds : allCodebaseIds;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId,
        title: draft.title,
        objective: draft.objectiveHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        testCases: draft.testCases.split("\n").map((item) => item.trim()).filter(Boolean),
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
      throw new Error(data.error ?? "Failed to create task");
    }
    setLocalTasks((current) => [...current, data.task as TaskInfo]);
    setDraft({ ...EMPTY_DRAFT, objectiveHtml: "", createGitHubIssue: false });
    setShowCreateModal(false);
    onRefresh();
  }

  async function importGitHubIssues(
    codebaseId: string,
    issues: GitHubIssueListItemInfo[],
    repo: string,
  ) {
    const importedTasks: TaskInfo[] = [];

    for (const issue of issues) {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          boardId: selectedBoardId ?? defaultBoardId,
          columnId: "backlog",
          title: issue.title,
          objective: issue.body?.trim() || issue.title,
          labels: issue.labels,
          codebaseIds: [codebaseId],
          githubId: issue.id,
          githubNumber: issue.number,
          githubUrl: issue.url,
          githubRepo: repo,
          githubState: issue.state,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Failed to import GitHub issue #${issue.number}`,
        );
      }
      importedTasks.push(data.task as TaskInfo);
    }

    if (importedTasks.length > 0) {
      setLocalTasks((current) => {
        const next = [...current];
        const existingIds = new Set(current.map((task) => task.id));
        for (const task of importedTasks) {
          if (!existingIds.has(task.id)) {
            next.push(task);
          }
        }
        return next;
      });
      onRefresh();
    }
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
    setMoveError(null);

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
        openSession(updated.triggerSessionId, updated);
      }
      setMoveError(null);
      onRefresh();
    } catch (error) {
      console.error(error);
      setMoveError(error instanceof Error ? error.message : "Failed to move task");
      setLocalTasks(tasks);
    }
  }

  async function _createBoard() {
    const name = window.prompt(t.kanban.boardName);
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
      <div className="flex h-full flex-col space-y-2">
        <KanbanTabHeader
          tasksCount={tasks.length}
          board={board}
          boardQueue={boardQueue}
          repoHealth={repoHealth}
          boards={boards}
          selectedBoardId={selectedBoardId}
          onSelectBoard={setSelectedBoardId}
          githubImportEnabled={githubImportEnabled}
          onOpenGitHubImport={() => setShowGitHubImportModal(true)}
          onOpenSettings={() => setShowSettings(true)}
          onRefresh={onRefresh}
        />
        <div className="rounded-2xl border border-gray-200/60 bg-white p-6 text-sm text-gray-500 dark:border-[#1c1f2e] dark:bg-[#12141c] dark:text-gray-400">
          No board available yet.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-2">
      <KanbanTabHeader
        tasksCount={tasks.length}
        board={board}
        boardQueue={boardQueue}
        repoHealth={repoHealth}
        boards={boards}
        selectedBoardId={selectedBoardId}
        onSelectBoard={setSelectedBoardId}
        githubImportEnabled={githubImportEnabled}
        onOpenGitHubImport={() => setShowGitHubImportModal(true)}
        onOpenSettings={() => setShowSettings(true)}
        onRefresh={onRefresh}
      />
      <KanbanBoardSurface
        moveError={moveError}
        onDismissMoveError={() => setMoveError(null)}
        codebases={codebases}
        workspaceId={workspaceId}
        defaultCodebase={defaultCodebase}
        repoSync={repoSync}
        setSelectedCodebase={setSelectedCodebase}
        fetchCodebaseWorktrees={fetchCodebaseWorktrees}
        onRefresh={onRefresh}
        onAgentPrompt={onAgentPrompt}
        repoChanges={repoChanges}
        repoChangesLoading={repoChangesLoading}
        availableProviders={availableProviders}
        acp={acp}
        kanbanTaskAgentCopy={kanbanTaskAgentCopy}
        agentInput={agentInput}
        setAgentInput={setAgentInput}
        agentLoading={agentLoading}
        handleAgentSubmit={handleAgentSubmit}
        setShowCreateModal={setShowCreateModal}
        agentSessionId={agentSessionId}
        openAgentPanel={openAgentPanel}
        agentPanelOpen={agentPanelOpen}
        board={board}
        visibleColumns={visibleColumns}
        boardTasks={boardTasks}
        columnAutomation={columnAutomation}
        providers={providers}
        specialists={specialists}
        specialistLanguage={specialistLanguage}
        sessionMap={sessionMap}
        liveSessionTails={liveSessionTails}
        allCodebaseIds={allCodebaseIds}
        worktreeCache={worktreeCache}
        queuedPositions={queuedPositions}
        dragTaskId={dragTaskId}
        setDragTaskId={setDragTaskId}
        moveTask={moveTask}
        confirmDeleteTask={confirmDeleteTask}
        patchTask={patchTask}
        retryTaskTrigger={retryTaskTrigger}
        openTaskDetail={openTaskDetail}
        agentSession={agentSession}
        onCloseAgentPanel={() => setAgentPanelOpen(false)}
        ensureKanbanAgentSession={ensureKanbanAgentSession}
        kanbanRepoSelection={kanbanRepoSelection}
      />

      <KanbanCreateTaskModal
        showCreateModal={showCreateModal}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setShowCreateModal(false)}
        onCreate={() => void createTaskCard()}
        githubAvailable={githubAvailable}
        codebases={codebases}
        allCodebaseIds={allCodebaseIds}
      />

      <KanbanGitHubImportModal
        show={showGitHubImportModal}
        workspaceId={workspaceId}
        codebases={codebases}
        tasks={localTasks}
        onClose={() => setShowGitHubImportModal(false)}
        onImport={importGitHubIssues}
      />

      <KanbanTaskDetailOverlay
        activeSessionId={activeSessionId}
        activeTaskId={activeTaskId}
        activeTask={activeTask}
        board={board}
        resolveSpecialist={resolveSpecialist}
        acp={acp}
        detailSplitContainerRef={detailSplitContainerRef}
        detailSplitRatio={detailSplitRatio}
        setIsDraggingDetailSplit={setIsDraggingDetailSplit}
        refreshSignal={refreshSignal}
        availableProviders={availableProviders}
        specialists={specialists}
        specialistLanguage={specialistLanguage}
        codebases={codebases}
        allCodebaseIds={allCodebaseIds}
        worktreeCache={worktreeCache}
        combinedSessions={combinedSessions}
        patchTask={patchTask}
        retryTaskTrigger={retryTaskTrigger}
        confirmDeleteTask={confirmDeleteTask}
        onRefresh={onRefresh}
        setActiveSessionId={setActiveSessionId}
        closeTaskDetail={closeTaskDetail}
        sessionMap={sessionMap}
        workspaceId={workspaceId}
      />

      {/* Settings Modal */}
      {showSettings && board && (
        <KanbanSettingsModal
          board={board}
          columnAutomation={columnAutomation}
          availableProviders={availableProviders}
          specialists={specialists}
          specialistLanguage={specialistLanguage}
          onClose={() => setShowSettings(false)}
          onClearAll={async () => {
            const response = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
              method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(data.error ?? "Failed to clear tasks");
            }

            setLocalTasks([]);
            closeTaskDetail();
            setShowSettings(false);
            onRefresh();
          }}
          onSave={async (newColumns, newColumnAutomation, sessionConcurrencyLimit, devSessionSupervision) => {
            const updatedColumns = newColumns.map((col) => ({
              ...col,
              automation: newColumnAutomation[col.id]?.enabled
                ? normalizeKanbanAutomation(newColumnAutomation[col.id])
                : undefined,
            }));

            const response = await fetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ columns: updatedColumns, sessionConcurrencyLimit, devSessionSupervision }),
            });

            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error ?? "Failed to save settings");
            }

            setVisibleColumns(updatedColumns.filter((col) => col.visible !== false).map((col) => col.id));
            setColumnAutomation(newColumnAutomation);
            setShowSettings(false);
            onRefresh();
          }}
        />
      )}

      {/* Requirement 1: Codebase detail popup */}
      <KanbanCodebaseModal
        selectedCodebase={selectedCodebase}
        editingCodebase={editingCodebase}
        codebases={codebases}
        editRepoSelection={editRepoSelection}
        onRepoSelectionChange={handleRepoSelectionChange}
        editError={editError}
        recloneError={recloneError}
        editSaving={editSaving}
        replacingAll={replacingAll}
        setShowReplaceAllConfirm={setShowReplaceAllConfirm}
        handleCancelEditCodebase={handleCancelEditCodebase}
        codebaseWorktrees={codebaseWorktrees}
        worktreeActionError={worktreeActionError}
        localTasks={localTasks}
        handleDeleteCodebaseWorktree={handleDeleteCodebaseWorktree}
        deletingWorktreeId={deletingWorktreeId}
        liveBranchInfo={liveBranchInfo}
        handleReclone={handleReclone}
        recloning={recloning}
        recloneSuccess={recloneSuccess}
        onStartEditCodebase={handleStartEditCodebase}
        onRequestRemoveCodebase={() => setShowDeleteCodebaseConfirm(true)}
        onClose={() => {
          setSelectedCodebase(null);
          setCodebaseWorktrees([]);
          setEditingCodebase(false);
          setLiveBranchInfo(null);
          setRecloneError(null);
          setRecloneSuccess(null);
        }}
      />

      {showDeleteCodebaseConfirm && (
        <KanbanDeleteCodebaseModal
          selectedCodebase={selectedCodebase}
          editError={editError}
          deletingCodebase={deletingCodebase}
          onCancel={() => setShowDeleteCodebaseConfirm(false)}
          onConfirm={handleRemoveCodebase}
        />
      )}

      {showReplaceAllConfirm && (
        <KanbanReplaceAllReposModal
          editRepoSelection={editRepoSelection}
          codebasesCount={codebases.length}
          recloneError={recloneError}
          replacingAll={replacingAll}
          onCancel={() => setShowReplaceAllConfirm(false)}
          onConfirm={handleReplaceAllRepos}
        />
      )}

      <KanbanDeleteTaskModal
        deleteConfirmTask={deleteConfirmTask}
        isDeleting={isDeleting}
        onCancel={cancelDeleteTask}
        onConfirm={executeDeleteTask}
      />
    </div>
  );
}
