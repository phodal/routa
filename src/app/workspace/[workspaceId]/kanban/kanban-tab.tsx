"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpState, UseAcpActions } from "@/client/hooks/use-acp";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  resolveEffectiveTaskAutomation,
} from "@/core/kanban/effective-task-automation";
import type {
  GitHubIssueListItemInfo,
  GitHubPRListItemInfo,
  KanbanAgentPromptHandler,
  KanbanBoardInfo,
  KanbanDevSessionSupervisionInfo,
  SessionInfo,
  TaskInfo,
  WorktreeInfo,
} from "../types";
import { EMPTY_DRAFT, type TaskDraft } from "../kanban-create-modal";
import { type ColumnAutomationConfig, type KanbanSettingsModalProps } from "./kanban-settings-modal";
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
  resolveKanbanBoardAutoProviderId,
  taskOwnsSession,
} from "./kanban-tab-helpers";
import {
  importGitHubItems,
} from "./kanban-github-import";
import { getKanbanFileChangesSummary } from "./kanban-file-changes-panel";
import { KanbanTabContent } from "./kanban-tab-content";
import { useRuntimeFitnessStatus } from "./use-runtime-fitness-status";

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
  acp?: UseAcpState & UseAcpActions;
  onAgentPrompt?: KanbanAgentPromptHandler;
}

function isLikelyGitHubCodebase(codebase: CodebaseData | null | undefined): boolean {
  if (!codebase) return false;
  if (codebase.sourceType === "github") return true;
  if (codebase.sourceUrl?.includes("github.com")) return true;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(codebase.label?.trim() ?? "");
}

const KANBAN_DETAIL_SPLIT_RATIO_KEY = "routa:kanban-detail-split-ratio";
const KANBAN_BOARD_QUERY_KEY = "boardId";
const KANBAN_DETAIL_TASK_QUERY_KEY = "taskId";
const MIN_DETAIL_SPLIT_RATIO = 0.32;
const MAX_DETAIL_SPLIT_RATIO = 0.72;
const LIVE_SESSION_TAIL_POLL_MS = 10_000;

type MoveBlockedState = {
  message: string;
  taskId: string;
  targetColumnId: string;
  storyReadiness?: TaskInfo["storyReadiness"];
  missingTaskFields?: string[];
};

class TaskPatchError extends Error {
  storyReadiness?: TaskInfo["storyReadiness"];
  missingTaskFields?: string[];

  constructor(
    message: string,
    options?: {
      storyReadiness?: TaskInfo["storyReadiness"];
      missingTaskFields?: string[];
    },
  ) {
    super(message);
    this.name = "TaskPatchError";
    this.storyReadiness = options?.storyReadiness;
    this.missingTaskFields = options?.missingTaskFields;
  }
}

function isPlanBacklogBoard(board: KanbanBoardInfo): boolean {
  return board.name.trim().replace(/\s+/g, " ").toLowerCase() === "plan backlog";
}

function getKanbanUrlState(): { boardId: string | null; taskId: string | null } | null {
  if (typeof window === "undefined") return null;
  const searchParams = new URLSearchParams(window.location.search);
  return {
    boardId: searchParams.get(KANBAN_BOARD_QUERY_KEY),
    taskId: searchParams.get(KANBAN_DETAIL_TASK_QUERY_KEY),
  };
}

function updateKanbanUrlState(
  state: { boardId?: string | null; taskId?: string | null },
  mode: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (state.boardId) {
    url.searchParams.set(KANBAN_BOARD_QUERY_KEY, state.boardId);
  } else {
    url.searchParams.delete(KANBAN_BOARD_QUERY_KEY);
  }

  if (state.taskId) {
    url.searchParams.set(KANBAN_DETAIL_TASK_QUERY_KEY, state.taskId);
  } else {
    url.searchParams.delete(KANBAN_DETAIL_TASK_QUERY_KEY);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", nextUrl);
}

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
  const [localBoards, setLocalBoards] = useState<KanbanBoardInfo[]>(boards);
  const visibleBoards = useMemo(
    () => localBoards.filter((board) => !isPlanBacklogBoard(board)),
    [localBoards],
  );
  const resolveSpecialist = useMemo(
    () => createKanbanSpecialistResolver(specialists),
    [specialists],
  );
  const defaultBoardId = useMemo(
    () => localBoards.find((board) => !isPlanBacklogBoard(board) && board.isDefault)?.id
      ?? visibleBoards[0]?.id
      ?? localBoards[0]?.id
      ?? null,
    [localBoards, visibleBoards],
  );
  const allCodebaseIds = useMemo(
    () => codebases.map((codebase) => codebase.id),
    [codebases],
  );
  const defaultCodebase = useMemo(
    () => codebases.find((codebase) => codebase.isDefault) ?? codebases[0] ?? null,
    [codebases],
  );
  const hasGitHubCodebase = useMemo(
    () => codebases.some((codebase) => isLikelyGitHubCodebase(codebase)),
    [codebases],
  );
  const githubAvailable = isLikelyGitHubCodebase(defaultCodebase);

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(() => {
    const initialUrlState = getKanbanUrlState();
    return initialUrlState?.boardId ?? defaultBoardId;
  });
  const [localTasks, setLocalTasks] = useState<TaskInfo[]>(tasks);
  const autoPatchedTasksRef = useRef(new Set<string>());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGitHubImportModal, setShowGitHubImportModal] = useState(false);
  const [githubAccessAvailable, setGitHubAccessAvailable] = useState(false);
  const [githubAccessSource, setGitHubAccessSource] = useState<"board" | "env" | "gh" | "none">("none");
  const [draft, setDraft] = useState<TaskDraft>({
    ...EMPTY_DRAFT,
    createGitHubIssue: false,
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // For card detail view;
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const [agentInput, setAgentInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [showFitnessWorkbench, setShowFitnessWorkbench] = useState(false);
  const [fitnessWorkbenchSessionId, setFitnessWorkbenchSessionId] = useState<string | null>(null);
  const [detailSplitRatio, setDetailSplitRatio] = useState(0.48);
  const [isDraggingDetailSplit, setIsDraggingDetailSplit] = useState(false);

  // Codebase detail popup state
  const [showCodebaseModal, setShowCodebaseModal] = useState(false);
  const [selectedCodebase, setSelectedCodebase] = useState<CodebaseData | null>(null);
  const [codebaseWorktrees, setCodebaseWorktrees] = useState<WorktreeInfo[]>([]);
  const [addRepoSelection, setAddRepoSelection] = useState<RepoSelection | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
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
  const [deletingWorktreeIds, setDeletingWorktreeIds] = useState<string[]>([]);
  const [deletingBranchNames, setDeletingBranchNames] = useState<string[]>([]);
  const [branchActionError, setBranchActionError] = useState<string | null>(null);
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
  const [moveBlockedState, setMoveBlockedState] = useState<MoveBlockedState | null>(null);
  const detailSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const [isTaskDetailFullscreen, setIsTaskDetailFullscreen] = useState(false);
  const [fileChangesOpen, setFileChangesOpen] = useState(false);
  const [gitLogOpen, setGitLogOpen] = useState(false);
  const sessionBackfillInFlightRef = useRef(new Set<string>());
  const emptySessionRecoveryRef = useRef<string | null>(null);
  const previousPreferredTaskSessionIdRef = useRef<string | null>(null);
  const userManuallySelectedSessionRef = useRef(false);
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === "undefined" || document.visibilityState === "visible"
  ));

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
    () => localBoards.find((item) => item.id === selectedBoardId) ?? null,
    [localBoards, selectedBoardId],
  );
  const boardQueue = board?.queue;
  const boardAutoProviderId = useMemo(
    () => resolveKanbanBoardAutoProviderId(board, acp?.selectedProvider),
    [acp?.selectedProvider, board],
  );
  const activeTaskEffectiveAutomation = useMemo(
    () => activeTask
      ? resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : null,
    [activeTask, board?.columns, boardAutoProviderId, resolveSpecialist],
  );
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

  const persistBoardAutoProvider = useCallback(async (providerId: string | null | undefined) => {
    if (!board?.id) return;
    await desktopAwareFetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoProviderId: providerId ?? "" }),
    });
  }, [board?.id]);

  const setKanbanBoardProvider = useCallback((providerId: string) => {
    if (!providerId) return;
    acp?.setProvider(providerId);
    if (board?.autoProviderId !== providerId) {
      void persistBoardAutoProvider(providerId).catch((error) => {
        console.error("[kanban] Failed to persist board auto provider:", error);
      });
    }
  }, [acp, board?.autoProviderId, persistBoardAutoProvider]);

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
        provider: boardAutoProviderId,
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
    boardAutoProviderId,
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
    if (!hasGitHubCodebase) {
      setGitHubAccessAvailable(false);
      setGitHubAccessSource("none");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const searchParams = new URLSearchParams();
        if (selectedBoardId) {
          searchParams.set("boardId", selectedBoardId);
        }
        const response = await desktopAwareFetch(
          `/api/github/access${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;

        const available = response.ok && payload?.available === true;
        const source = payload?.source === "board" || payload?.source === "env" || payload?.source === "gh"
          ? payload.source
          : "none";
        setGitHubAccessAvailable(available);
        setGitHubAccessSource(available ? source : "none");
      } catch {
        if (cancelled) return;
        setGitHubAccessAvailable(false);
        setGitHubAccessSource("none");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasGitHubCodebase, selectedBoardId]);

  useEffect(() => {
    setLocalBoards(boards);
  }, [boards]);

  useEffect(() => {
    const urlState = getKanbanUrlState();
    const candidateBoardId = urlState?.boardId;
    if (candidateBoardId && localBoards.some((board) => board.id === candidateBoardId)) {
      setSelectedBoardId(candidateBoardId);
      return;
    }

    setSelectedBoardId(defaultBoardId);
    if (defaultBoardId) {
      updateKanbanUrlState({
        boardId: defaultBoardId,
        taskId: urlState?.taskId ?? null,
      }, "replace");
    }
  }, [defaultBoardId, localBoards]);

  const patchTask = useCallback(async (taskId: string, payload: Record<string, unknown>) => {
    const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new TaskPatchError(data.error ?? "Failed to update task", {
        storyReadiness: data.storyReadiness,
        missingTaskFields: Array.isArray(data.missingTaskFields)
          ? data.missingTaskFields.filter((item: unknown): item is string => typeof item === "string")
          : undefined,
      });
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

  const fileChangesSummary = useMemo(() => {
    return getKanbanFileChangesSummary(repoChanges);
  }, [repoChanges]);

  const selectedProviderInfo = useMemo(() => {
    return acp?.providers?.find((p) => p.id === acp.selectedProvider) ?? null;
  }, [acp]);
  const runtimeFitness = useRuntimeFitnessStatus({
    workspaceId,
    codebaseId: defaultCodebase?.id ?? null,
    enabled: workspaceId !== "__placeholder__",
    refreshSignal,
    isPageVisible,
  });

  // Sync task's assignedProvider to ACP state when activeTaskId changes
  useEffect(() => {
    if (!activeTaskId) return;
    const task = localTasks.find((t) => t.id === activeTaskId);
    const effectiveAutomation = task
      ? resolveEffectiveTaskAutomation(task, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : null;
    if (task?.assignedProvider && effectiveAutomation?.source === "card" && acp?.setProvider) {
      acp.setProvider(task.assignedProvider);
    }
    // Only trigger when activeTaskId changes, not when acp changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  useEffect(() => {
    if (!board?.id || !acp?.setProvider) return;
    if (activeTaskEffectiveAutomation?.source === "card") return;
    if (board.autoProviderId && acp.selectedProvider !== board.autoProviderId) {
      acp.setProvider(board.autoProviderId);
    }
  }, [acp, activeTaskEffectiveAutomation?.source, board?.autoProviderId, board?.id]);

  useEffect(() => {
    if (!activeTask) {
      previousPreferredTaskSessionIdRef.current = null;
      userManuallySelectedSessionRef.current = false;
      return;
    }
    if (!preferredActiveTaskSessionId) {
      previousPreferredTaskSessionIdRef.current = null;
      return;
    }
    // If user manually selected a session, don't auto-switch to preferred
    if (userManuallySelectedSessionRef.current) return;
    const previousPreferredTaskSessionId = previousPreferredTaskSessionIdRef.current;
    setActiveSessionId((current) => {
      if (!current) return preferredActiveTaskSessionId;
      if (!taskOwnsSession(activeTask, current)) return preferredActiveTaskSessionId;
      if (current === preferredActiveTaskSessionId) return current;
      if (previousPreferredTaskSessionId && current === previousPreferredTaskSessionId) {
        return preferredActiveTaskSessionId;
      }
      return current;
    });
    previousPreferredTaskSessionIdRef.current = preferredActiveTaskSessionId;
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
        const response = await desktopAwareFetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, {
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
    if (!activeTask || !activeSessionId || !acp) return;
    if (!canSelectTaskSessionInAcp(activeTask, activeSessionId, sessionMap)) return;
    if (acp.sessionId === activeSessionId) return;
    acp.selectSession(activeSessionId);
  }, [acp, activeSessionId, activeTask, sessionMap]);

  useEffect(() => {
    if (!activeTask) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (activeSessionId || preferredActiveTaskSessionId) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (!resolveEffectiveTaskAutomation(
      activeTask,
      board?.columns ?? [],
      resolveSpecialist,
      { autoProviderId: boardAutoProviderId },
    ).canRun || activeTask.columnId === "done") {
      emptySessionRecoveryRef.current = null;
      return;
    }

    const recoveryKey = `${activeTask.id}:${activeTask.columnId ?? "backlog"}`;
    if (emptySessionRecoveryRef.current === recoveryKey) {
      return;
    }

    emptySessionRecoveryRef.current = recoveryKey;
    return scheduleKanbanRefreshBurst(onRefresh);
  }, [activeSessionId, activeTask, board?.columns, boardAutoProviderId, onRefresh, preferredActiveTaskSessionId, resolveSpecialist]);

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
      .filter((task) => task.creationSource !== "session")
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
      provider ?? boardAutoProviderId,
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
      undefined,
      undefined,
      true,
    );

    if (!result?.sessionId) {
      return null;
    }

    openAgentPanel(result.sessionId);
    return result.sessionId;
  }, [acp, agentSessionId, boardAutoProviderId, defaultCodebase?.repoPath, openAgentPanel, workspaceId]);

  const ensureBoardAutoProviderPersisted = useCallback(async () => {
    if (!board?.id || !boardAutoProviderId || board.autoProviderId === boardAutoProviderId) {
      return;
    }
    await persistBoardAutoProvider(boardAutoProviderId);
  }, [board?.autoProviderId, board?.id, boardAutoProviderId, persistBoardAutoProvider]);

  const syncTaskDetailFromUrl = useCallback(() => {
    const urlState = getKanbanUrlState();
    const requestedBoardId = urlState?.boardId;
    const requestedTaskId = urlState?.taskId;
    if (requestedBoardId && localBoards.some((board) => board.id === requestedBoardId)) {
      setSelectedBoardId(requestedBoardId);
    }

    if (!requestedTaskId) {
      setActiveTaskId(null);
      setActiveSessionId(null);
      setIsTaskDetailFullscreen(false);
      return;
    }

    const requestedTask = localTasks.find((task) => task.id === requestedTaskId) ?? null;
    if (!requestedTask) {
      if (localTasks.length > 0) {
        updateKanbanUrlState({
          boardId: requestedBoardId ?? selectedBoardId ?? defaultBoardId ?? null,
          taskId: null,
        }, "replace");
      }
      return;
    }

    if (requestedBoardId !== requestedTask.boardId) {
      updateKanbanUrlState({
        boardId: requestedTask.boardId ?? selectedBoardId ?? defaultBoardId ?? null,
        taskId: requestedTask.id,
      }, "replace");
    }

    if (requestedTask.boardId) {
      setSelectedBoardId(requestedTask.boardId);
    }
    setActiveTaskId(requestedTask.id);
    setActiveSessionId(getPreferredTaskSessionId(requestedTask) ?? null);
    setIsTaskDetailFullscreen(false);
  }, [defaultBoardId, localBoards, localTasks, selectedBoardId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    syncTaskDetailFromUrl();
    window.addEventListener("popstate", syncTaskDetailFromUrl);
    return () => window.removeEventListener("popstate", syncTaskDetailFromUrl);
  }, [syncTaskDetailFromUrl]);

  const openTaskDetail = useCallback(async (task: TaskInfo) => {
    if (task.boardId) {
      setSelectedBoardId(task.boardId);
    }
    setActiveTaskId(task.id);
    const latestSession = getPreferredTaskSessionId(task);
    setActiveSessionId(latestSession ?? null);
    setIsTaskDetailFullscreen(false);
    updateKanbanUrlState({
      boardId: task.boardId ?? selectedBoardId ?? defaultBoardId ?? null,
      taskId: task.id,
    }, "push");

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
  }, [acp, defaultBoardId, defaultCodebase, patchTask, selectedBoardId, sessionMap]);

  const openSession = useCallback((sessionId: string | null, task?: TaskInfo | null) => {
    setActiveTaskId(null);
    setActiveSessionId(sessionId);
    setIsTaskDetailFullscreen(false);
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
    setIsTaskDetailFullscreen(false);
    updateKanbanUrlState({
      boardId: selectedBoardId ?? defaultBoardId ?? null,
      taskId: null,
    }, "replace");
  }, [defaultBoardId, selectedBoardId]);

  const handleSelectBoard = useCallback((boardId: string) => {
    setSelectedBoardId(boardId);

    const nextActiveTaskId = activeTask?.boardId === boardId ? activeTask.id : null;
    if (!nextActiveTaskId) {
      setActiveTaskId(null);
      setActiveSessionId(null);
      setIsTaskDetailFullscreen(false);
    }

    updateKanbanUrlState({
      boardId,
      taskId: nextActiveTaskId,
    }, "push");
  }, [activeTask]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const updatePageVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    updatePageVisibility();
    document.addEventListener("visibilitychange", updatePageVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updatePageVisibility);
    };
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
    if (!isPageVisible) return;

    const activeIdSet = new Set(activeLiveSessionIds);
    let disposed = false;
    let inFlight = false;

    const pollLiveSessionTail = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (disposed || inFlight) return;
      inFlight = true;

      const updates = await Promise.all(activeLiveSessionIds.map(async (sessionId) => {
        try {
          const response = await desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}/history?consolidated=true`,
            { cache: "no-store" },
          );
          if (!response.ok) return [sessionId, null] as const;
          const payload = await response.json();
          return [sessionId, extractSessionLiveTail(payload?.history)] as const;
        } catch {
          return [sessionId, null] as const;
        }
      })).finally(() => {
        inFlight = false;
      });

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
  }, [activeLiveSessionIds, isPageVisible]);

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
      const res = await desktopAwareFetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
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
      const res = await desktopAwareFetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: selectedCodebase.sourceUrl, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to re-clone repository");

      // Update the codebase with the new path if it changed
      if (data.path && data.path !== selectedCodebase.repoPath) {
        await desktopAwareFetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
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
        const res = await desktopAwareFetch(`/api/codebases/${encodeURIComponent(cb.id)}`, {
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
      const res = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(selectedCodebase.id)}`,
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
    if (!activeTaskId && !activeSessionId && !showSettings && !showCodebaseModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeTaskId || activeSessionId) {
          closeTaskDetail();
        } else if (showSettings) {
          setShowSettings(false);
        } else if (showCodebaseModal) {
          setShowCodebaseModal(false);
          setSelectedCodebase(null);
          setCodebaseWorktrees([]);
          setEditingCodebase(false);
          setLiveBranchInfo(null);
          setBranchActionError(null);
          setDeletingBranchNames([]);
          setRecloneError(null);
          setRecloneSuccess(null);
          setAddRepoSelection(null);
          setAddError(null);
          setShowDeleteCodebaseConfirm(false);
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeTaskId, activeSessionId, showSettings, showCodebaseModal, closeTaskDetail]);

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
            const res = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(id)}`, { cache: "no-store" });
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

  const fetchCodebaseWorktrees = useCallback(async (codebase: CodebaseData) => {
    // Reset live branch info
    setLiveBranchInfo(null);
    setBranchActionError(null);

    try {
      const res = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(codebase.id)}/worktrees`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setCodebaseWorktrees(Array.isArray(data.worktrees) ? data.worktrees as WorktreeInfo[] : []);
      }
    } catch { /* ignore */ }

    // Fetch live branch info from the repo
    try {
      const branchRes = await desktopAwareFetch(`/api/clone/branches?repoPath=${encodeURIComponent(codebase.repoPath)}`, { cache: "no-store" });
      if (branchRes.ok) {
        const branchData = await branchRes.json();
        setLiveBranchInfo({ current: branchData.current, branches: branchData.local || [] });
      }
    } catch { /* ignore */ }
  }, [workspaceId]);

  const selectCodebase = useCallback(async (codebase: CodebaseData | null) => {
    setSelectedCodebase(codebase);
    setCodebaseWorktrees([]);
    setLiveBranchInfo(null);
    setBranchActionError(null);
    setWorktreeActionError(null);
    setDeletingBranchNames([]);
    setDeletingWorktreeIds([]);
    setEditingCodebase(false);
    setEditError(null);
    setEditRepoSelection(null);
    setRecloneError(null);
    setRecloneSuccess(null);
    setShowDeleteCodebaseConfirm(false);

    if (codebase) {
      await fetchCodebaseWorktrees(codebase);
    }
  }, [fetchCodebaseWorktrees]);

  const closeCodebaseModal = useCallback(() => {
    setShowCodebaseModal(false);
    setSelectedCodebase(null);
    setCodebaseWorktrees([]);
    setEditingCodebase(false);
    setLiveBranchInfo(null);
    setBranchActionError(null);
    setDeletingBranchNames([]);
    setRecloneError(null);
    setRecloneSuccess(null);
    setAddRepoSelection(null);
    setAddError(null);
    setShowDeleteCodebaseConfirm(false);
  }, []);

  const openCodebaseModal = useCallback(() => {
    setShowCodebaseModal(true);
    const nextCodebase = selectedCodebase ?? defaultCodebase ?? codebases[0] ?? null;
    if (nextCodebase) {
      void selectCodebase(nextCodebase);
    }
  }, [codebases, defaultCodebase, selectedCodebase, selectCodebase]);

  const handleAddCodebase = useCallback(async (selection: RepoSelection | null) => {
    if (!selection) return;
    setAddRepoSelection(selection);
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: selection.path, branch: selection.branch, label: selection.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
      onRefresh();
      const nextCodebase = data.codebase as CodebaseData | undefined;
      if (nextCodebase) {
        await selectCodebase(nextCodebase);
      }
      setAddRepoSelection(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add repository");
    } finally {
      setAddSaving(false);
    }
  }, [onRefresh, selectCodebase, workspaceId]);

  useEffect(() => {
    if (!showCodebaseModal) return;
    if (selectedCodebase && codebases.some((codebase) => codebase.id === selectedCodebase.id)) return;
    const nextCodebase = defaultCodebase ?? codebases[0] ?? null;
    if (nextCodebase) {
      void selectCodebase(nextCodebase);
    } else {
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      setLiveBranchInfo(null);
    }
  }, [codebases, defaultCodebase, selectedCodebase, selectCodebase, showCodebaseModal]);

  const deleteIssueBranches = useCallback(async (branches: string[]) => {
    if (!selectedCodebase || branches.length === 0) return;

    const uniqueBranches = [...new Set(branches)];
    setBranchActionError(null);
    setDeletingBranchNames((current) => [...new Set([...current, ...uniqueBranches])]);

    let latestBranchInfo: { current: string; branches: string[] } | null = null;
    const failures: string[] = [];
    try {
      for (const branch of uniqueBranches) {
        const response = await desktopAwareFetch("/api/clone/branches", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoPath: selectedCodebase.repoPath,
            branch,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !(data as { success?: boolean }).success) {
          failures.push((data as { error?: string }).error ?? `Failed to delete branch '${branch}'`);
          continue;
        }

        const nextCurrentBranch: string = latestBranchInfo?.current ?? liveBranchInfo?.current ?? selectedCodebase.branch ?? "";
        const nextBranches: string[] = latestBranchInfo?.branches ?? liveBranchInfo?.branches ?? [];
        latestBranchInfo = {
          current: typeof (data as { current?: string }).current === "string"
            ? (data as { current: string }).current
            : nextCurrentBranch,
          branches: Array.isArray((data as { branches?: unknown[] }).branches)
            ? (data as { branches: string[] }).branches
            : nextBranches,
        };
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Failed to delete branches");
    } finally {
      setDeletingBranchNames((current) => current.filter((name) => !uniqueBranches.includes(name)));
    }

    if (latestBranchInfo) {
      setLiveBranchInfo(latestBranchInfo);
    }
    if (failures.length > 0) {
      setBranchActionError(
        t.kanbanModals.removeBranchesFailed
          .replace("{count}", String(failures.length))
          .replace("{branches}", failures.join("; ")),
      );
    }
  }, [liveBranchInfo, selectedCodebase, t.kanbanModals.removeBranchesFailed]);

  const handleDeleteIssueBranch = useCallback(async (branch: string) => {
    const confirmed = window.confirm(
      t.kanbanModals.removeBranchConfirm.replace("{branch}", branch),
    );
    if (!confirmed) return;

    await deleteIssueBranches([branch]);
  }, [deleteIssueBranches, t.kanbanModals.removeBranchConfirm]);

  const handleDeleteIssueBranches = useCallback(async (branches: string[]) => {
    if (branches.length === 0) return;

    const confirmed = window.confirm(
      t.kanbanModals.clearIssueBranchesConfirm.replace("{count}", String(branches.length)),
    );
    if (!confirmed) return;

    await deleteIssueBranches(branches);
  }, [deleteIssueBranches, t.kanbanModals.clearIssueBranchesConfirm]);

  const handleDeleteCodebaseWorktrees = useCallback(async (worktrees: WorktreeInfo[]) => {
    if (worktrees.length === 0) return;

    const ids = [...new Set(worktrees.map((worktree) => worktree.id))];
    const worktreeIdSet = new Set(ids);
    setWorktreeActionError(null);
    setDeletingWorktreeIds(ids);
    try {
      for (const worktree of worktrees) {
        const linkedTasks = localTasks.filter((task) => task.worktreeId === worktree.id);
        await Promise.all(linkedTasks.map((task) => patchTask(task.id, { worktreeId: null })));

        const response = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(worktree.id)}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((data as { error?: string }).error ?? "Failed to delete worktree");
        }
      }

      setLocalTasks((current) => current.map((task) => (
        task.worktreeId && worktreeIdSet.has(task.worktreeId)
          ? { ...task, worktreeId: undefined }
          : task
      )));
      setCodebaseWorktrees((current) => current.filter((item) => !worktreeIdSet.has(item.id)));
      setWorktreeCache((current) => {
        const next = { ...current };
        for (const id of ids) {
          delete next[id];
        }
        return next;
      });
    } catch (error) {
      setWorktreeActionError(error instanceof Error ? error.message : "Failed to delete worktree");
    } finally {
      setDeletingWorktreeIds([]);
    }
  }, [localTasks, patchTask]);

  async function createTaskCard() {
    await ensureBoardAutoProviderPersisted();
    const effectiveCodebaseIds = draft.codebaseIds.length > 0 ? draft.codebaseIds : allCodebaseIds;
    const response = await desktopAwareFetch("/api/tasks", {
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
    mergeAsSingleCard: boolean,
  ) {
    await ensureBoardAutoProviderPersisted();
    const importedTasks = await importGitHubItems({
      workspaceId,
      boardId: selectedBoardId ?? defaultBoardId,
      codebaseId,
      items: issues,
      mergeAsSingleCard,
      mergedTitle: t.kanbanImport.mergedIssuesTitle,
      mergedObjectiveLabels: { heading: t.kanbanImport.mergedSourceListHeading, summary: t.kanbanImport.mergedSummaryLabel },
      mergeFallbackMessage: t.kanbanImport.importFailed,
      createItemPayload: (issue) => ({
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
      createItemFallbackMessage: (issue) => `Failed to import GitHub issue #${issue.number}`,
    });

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

  async function importGitHubPulls(
    codebaseId: string,
    pulls: GitHubPRListItemInfo[],
    repo: string,
    mergeAsSingleCard: boolean,
  ) {
    await ensureBoardAutoProviderPersisted();
    const importedTasks = await importGitHubItems({
      workspaceId,
      boardId: selectedBoardId ?? defaultBoardId,
      codebaseId,
      items: pulls,
      mergeAsSingleCard,
      mergedTitle: t.kanbanImport.mergedPullsTitle,
      mergedObjectiveLabels: { heading: t.kanbanImport.mergedSourceListHeading, summary: t.kanbanImport.mergedSummaryLabel },
      mergeFallbackMessage: t.kanbanImport.importPullsFailed,
      createItemPayload: (pull) => ({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId,
        columnId: "backlog",
        title: pull.title,
        objective: pull.body?.trim() || pull.title,
        labels: pull.labels,
        codebaseIds: [codebaseId],
        githubId: pull.id,
        githubNumber: pull.number,
        githubUrl: pull.url,
        githubRepo: repo,
        githubState: pull.state,
        isPullRequest: true,
      }),
      createItemFallbackMessage: (pull) => `Failed to import GitHub pull request #${pull.number}`,
    });

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
    await ensureBoardAutoProviderPersisted();
    const task = localTasks.find((item) => item.id === taskId);
    const effectiveAutomation = task
      ? resolveEffectiveTaskAutomation(task, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : undefined;
    const retryProviderId = task
      && effectiveAutomation?.source !== "card"
      && effectiveAutomation?.transport !== "a2a"
      && effectiveAutomation?.providerSource === "auto"
      && boardAutoProviderId
      ? boardAutoProviderId
      : undefined;
    const updated = await patchTask(taskId, {
      retryTrigger: true,
      ...(retryProviderId ? { retryProviderId } : {}),
    });
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

  async function runTaskPullRequest(taskId: string): Promise<string | null> {
    await ensureBoardAutoProviderPersisted();
    const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}/pr-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specialistLocale: specialistLanguage }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to start PR session");
    }
    const sessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
    if (sessionId) {
      setActiveSessionId(sessionId);
      acp?.selectSession(sessionId);
      onRefresh();
    }
    return sessionId;
  }

  function confirmDeleteTask(task: TaskInfo) {
    setIsDeleting(false);
    setDeleteConfirmTask(task);
  }

  async function executeDeleteTask() {
    if (!deleteConfirmTask) return;

    setIsDeleting(true);
    try {
      const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(deleteConfirmTask.id)}`, {
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
    await ensureBoardAutoProviderPersisted();
    setMoveError(null);
    setMoveBlockedState(null);

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
        const response = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(movingTask.worktreeId)}`, {
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
      const message = error instanceof Error ? error.message : "Failed to move task";
      if (message.startsWith("Cannot move ")) {
        setMoveBlockedState({
          message,
          taskId,
          targetColumnId,
          storyReadiness: error instanceof TaskPatchError ? error.storyReadiness : undefined,
          missingTaskFields: error instanceof TaskPatchError ? error.missingTaskFields : undefined,
        });
        setMoveError(null);
      } else {
        setMoveError(message);
      }
      setLocalTasks(tasks);
    }
  }

  async function _createBoard() {
    const name = window.prompt(t.kanban.boardName);
    if (!name?.trim()) return;
    const response = await desktopAwareFetch("/api/kanban/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, name: name.trim() }),
    });
    if (response.ok) {
      onRefresh();
    }
  }

  const kanbanTabHeaderProps = {
    tasksCount: tasks.length,
    board,
    boardQueue,
    boards: visibleBoards,
    selectedBoardId,
    onSelectBoard: handleSelectBoard,
    githubImportVisible: hasGitHubCodebase && githubAccessAvailable,
    onOpenGitHubImport: () => setShowGitHubImportModal(true),
    onRefresh,
    onOpenSettings: board ? () => setShowSettings(true) : undefined,
  };

  const kanbanTabHeaderActionProps = {
    board,
    onAgentPrompt,
    availableProviders,
    selectedProviderId: resolveKanbanBoardAutoProviderId(board, acp?.selectedProvider) ?? "",
    onBoardProviderChange: setKanbanBoardProvider,
    disableBoardProvider: !acp?.connected || availableProviders.length === 0,
    kanbanTaskAgentCopy,
    agentInput,
    onAgentInputChange: setAgentInput,
    onAgentSubmit: () => {
      void handleAgentSubmit();
    },
    showCreateTaskModal: () => setShowCreateModal(true),
    agentLoading,
    agentSessionId,
    openAgentPanel,
  };

  const settingsModalProps: KanbanSettingsModalProps | undefined = board ? {
    board,
    columnAutomation,
    availableProviders,
    specialists,
    specialistLanguage,
    githubImportAvailable: hasGitHubCodebase && githubAccessAvailable,
    githubAccessSource,
    onClose: () => setShowSettings(false),
    onClearAll: async () => {
      const response = await desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
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
    },
    onSave: async (
      newColumns: KanbanBoardInfo["columns"],
      newColumnAutomation: Record<string, ColumnAutomationConfig>,
      sessionConcurrencyLimit: number,
      devSessionSupervision: KanbanDevSessionSupervisionInfo,
      githubTokenUpdate?: { token?: string; clear?: boolean },
      branchRules?: KanbanBoardInfo["branchRules"],
    ) => {
      const updatedColumns = newColumns.map((col) => ({
        ...col,
        automation: newColumnAutomation[col.id]?.enabled
          ? normalizeKanbanAutomation(newColumnAutomation[col.id])
          : undefined,
      }));

      const response = await desktopAwareFetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: updatedColumns,
          sessionConcurrencyLimit,
          devSessionSupervision,
          ...(branchRules ? { branchRules } : {}),
          ...(githubTokenUpdate?.token ? { githubToken: githubTokenUpdate.token } : {}),
          ...(githubTokenUpdate?.clear ? { clearGitHubToken: true } : {}),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to save settings");
      }

      const data = await response.json();
      const updatedBoard = data.board as KanbanBoardInfo | undefined;
      if (updatedBoard) {
        setLocalBoards((current) => current.map((item) => (
          item.id === updatedBoard.id ? updatedBoard : item
        )));
      }

      setVisibleColumns(updatedColumns.filter((col) => col.visible !== false).map((col) => col.id));
      setColumnAutomation(newColumnAutomation);
      setShowSettings(false);
      onRefresh();
    },
  } : undefined;

  const boardSurfaceProps = board ? {
    moveError,
    onDismissMoveError: () => setMoveError(null),
    codebases,
    workspaceId,
    defaultCodebase,
    repoSync,
    setSelectedCodebase,
    fetchCodebaseWorktrees,
    onRefresh,
    repoChanges,
    repoChangesLoading,
    availableProviders,
    acp,
    boardAutoProviderId,
    kanbanTaskAgentCopy,
    agentSessionId,
    openAgentPanel,
    agentPanelOpen,
    board,
    visibleColumns,
    boardTasks,
    columnAutomation,
    providers,
    specialists,
    specialistLanguage,
    sessionMap,
    liveSessionTails,
    allCodebaseIds,
    worktreeCache,
    queuedPositions,
    moveTask,
    confirmDeleteTask,
    patchTask,
    retryTaskTrigger,
    runTaskPullRequest,
    openTaskDetail,
    agentSession,
    onCloseAgentPanel: () => setAgentPanelOpen(false),
    ensureKanbanAgentSession,
    kanbanRepoSelection,
    fileChangesOpen,
    setFileChangesOpen,
    gitLogOpen,
    setGitLogOpen,
  } : undefined;

  const taskDetailOverlayProps = board ? {
    activeSessionId,
    activeTaskId,
    activeTask,
    board,
    resolveSpecialist,
    acp,
    boardAutoProviderId,
    onBoardProviderChange: setKanbanBoardProvider,
    detailSplitContainerRef,
    detailSplitRatio,
    setIsDraggingDetailSplit,
    refreshSignal,
    availableProviders,
    specialists,
    specialistLanguage,
    codebases,
    allCodebaseIds,
    worktreeCache,
    combinedSessions,
    patchTask,
    retryTaskTrigger,
    runTaskPullRequest,
    confirmDeleteTask,
    onRefresh,
    setActiveSessionId: (id: string | null) => {
      setActiveSessionId(id);
      if (id) userManuallySelectedSessionRef.current = true;
    },
    sessionMap,
    workspaceId,
    isTaskDetailFullscreen,
    onToggleTaskDetailFullscreen: setIsTaskDetailFullscreen,
    closeTaskDetail,
  } : undefined;

  const createTaskModalProps = {
    showCreateModal,
    draft,
    setDraft,
    onClose: () => setShowCreateModal(false),
    onCreate: () => {
      void createTaskCard();
    },
    githubAvailable,
    codebases,
    allCodebaseIds,
  };

  const githubImportModalProps = {
    show: showGitHubImportModal,
    workspaceId,
    boardId: board?.id,
    codebases,
    tasks: localTasks,
    onClose: () => setShowGitHubImportModal(false),
    onImport: importGitHubIssues,
    onImportPulls: importGitHubPulls,
  };

  const codebaseModalProps = {
    key: showCodebaseModal ? (selectedCodebase?.id ?? "workspace-repos-open") : "workspace-repos-closed",
    open: showCodebaseModal,
    selectedCodebase,
    editingCodebase,
    codebases,
    addRepoSelection,
    setAddRepoSelection,
    addSaving,
    addError,
    onAddRepository: handleAddCodebase,
    editRepoSelection,
    onRepoSelectionChange: handleRepoSelectionChange,
    editError,
    recloneError,
    editSaving,
    replacingAll,
    setShowReplaceAllConfirm,
    handleCancelEditCodebase,
    codebaseWorktrees,
    worktreeActionError,
    localTasks,
    handleDeleteCodebaseWorktrees,
    deletingWorktreeIds,
    liveBranchInfo,
    branchActionError,
    repoHealth,
    onSelectCodebase: (codebase: CodebaseData) => {
      void selectCodebase(codebase);
    },
    handleDeleteIssueBranch,
    handleDeleteIssueBranches,
    deletingBranchNames,
    handleReclone,
    recloning,
    recloneSuccess,
    onStartEditCodebase: handleStartEditCodebase,
    onRequestRemoveCodebase: () => setShowDeleteCodebaseConfirm(true),
    onClose: closeCodebaseModal,
  };

  const deleteCodebaseModalProps = {
    show: showDeleteCodebaseConfirm,
    selectedCodebase,
    editError,
    deletingCodebase,
    onCancel: () => setShowDeleteCodebaseConfirm(false),
    onConfirm: handleRemoveCodebase,
  };

  const replaceAllReposModalProps = {
    show: showReplaceAllConfirm,
    editRepoSelection,
    codebasesCount: codebases.length,
    recloneError,
    replacingAll,
    onCancel: () => setShowReplaceAllConfirm(false),
    onConfirm: handleReplaceAllRepos,
  };

  const deleteTaskModalProps = {
    deleteConfirmTask,
    isDeleting,
    onCancel: cancelDeleteTask,
    onConfirm: executeDeleteTask,
  };

  const blockedTask = moveBlockedState
    ? localTasks.find((task) => task.id === moveBlockedState.taskId)
      ?? tasks.find((task) => task.id === moveBlockedState.taskId)
      ?? null
    : null;
  const moveBlockedModalProps = {
    blocked: moveBlockedState,
    onClose: () => setMoveBlockedState(null),
    onOpenCard: blockedTask ? () => {
      void openTaskDetail(blockedTask);
      setMoveBlockedState(null);
    } : undefined,
  };

  const statusBarProps = {
    defaultCodebase,
    codebases,
    fileChangesSummary,
    board,
    boardQueue,
    repoHealth,
    selectedProvider: selectedProviderInfo,
    onRepoClick: openCodebaseModal,
    onFileChangesClick: () => setFileChangesOpen((prev) => !prev),
    onGitLogClick: () => setGitLogOpen((prev) => !prev),
    onProviderClick: () => {
      // Could open provider settings or do nothing
    },
    onFitnessClick: () => {
      setShowFitnessWorkbench(true);
    },
    fileChangesOpen,
    gitLogOpen,
    repoSync,
    runtimeFitness: runtimeFitness.data,
    runtimeFitnessLoading: runtimeFitness.loading,
    runtimeFitnessError: runtimeFitness.error,
  };

  const fitnessWorkbenchModalProps = {
    open: showFitnessWorkbench,
    workspaceId,
    codebase: defaultCodebase,
    runtimeFitness: runtimeFitness.data,
    sessionId: fitnessWorkbenchSessionId,
    onSessionIdChange: setFitnessWorkbenchSessionId,
    onClose: () => setShowFitnessWorkbench(false),
  };

  return (
    <KanbanTabContent
      headerProps={kanbanTabHeaderProps}
      headerActionProps={kanbanTabHeaderActionProps}
      boardSurfaceProps={boardSurfaceProps}
      createTaskModalProps={createTaskModalProps}
      githubImportModalProps={githubImportModalProps}
      taskDetailOverlayProps={taskDetailOverlayProps}
      showSettingsModal={showSettings}
      settingsModalProps={settingsModalProps}
      codebaseModalProps={codebaseModalProps}
      deleteCodebaseModalProps={deleteCodebaseModalProps}
      replaceAllReposModalProps={replaceAllReposModalProps}
      deleteTaskModalProps={deleteTaskModalProps}
      moveBlockedModalProps={moveBlockedModalProps}
      statusBarProps={statusBarProps}
      fitnessWorkbenchModalProps={fitnessWorkbenchModalProps}
    />
  );
}
