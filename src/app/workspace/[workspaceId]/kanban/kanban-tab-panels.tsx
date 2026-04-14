import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState, type Dispatch, type SetStateAction, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "@/client/components/chat-panel";
import type { RepoSelection } from "@/client/components/repo-picker";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import { KanbanCard, KanbanCardOverlay } from "./kanban-card";
import { KanbanCardActivityBar, KanbanCardDetail } from "./kanban-card-detail";
import { getKanbanFileChangesSummary as _getKanbanFileChangesSummary } from "./kanban-file-changes-panel";
import { KanbanEnhancedFileChangesPanel } from "./components/kanban-enhanced-file-changes-panel";
import type { KanbanTaskAgentCopy } from "./i18n/kanban-task-agent";
import { KanbanCreateModal, type TaskDraft } from "../kanban-create-modal";
import { KanbanCardActivityPanel, KanbanEmptySessionPane } from "./kanban-card-activity";
import { formatSessionTimestamp } from "./kanban-card-session-utils";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { RepoSyncState } from "./kanban-repo-sync-status";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import {
  canSelectTaskSessionInAcp,
  formatLaneAutomationCompactLabel,
  formatLaneAutomationSummary,
  getTaskLaneSession,
  isA2ATaskSession,
  resolveKanbanBoardAutoProviderId,
} from "./kanban-tab-helpers";
import type { ColumnAutomationConfig } from "./kanban-settings-modal";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import type { KanbanRepoChanges } from "./kanban-file-changes-types";
import { ChevronRight as _ChevronRight, GitBranch as _GitBranch } from "lucide-react";
import { GitLogPanel, RealGitAdapter, MockGitAdapter } from "./git-log";

interface SessionRestoreTranscriptMessage {
  role?: string;
  content?: string;
  toolName?: string;
  toolStatus?: string;
}

const KANBAN_RESTORE_CONTEXT_MESSAGE_LIMIT = 4;
const KANBAN_RESTORE_CONTEXT_CHAR_LIMIT = 1800;
const KANBAN_RESTORE_MESSAGE_CHAR_LIMIT = 700;

function isRecoverableAcpSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return message.includes("embedded ACP processes cannot be resumed on a different instance")
    || message.includes("session/load not supported");
}

function normalizeRestoreContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoisyRestoreContent(content: string): boolean {
  const lines = content.split("\n");
  if (lines.length > 18) return true;
  if (content.length > 1200) return true;
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(INFO|WARN|ERROR)\s/.test(content)
    || /\b(test result:|Running tests\/|Doc-tests|SQLite database opened at:)\b/.test(content);
}

function truncateRestoreContent(content: string): string {
  if (content.length <= KANBAN_RESTORE_MESSAGE_CHAR_LIMIT) return content;
  return `${content.slice(0, KANBAN_RESTORE_MESSAGE_CHAR_LIMIT).trimEnd()}\n[truncated]`;
}

function formatRestoreTranscriptLine(message: SessionRestoreTranscriptMessage): string | null {
  if (!["user", "assistant", "plan", "info"].includes(message.role ?? "")) return null;

  const content = normalizeRestoreContent(message.content ?? "");
  if (!content) return null;
  if (isNoisyRestoreContent(content)) return null;

  const excerpt = truncateRestoreContent(content);

  switch (message.role) {
    case "user":
      return `User: ${excerpt}`;
    case "assistant":
      return `Assistant: ${excerpt}`;
    case "plan":
      return `Plan: ${excerpt}`;
    case "info":
      return `Info: ${excerpt}`;
    default:
      return null;
  }
}

export function buildKanbanSessionRestorePrompt(
  task: TaskInfo | null,
  session: SessionInfo,
  messages: SessionRestoreTranscriptMessage[],
): string {
  const recent = messages
    .filter((message) => message.role !== "thought")
    .map(formatRestoreTranscriptLine)
    .filter((value): value is string => Boolean(value))
    .slice(-KANBAN_RESTORE_CONTEXT_MESSAGE_LIMIT);

  let transcript = recent.join("\n\n");
  if (transcript.length > KANBAN_RESTORE_CONTEXT_CHAR_LIMIT) {
    transcript = transcript.slice(transcript.length - KANBAN_RESTORE_CONTEXT_CHAR_LIMIT).trimStart();
  }

  const taskContext = task
    ? [
        `- Card: ${task.title}`,
        task.objective ? `- Objective: ${task.objective}` : null,
        task.columnId ? `- Column: ${task.columnId}` : null,
        task.status ? `- Status: ${task.status}` : null,
      ].filter(Boolean).join("\n")
    : "- Card: unknown";

  return [
    "Continue the previous Routa Kanban card session. Do not summarize the transcript; continue the card work directly.",
    "",
    "Card context:",
    taskContext,
    "",
    "Session context:",
    `- Previous session: ${session.sessionId}`,
    session.cwd ? `- Working directory: ${session.cwd}` : null,
    session.branch ? `- Branch: ${session.branch}` : null,
    transcript ? "" : null,
    transcript ? "Recent clean conversation:" : null,
    transcript || null,
    "",
    "Next: inspect the repo if needed, then proceed with the smallest next action for this card.",
  ].filter(Boolean).join("\n");
}

async function fetchSessionTranscriptForRestore(sessionId: string): Promise<SessionRestoreTranscriptMessage[]> {
  const response = await desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`, { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null) as { messages?: unknown } | null;
  return Array.isArray(data?.messages) ? data.messages as SessionRestoreTranscriptMessage[] : [];
}

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

function KanbanDropColumn({
  children,
  columnId,
  hasActiveDrag,
  widthClass,
}: {
  children: ReactNode;
  columnId: string;
  hasActiveDrag: boolean;
  widthClass: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${columnId}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-26.25 shrink-0 flex-col border bg-white p-3 transition dark:bg-[#12141c] ${widthClass} ${isOver
        ? "border-amber-300 ring-2 ring-amber-300/50 dark:border-amber-700 dark:ring-amber-700/40"
        : hasActiveDrag
          ? "border-slate-300/80 dark:border-[#2a2f43]"
          : "border-slate-200/70 dark:border-[#1c1f2e]"
        }`}
      data-testid="kanban-column"
    >
      {children}
    </div>
  );
}

export function KanbanBoardSurface({
  moveError,
  onDismissMoveError,
  codebases,
  workspaceId,
  defaultCodebase,
  repoSync: _repoSync,
  setSelectedCodebase: _setSelectedCodebase,
  fetchCodebaseWorktrees: _fetchCodebaseWorktrees,
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
  runTaskPullRequest, // eslint-disable-line @typescript-eslint/no-unused-vars -- used in KanbanTaskCard props
  openTaskDetail,
  agentSession,
  onCloseAgentPanel,
  ensureKanbanAgentSession,
  kanbanRepoSelection,
  fileChangesOpen,
  setFileChangesOpen,
  gitLogOpen,
  setGitLogOpen,
}: {
  moveError: string | null;
  onDismissMoveError: () => void;
  codebases: CodebaseData[];
  workspaceId: string;
  defaultCodebase: CodebaseData | null;
  repoSync?: RepoSyncState;
  setSelectedCodebase: Dispatch<SetStateAction<CodebaseData | null>>;
  fetchCodebaseWorktrees: (codebase: CodebaseData) => Promise<void>;
  onRefresh: () => void;
  repoChanges: KanbanRepoChanges[];
  repoChangesLoading: boolean;
  availableProviders: AcpProviderInfo[];
  acp?: UseAcpState & UseAcpActions;
  boardAutoProviderId?: string;
  kanbanTaskAgentCopy: KanbanTaskAgentCopy;
  agentSessionId: string | null;
  openAgentPanel: (sessionId: string) => void;
  agentPanelOpen: boolean;
  board: KanbanBoardInfo;
  visibleColumns: string[];
  boardTasks: TaskInfo[];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  sessionMap: Map<string, SessionInfo>;
  liveSessionTails: Record<string, string>;
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  queuedPositions: Record<string, number | undefined>;
  moveTask: (taskId: string, targetColumnId: string) => Promise<void>;
  confirmDeleteTask: (task: TaskInfo) => void;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  runTaskPullRequest: (taskId: string) => Promise<string | null>;
  openTaskDetail: (task: TaskInfo) => Promise<void>;
  agentSession?: SessionInfo;
  onCloseAgentPanel: () => void;
  ensureKanbanAgentSession: (
    cwd?: string,
    provider?: string,
    modeId?: string,
    model?: string,
  ) => Promise<string | null>;
  kanbanRepoSelection: RepoSelection | null;
  fileChangesOpen?: boolean;
  setFileChangesOpen?: Dispatch<SetStateAction<boolean>>;
  gitLogOpen?: boolean;
  setGitLogOpen?: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const [localFileChangesOpen, setLocalFileChangesOpen] = useState(false);
  const [localGitLogOpen, setLocalGitLogOpen] = useState(false);
  const [gitLogRepoPath, setGitLogRepoPath] = useState<string | null>(null);
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [activeDragCardWidth, setActiveDragCardWidth] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 3 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );

  // Use external state if provided, otherwise use local state
  const fileChangesOpenValue = fileChangesOpen ?? localFileChangesOpen;
  const setFileChangesOpenValue = setFileChangesOpen ?? setLocalFileChangesOpen;
  const gitLogOpenValue = gitLogOpen ?? localGitLogOpen;
  const _setGitLogOpenValue = setGitLogOpen ?? setLocalGitLogOpen;

  // Use RealGitAdapter when a real repo is available; fall back to MockGitAdapter for demo
  const gitAdapter = useMemo(() => {
    const hasRealRepo = codebases.length > 0;
    return hasRealRepo ? new RealGitAdapter() : new MockGitAdapter();
  }, [codebases.length]);

  const activeGitLogRepoPath = useMemo(() => {
    if (gitLogRepoPath && codebases.some((codebase) => codebase.repoPath === gitLogRepoPath)) {
      return gitLogRepoPath;
    }
    return defaultCodebase?.repoPath ?? codebases[0]?.repoPath ?? null;
  }, [codebases, defaultCodebase?.repoPath, gitLogRepoPath]);
  const activeDragTask = useMemo(
    () => activeDragTaskId ? boardTasks.find((task) => task.id === activeDragTaskId) ?? null : null,
    [activeDragTaskId, boardTasks],
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveDragTaskId(String(active.id));
    setActiveDragCardWidth(active.rect.current.initial?.width ?? null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDragTaskId(null);
    setActiveDragCardWidth(null);
    if (!over) return;

    const targetId = String(over.id);
    if (!targetId.startsWith("column:")) return;

    const taskId = String(active.id);
    const sourceColumnId = active.data.current?.columnId;
    const targetColumnId = targetId.slice("column:".length);
    if (!targetColumnId) return;
    if (sourceColumnId === targetColumnId) return;
    await moveTask(taskId, targetColumnId);
  };

  const handleDragCancel = () => {
    setActiveDragTaskId(null);
    setActiveDragCardWidth(null);
  };

  return (
    <>
      {moveError && (
        <div className="shrink-0 border border-rose-200/80 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
          <div className="flex items-start justify-between gap-3">
            <div className="leading-6">{moveError}</div>
            <button
              type="button"
              onClick={onDismissMoveError}
              className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/20"
            >
              {t.common.dismiss}
            </button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <KanbanEnhancedFileChangesPanel
            workspaceId={workspaceId}
            repos={repoChanges}
            loading={repoChangesLoading}
            open={fileChangesOpenValue}
            onClose={() => setFileChangesOpenValue(false)}
            onRefresh={onRefresh}
          />
          {gitLogOpenValue && (
            <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-slate-200 dark:border-[#1c1f2e] shadow-xl" style={{ height: "340px" }}>
              <GitLogPanel
                adapter={gitAdapter}
                repoPath={activeGitLogRepoPath ?? "/mock/repo"}
                codebases={codebases}
                onSelectRepoPath={setGitLogRepoPath}
                title={t.gitLog.title}
              />
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto pb-2" data-testid="kanban-board-content">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={(event) => {
                void handleDragEnd(event);
              }}
              onDragCancel={handleDragCancel}
            >
              <div className="flex min-h-full min-w-max items-start gap-3 pr-4">
                {board.columns
                  .slice()
                  .sort((left, right) => left.position - right.position)
                  .filter((column) => visibleColumns.includes(column.id))
                  .map((column) => {
                    const columnTasks = boardTasks.filter((task) => (task.columnId ?? "backlog") === column.id);
                    const laneAutomation = columnAutomation[column.id] ?? column.automation;
                    const widthClass = column.width === "compact" ? "w-[14rem]" : column.width === "wide" ? "w-[24rem]" : "w-[18rem]";

                    return (
                      <KanbanDropColumn
                        key={column.id}
                        columnId={column.id}
                        hasActiveDrag={activeDragTaskId !== null}
                        widthClass={widthClass}
                      >
                        <div className="mb-3 space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{column.name}</div>
                            <div className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                              {columnTasks.length} {t.kanbanBoard.cards}
                            </div>
                          </div>
                          <div
                            className="truncate text-[10px] leading-4 text-slate-500 dark:text-slate-400"
                            data-testid={`kanban-column-automation-${column.id}`}
                            title={laneAutomation?.enabled ? formatLaneAutomationSummary(laneAutomation, providers, specialists, {
                              autoProviderId: boardAutoProviderId,
                              autoLabel: t.common.auto,
                            }) : column.stage === "blocked" ? t.kanbanBoard.manualLaneOnly : t.kanbanBoard.manualLane}
                          >
                            {laneAutomation?.enabled
                              ? formatLaneAutomationCompactLabel(laneAutomation, providers, specialists, {
                                autoProviderId: boardAutoProviderId,
                                autoLabel: t.common.auto,
                              })
                              : column.stage === "blocked"
                                ? t.kanbanBoard.manualLaneOnly
                                : t.kanbanBoard.manualLane}
                          </div>
                        </div>

                        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                          {columnTasks.map((task) => (
                            <KanbanCard
                              key={task.id}
                              task={task}
                              boardColumns={board.columns}
                              linkedSession={task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : undefined}
                              liveMessageTail={task.triggerSessionId ? liveSessionTails[task.triggerSessionId] : undefined}
                              availableProviders={availableProviders}
                              specialists={specialists}
                              specialistLanguage={specialistLanguage}
                              codebases={codebases}
                              allCodebaseIds={allCodebaseIds}
                              worktreeCache={worktreeCache}
                              autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                              queuePosition={queuedPositions[task.id]}
                              onOpenDetail={() => openTaskDetail(task)}
                              onDelete={() => confirmDeleteTask(task)}
                              onPatchTask={patchTask}
                              onRetryTrigger={retryTaskTrigger}
                              onRefresh={onRefresh}
                            />
                          ))}
                        </div>
                      </KanbanDropColumn>
                    );
                  })}
              </div>
              {activeDragTask && typeof document !== "undefined" && createPortal(
                <DragOverlay adjustScale={false} dropAnimation={null} zIndex={80}>
                  <div style={activeDragCardWidth ? { width: activeDragCardWidth } : undefined}>
                    <KanbanCardOverlay
                      task={activeDragTask}
                      boardColumns={board.columns}
                      linkedSession={activeDragTask.triggerSessionId ? sessionMap.get(activeDragTask.triggerSessionId) : undefined}
                      liveMessageTail={activeDragTask.triggerSessionId ? liveSessionTails[activeDragTask.triggerSessionId] : undefined}
                      availableProviders={availableProviders}
                      specialists={specialists}
                      specialistLanguage={specialistLanguage}
                      codebases={codebases}
                      allCodebaseIds={allCodebaseIds}
                      worktreeCache={worktreeCache}
                      autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                      queuePosition={queuedPositions[activeDragTask.id]}
                      onOpenDetail={() => {}}
                      onDelete={() => {}}
                      onPatchTask={patchTask}
                      onRetryTrigger={retryTaskTrigger}
                      onRefresh={onRefresh}
                    />
                  </div>
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </div>
        </div>

        {agentPanelOpen && agentSessionId && acp && (
          <aside
            className="flex h-full w-lg min-w-md flex-col overflow-hidden border border-slate-200/70 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c]"
            data-testid="kanban-agent-panel"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-[#191c28]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{kanbanTaskAgentCopy.panelTitle}</div>
                <div
                  className="overflow-x-auto whitespace-nowrap text-[11px] text-slate-400 dark:text-slate-500"
                  title={agentSessionId}
                >
                  {agentSession?.provider ?? boardAutoProviderId ?? acp.selectedProvider} · {agentSessionId}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/workspace/${workspaceId}/sessions/${agentSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
                >
                  {kanbanTaskAgentCopy.open}
                </a>
                <button
                  onClick={onCloseAgentPanel}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
                >
                  {kanbanTaskAgentCopy.close}
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
    </>
  );
}

export function KanbanCreateTaskModal({
  showCreateModal,
  draft,
  setDraft,
  onClose,
  onCreate,
  githubAvailable,
  codebases,
  allCodebaseIds,
}: {
  showCreateModal: boolean;
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  onClose: () => void;
  onCreate: () => void;
  githubAvailable: boolean;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
}) {
  if (!showCreateModal) return null;

  return (
    <KanbanCreateModal
      draft={draft}
      setDraft={setDraft}
      onClose={onClose}
      onCreate={onCreate}
      githubAvailable={githubAvailable}
      codebases={codebases}
      allCodebaseIds={allCodebaseIds}
    />
  );
}

function A2ASessionPane({
  task,
  laneSession,
  sessions,
  specialists,
  specialistLanguage,
  refreshSignal,
  currentSessionId,
  onSelectSession,
  onCloseSession,
}: {
  task: TaskInfo;
  laneSession?: NonNullable<TaskInfo["laneSessions"]>[number];
  sessions: SessionInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  refreshSignal?: number;
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: () => void;
}) {
  const metadata = [
    { label: "Transport", value: (laneSession?.transport ?? "a2a").toUpperCase() },
    { label: "Status", value: laneSession?.status ?? "running" },
    { label: "Lane", value: laneSession?.columnName ?? laneSession?.columnId ?? task.columnId ?? "Unknown lane" },
    { label: "Role", value: laneSession?.role ?? task.assignedRole ?? "Unknown role" },
    { label: "Specialist", value: laneSession?.specialistName ?? laneSession?.specialistId ?? task.assignedSpecialistName ?? task.assignedSpecialistId ?? "Unknown specialist" },
    { label: "Remote task", value: laneSession?.externalTaskId ?? "Unavailable" },
    { label: "Context", value: laneSession?.contextId ?? "Unavailable" },
    { label: "Started", value: formatSessionTimestamp(laneSession?.startedAt ?? task.createdAt) },
    { label: "Completed", value: formatSessionTimestamp(laneSession?.completedAt) },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200/80 bg-slate-50/80 p-2 dark:border-[#202433] dark:bg-[#10131a]">
        <KanbanCardActivityBar
          task={task}
          sessions={sessions}
          specialistLanguage={specialistLanguage}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onCloseSession={onCloseSession}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-br from-white via-sky-50/40 to-amber-50/30 p-5 dark:from-[#12141c] dark:via-[#101824] dark:to-[#17131c]">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <section className="border border-slate-200/80 p-5 dark:border-[#232736]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300">A2A Run</div>
            <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
              {laneSession?.externalTaskId ?? laneSession?.contextId ?? currentSessionId ?? "A2A task"}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              This lane run completed through A2A transport. ACP chat and trace are not available for synthetic A2A sessions, so this pane shows the recorded task metadata instead.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {metadata.map((entry) => (
                <div
                  key={entry.label}
                  className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-700"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {entry.label}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <KanbanCardActivityPanel
            task={task}
            refreshSignal={refreshSignal}
            sessions={sessions}
            specialists={specialists}
            specialistLanguage={specialistLanguage}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            compact
          />
        </div>
      </div>
    </div>
  );
}

export function KanbanTaskDetailOverlay({
  activeSessionId,
  activeTaskId,
  activeTask,
  board,
  resolveSpecialist,
  acp,
  boardAutoProviderId,
  onBoardProviderChange,
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
  setActiveSessionId,
  sessionMap,
  workspaceId,
  isTaskDetailFullscreen,
  onToggleTaskDetailFullscreen,
}: {
  activeSessionId: string | null;
  activeTaskId: string | null;
  activeTask: TaskInfo | null;
  board: KanbanBoardInfo | null;
  resolveSpecialist: ReturnType<typeof import("./kanban-card-session-utils").createKanbanSpecialistResolver>;
  acp?: UseAcpState & UseAcpActions;
  boardAutoProviderId?: string;
  onBoardProviderChange: (providerId: string) => void;
  detailSplitContainerRef: RefObject<HTMLDivElement | null>;
  detailSplitRatio: number;
  setIsDraggingDetailSplit: Dispatch<SetStateAction<boolean>>;
  refreshSignal?: number;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  combinedSessions: SessionInfo[];
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  runTaskPullRequest: (taskId: string) => Promise<string | null>;
  confirmDeleteTask: (task: TaskInfo) => void;
  onRefresh: () => void;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  sessionMap: Map<string, SessionInfo>;
  workspaceId: string;
  isTaskDetailFullscreen?: boolean;
  onToggleTaskDetailFullscreen?: (nextFullscreen: boolean) => void;
}) {
  const isOverlayOpen = Boolean(activeSessionId || activeTaskId);
  const showEmptySessionPane = Boolean(
    activeTask &&
    !activeSessionId &&
    resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist, {
      autoProviderId: resolveKanbanBoardAutoProviderId(board, boardAutoProviderId),
    }).canRun &&
    activeTask.columnId !== "done",
  );
  const selectedLaneSession = getTaskLaneSession(activeTask, activeSessionId);
  const isA2ASessionPane = Boolean(activeTask && isA2ATaskSession(activeTask, activeSessionId));
  const canShowSessionPane = Boolean(showEmptySessionPane || isA2ASessionPane || (activeSessionId && acp));
  const [hiddenSessionPaneTaskId, setHiddenSessionPaneTaskId] = useState<string | null>(null);
  const [sessionRecoveryInputPrefill, setSessionRecoveryInputPrefill] = useState<string | null>(null);
  const isSessionPaneVisible = activeTaskId ? hiddenSessionPaneTaskId !== activeTaskId : true;
  const hasSessionPane = canShowSessionPane && isSessionPaneVisible;
  const selectTaskSession = (task: TaskInfo, sessionId: string) => {
    setActiveSessionId(sessionId);
    setSessionRecoveryInputPrefill(null);
    setHiddenSessionPaneTaskId(null);
    if (acp && canSelectTaskSessionInAcp(task, sessionId, sessionMap)) {
      acp.selectSession(sessionId);
    }
  };

  const recoverActiveAcpSession = async () => {
    if (!acp || !activeSessionId) return;
    const targetSessionInfo = sessionMap.get(activeSessionId);
    if (!targetSessionInfo?.cwd) return;

    try {
      const resumed = await acp.resumeSession(activeSessionId, targetSessionInfo.cwd, { throwOnError: true });
      if (resumed?.sessionId) {
        setActiveSessionId(resumed.sessionId);
        setSessionRecoveryInputPrefill(null);
        onRefresh();
      }
      return;
    } catch (error) {
      if (!isRecoverableAcpSessionError(error)) {
        throw error;
      }
    }

    const transcript = await fetchSessionTranscriptForRestore(activeSessionId);
    const replacement = await acp.createSession(
      targetSessionInfo.cwd,
      targetSessionInfo.provider ?? boardAutoProviderId ?? acp.selectedProvider,
      targetSessionInfo.modeId,
      targetSessionInfo.role,
      targetSessionInfo.workspaceId || workspaceId,
      targetSessionInfo.model,
      undefined,
      targetSessionInfo.specialistId,
      undefined,
      undefined,
      undefined,
      targetSessionInfo.branch,
    );

    if (!replacement?.sessionId) return;

    if (activeTask) {
      const nextSessionIds = [
        ...(activeTask.sessionIds ?? []),
        activeSessionId,
        replacement.sessionId,
      ].filter((sessionId, index, values) => sessionId && values.indexOf(sessionId) === index);
      await patchTask(activeTask.id, { sessionIds: nextSessionIds });
    }

    setActiveSessionId(replacement.sessionId);
    acp.selectSession(replacement.sessionId);
    setSessionRecoveryInputPrefill(buildKanbanSessionRestorePrompt(activeTask, targetSessionInfo, transcript));
    setHiddenSessionPaneTaskId(null);
    onRefresh();
  };

  if (!isOverlayOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/50 animate-in fade-in duration-150 ${
        isTaskDetailFullscreen ? "items-stretch justify-stretch px-0 py-0" : "items-center justify-center px-4 py-6"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden border border-slate-200 bg-white shadow-sm dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150 ${
          isTaskDetailFullscreen ? "h-screen max-w-none border-0" : "h-[88vh] max-w-7xl"
        }`}
      >
        <div ref={detailSplitContainerRef} className="flex h-full">
          {activeTaskId && (() => {
            const task = activeTask;
            if (!task) return null;
            const sessionInfo = activeSessionId ? sessionMap.get(activeSessionId) ?? null : null;
            return (
              <div
                className={`${hasSessionPane ? "shrink-0" : "flex-1"} h-full min-w-0 border-r border-slate-200/80 dark:border-[#202433]`}
                style={hasSessionPane ? { width: `${detailSplitRatio * 100}%` } : undefined}
              >
                <KanbanCardDetail
                  key={task.id}
                  task={task}
                  refreshSignal={refreshSignal}
                  boardColumns={board?.columns ?? []}
                  availableProviders={availableProviders}
                  specialists={specialists}
                  specialistLanguage={specialistLanguage}
                  codebases={codebases}
                  allCodebaseIds={allCodebaseIds}
                  worktreeCache={worktreeCache}
                  sessionInfo={sessionInfo}
                  sessions={combinedSessions}
                  fullWidth={!hasSessionPane}
                  selectedProvider={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId) ?? null}
                  onPatchTask={patchTask}
                  onRetryTrigger={retryTaskTrigger}
                  onRunPullRequest={runTaskPullRequest}
                  onDelete={() => confirmDeleteTask(task)}
                  onRefresh={onRefresh}
                  onProviderChange={(providerId) => {
                    if (providerId) {
                      onBoardProviderChange(providerId);
                    }
                  }}
                  onRepositoryChange={(codebaseIds) => {
                    void codebaseIds;
                  }}
                  onSelectSession={(sessionId) => {
                    selectTaskSession(task, sessionId);
                  }}
                  isFullscreen={isTaskDetailFullscreen}
                  onToggleFullscreen={onToggleTaskDetailFullscreen}
                  canShowSessionPane={canShowSessionPane}
                  isSessionPaneVisible={hasSessionPane}
                  onShowSessionPane={() => setHiddenSessionPaneTaskId(null)}
                />
              </div>
            );
          })()}
          {activeTaskId && hasSessionPane && (
            <div
              className="hidden h-full w-3 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-amber-50/80 dark:hover:bg-amber-900/10 md:flex"
              onMouseDown={() => setIsDraggingDetailSplit(true)}
              data-testid="kanban-detail-split-handle"
            >
              <div className="h-12 w-1 rounded-full bg-slate-300 transition-colors hover:bg-amber-400 dark:bg-slate-700 dark:hover:bg-amber-500" />
            </div>
          )}
          {hasSessionPane ? (() => {
            const taskCodebaseIds = activeTask?.codebaseIds && activeTask.codebaseIds.length > 0
              ? activeTask.codebaseIds
              : allCodebaseIds;
            const primaryCodebase = taskCodebaseIds.length > 0
              ? codebases.find((codebase) => codebase.id === taskCodebaseIds[0])
              : null;
            const activeSessionInfo = activeSessionId
              ? sessionMap.get(activeSessionId) ?? null
              : null;
            const activeWorktree = activeTask?.worktreeId
              ? worktreeCache[activeTask.worktreeId] ?? null
              : null;
            const repoSelection = primaryCodebase
              ? {
                  path: activeSessionInfo?.cwd ?? activeWorktree?.worktreePath ?? primaryCodebase.repoPath,
                  branch: activeSessionInfo?.branch ?? activeWorktree?.branch ?? primaryCodebase.branch ?? "",
                  name: primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop() ?? "",
                }
              : null;
            const taskAgentRole = activeSessionInfo?.role
              ?? selectedLaneSession?.role
              ?? undefined;

            if (showEmptySessionPane && activeTask) {
              return (
                <div
                  className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
                  style={activeTaskId ? { width: `${(1 - detailSplitRatio) * 100}%` } : undefined}
                >
                  <KanbanEmptySessionPane
                    task={activeTask}
                    boardColumns={board?.columns ?? []}
                    availableProviders={availableProviders}
                    specialists={specialists}
                    specialistLanguage={specialistLanguage}
                    autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                    onCloseSession={() => setHiddenSessionPaneTaskId(activeTask?.id ?? null)}
                  />
                </div>
              );
            }

            return (
              <div
                className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
                style={activeTaskId ? { width: `${(1 - detailSplitRatio) * 100}%` } : undefined}
              >
                {activeTask && !isA2ASessionPane && (
                  <div className="shrink-0 border-b border-slate-200/80 p-2 dark:border-[#202433]">
                    <KanbanCardActivityBar
                      task={activeTask}
                      sessions={combinedSessions}
                      specialistLanguage={specialistLanguage}
                      currentSessionId={activeSessionId ?? undefined}
                      onSelectSession={(sessionId) => selectTaskSession(activeTask, sessionId)}
                      onCloseSession={() => setHiddenSessionPaneTaskId(activeTask.id)}
                    />
                  </div>
                )}
                {isA2ASessionPane && activeTask ? (
                  <A2ASessionPane
                    task={activeTask}
                    laneSession={selectedLaneSession}
                    sessions={combinedSessions}
                    specialists={specialists}
                    specialistLanguage={specialistLanguage}
                    refreshSignal={refreshSignal}
                    currentSessionId={activeSessionId ?? undefined}
                    onSelectSession={(sessionId) => selectTaskSession(activeTask, sessionId)}
                    onCloseSession={() => setHiddenSessionPaneTaskId(activeTask.id)}
                  />
                ) : acp && (
                  <div className="min-h-0 flex-1">
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
                      inputPrefill={sessionRecoveryInputPrefill}
                      onInputPrefillConsumed={() => setSessionRecoveryInputPrefill(null)}
                      onResumeActiveSession={recoverActiveAcpSession}
                    />
                  </div>
                )}
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
}
