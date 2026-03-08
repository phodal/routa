"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { KanbanBoardInfo, SessionInfo, TaskInfo } from "./types";

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
}

type DraftIssue = {
  title: string;
  objective: string;
  priority: string;
  labels: string;
  createGitHubIssue: boolean;
};

const EMPTY_DRAFT: DraftIssue = {
  title: "",
  objective: "",
  priority: "medium",
  labels: "",
  createGitHubIssue: false,
};

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

export function KanbanTab({ workspaceId, boards, tasks, sessions, providers, specialists, codebases, onRefresh }: KanbanTabProps) {
  const pathname = usePathname();
  const defaultBoardId = useMemo(
    () => boards.find((board) => board.isDefault)?.id ?? boards[0]?.id ?? null,
    [boards],
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
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, {
    assignedProvider: string;
    assignedRole: string;
    assignedSpecialistId: string;
    assignedSpecialistName: string;
  }>>({});

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

  async function patchTask(taskId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, repoPath: defaultCodebase?.repoPath }),
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
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId,
        title: draft.title,
        objective: draft.objective,
        priority: draft.priority,
        labels: draft.labels.split(",").map((label) => label.trim()).filter(Boolean),
        createGitHubIssue: draft.createGitHubIssue,
        repoPath: defaultCodebase?.repoPath,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to create issue");
    }
    setLocalTasks((current) => [...current, data.task as TaskInfo]);
    setDraft({ ...EMPTY_DRAFT, createGitHubIssue: githubAvailable });
    setShowCreateModal(false);
    onRefresh();
  }

  async function retryTaskTrigger(taskId: string) {
    const updated = await patchTask(taskId, { retryTrigger: true });
    if (updated.triggerSessionId) {
      setActiveSessionId(updated.triggerSessionId);
    }
    onRefresh();
  }

  async function moveTask(taskId: string, targetColumnId: string) {
    const movingTask = localTasks.find((task) => task.id === taskId);
    if (!movingTask) return;

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
      const updated = await patchTask(taskId, { columnId: targetColumnId, position: nextPosition });
      if (updated.triggerSessionId && updated.triggerSessionId !== movingTask.triggerSessionId) {
        setActiveSessionId(updated.triggerSessionId);
      }
      onRefresh();
    } catch (error) {
      console.error(error);
      setLocalTasks(tasks);
    }
  }

  async function saveAssignment(task: TaskInfo) {
    const draftAssignment = assignmentDrafts[task.id];
    if (!draftAssignment) return;

    const specialist = specialists.find((item) => item.id === draftAssignment.assignedSpecialistId);
    const assignedSpecialistName = specialist?.name ?? draftAssignment.assignedSpecialistName ?? undefined;
    const updated = await patchTask(task.id, {
      assignedProvider: draftAssignment.assignedProvider,
      assignedRole: specialist?.role ?? draftAssignment.assignedRole,
      assignedSpecialistId: draftAssignment.assignedSpecialistId || undefined,
      assignedSpecialistName,
    });
    setEditingAssignmentId(null);
    if (updated.triggerSessionId && updated.triggerSessionId !== task.triggerSessionId) {
      setActiveSessionId(updated.triggerSessionId);
    }
    onRefresh();
  }

  async function createBoard() {
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedBoardId ?? ""}
            onChange={(event) => setSelectedBoardId(event.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#12141c] px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
          >
            {boards.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <button
            onClick={createBoard}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#191c28]"
          >
            New board
          </button>
          <a
            href={pathname?.endsWith("/kanban") ? `/workspace/${workspaceId}` : `/workspace/${workspaceId}/kanban`}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#191c28]"
          >
            {pathname?.endsWith("/kanban") ? "Dashboard view" : "Board page"}
          </a>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          Create issue
        </button>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-275 grid-cols-6 gap-3">
          {board.columns
            .slice()
            .sort((left, right) => left.position - right.position)
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
                  className="min-h-105 rounded-2xl border border-gray-200/70 dark:border-[#1c1f2e] bg-white dark:bg-[#12141c] p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{column.name}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">{columnTasks.length} cards</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {columnTasks.map((task) => {
                      const linkedSession = task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : undefined;
                      const sessionStatus = linkedSession?.acpStatus;
                      const sessionError = linkedSession?.acpError;
                      const canRetry = Boolean(task.assignedProvider) && (
                        sessionStatus === "error" || (!task.triggerSessionId && task.columnId === "dev")
                      );
                      const assignment = assignmentDrafts[task.id] ?? {
                        assignedProvider: task.assignedProvider ?? availableProviders[0]?.id ?? "opencode",
                        assignedRole: task.assignedRole ?? "CRAFTER",
                        assignedSpecialistId: task.assignedSpecialistId ?? "",
                        assignedSpecialistName: task.assignedSpecialistName ?? "",
                      };
                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={() => setDragTaskId(task.id)}
                          className="rounded-xl border border-gray-200/70 dark:border-[#262938] bg-gray-50/80 dark:bg-[#0d1018] p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{task.title}</div>
                              {task.githubNumber ? (
                                <a
                                  href={task.githubUrl}
                                  target="_blank"
                                  rel="noreferrer"
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

                          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                            <div className="truncate">
                              {task.assignedProvider ? `${task.assignedProvider}${task.assignedSpecialistName ? ` · ${task.assignedSpecialistName}` : ""}` : "Unassigned"}
                            </div>
                            <button
                              onClick={() => {
                                setEditingAssignmentId(editingAssignmentId === task.id ? null : task.id);
                                setAssignmentDrafts((current) => ({ ...current, [task.id]: assignment }));
                              }}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] hover:bg-white dark:border-gray-700 dark:hover:bg-[#191c28]"
                            >
                              Assign
                            </button>
                          </div>

                          {editingAssignmentId === task.id && (
                            <div className="mt-3 space-y-2 border-t border-gray-200/70 pt-3 dark:border-[#262938]">
                              <select
                                value={assignment.assignedProvider}
                                onChange={(event) => setAssignmentDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...assignment, assignedProvider: event.target.value },
                                }))}
                                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-[#12141c]"
                              >
                                {availableProviders.map((provider) => (
                                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                                ))}
                              </select>

                              <select
                                value={assignment.assignedRole}
                                onChange={(event) => setAssignmentDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...assignment, assignedRole: event.target.value },
                                }))}
                                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-[#12141c]"
                              >
                                {ROLE_OPTIONS.map((role) => (
                                  <option key={role} value={role}>{role}</option>
                                ))}
                              </select>

                              <select
                                value={assignment.assignedSpecialistId}
                                onChange={(event) => {
                                  const specialist = specialists.find((item) => item.id === event.target.value);
                                  setAssignmentDrafts((current) => ({
                                    ...current,
                                    [task.id]: {
                                      ...assignment,
                                      assignedSpecialistId: event.target.value,
                                      assignedSpecialistName: specialist?.name ?? "",
                                      assignedRole: specialist?.role ?? assignment.assignedRole,
                                    },
                                  }));
                                }}
                                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-[#12141c]"
                              >
                                <option value="">No specialist</option>
                                {specialists.map((specialist) => (
                                  <option key={specialist.id} value={specialist.id}>{specialist.name}</option>
                                ))}
                              </select>

                              <div className="flex items-center justify-between gap-2">
                                <button
                                  onClick={() => setEditingAssignmentId(null)}
                                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-white dark:border-gray-700 dark:hover:bg-[#191c28]"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => saveAssignment(task)}
                                  className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          )}

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
                              {canRetry && (
                                <button
                                  onClick={() => void retryTaskTrigger(task.id)}
                                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300"
                                >
                                  Rerun
                                </button>
                              )}
                              {task.triggerSessionId && (
                                <button
                                  onClick={() => setActiveSessionId(task.triggerSessionId ?? null)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create issue</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Close</button>
            </div>

            <div className="space-y-3">
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Issue title"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0d1018]"
              />
              <textarea
                value={draft.objective}
                onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value }))}
                placeholder="Describe the work"
                rows={6}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0d1018]"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={draft.priority}
                  onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0d1018]"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <input
                  value={draft.labels}
                  onChange={(event) => setDraft((current) => ({ ...current, labels: event.target.value }))}
                  placeholder="labels,comma,separated"
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0d1018]"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={draft.createGitHubIssue}
                  disabled={!githubAvailable}
                  onChange={(event) => setDraft((current) => ({ ...current, createGitHubIssue: event.target.checked }))}
                />
                Also create GitHub issue
              </label>
              {!githubAvailable && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Current default codebase is not linked to a GitHub repo. The issue will be local-only.
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => void createIssue()}
                disabled={!draft.title.trim() || !draft.objective.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="relative h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4 dark:border-[#191c28]">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">ACP Session</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">{activeSessionId}</div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/workspace/${workspaceId}/sessions/${activeSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Open full page
                </a>
                <button
                  onClick={() => setActiveSessionId(null)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              title="ACP session"
              src={`/workspace/${workspaceId}/sessions/${activeSessionId}`}
              className="h-[calc(88vh-48px)] w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}