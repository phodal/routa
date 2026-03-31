"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { LaneHandoffInfo, LaneSessionInfo, SessionKanbanContext } from "@/client/types/kanban-context";
import { desktopAwareFetch, shouldSuppressTeardownError } from "../utils/diagnostics";
import { useTranslation } from "@/i18n";

interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  model?: string;
  createdAt: string;
  parentSessionId?: string;
}

interface SessionContext {
  current: SessionInfo;
  parent?: SessionInfo;
  children: SessionInfo[];
  siblings: SessionInfo[];
  recentInWorkspace: SessionInfo[];
  kanbanContext?: SessionKanbanContext | null;
}

interface SessionContextPanelProps {
  sessionId: string;
  workspaceId: string;
  onSelectSession: (sessionId: string) => void;
  focusedSessionId?: string | null;
  refreshTrigger?: number;
}

export function SessionContextPanel({
  sessionId,
  workspaceId: _workspaceId,
  onSelectSession,
  focusedSessionId,
  refreshTrigger = 0,
}: SessionContextPanelProps) {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const tearingDownRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    tearingDownRef.current = false;
    return () => {
      tearingDownRef.current = true;
    };
  }, []);

  const fetchContext = useCallback(async () => {
    try {
      setLoading(true);
      const res = await desktopAwareFetch(
        `/api/sessions/${sessionId}/context`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        if (tearingDownRef.current) return;
        setContext(null);
        return;
      }

      const data = await res.json();
      if (tearingDownRef.current) return;
      setContext(data);
    } catch (e) {
      if (tearingDownRef.current || shouldSuppressTeardownError(e)) {
        return;
      }
      console.error("Failed to fetch session context", e);
      setContext(null);
    } finally {
      if (tearingDownRef.current) {
        // Early return is safe here - cleanup is handled by teardown
        // eslint-disable-next-line no-unsafe-finally
        return;
      }
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext, refreshTrigger]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleRename = async (targetId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await desktopAwareFetch(`/api/sessions/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        await fetchContext();
      }
    } catch (e) {
      console.error("Failed to rename session", e);
    }
    setRenamingId(null);
  };

  const handleDelete = async (targetId: string) => {
    try {
      const res = await desktopAwareFetch(`/api/sessions/${targetId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchContext();
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  if (loading) {
    return (
      <div className="px-3 py-4 text-center text-slate-400 dark:text-slate-500 text-xs">
        {t.common.loading}
      </div>
    );
  }

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getDefaultName = (s: SessionInfo) => {
    if (s.provider && s.role) {
      return `${s.provider}-${s.role.toLowerCase()}-${s.sessionId.slice(0, 6)}`;
    }
    if (s.provider) {
      return `${s.provider}-${s.sessionId.slice(0, 7)}`;
    }
    return s.sessionId.slice(0, 8);
  };

  const formatRequestType = (value: LaneHandoffInfo["requestType"]) =>
    value.replace(/_/g, " ");

  const formatLaneSessionLabel = (session: LaneSessionInfo) =>
    [
      session.columnName ?? session.columnId ?? "Unknown lane",
      session.stepName ?? (typeof session.stepIndex === "number" ? `Step ${session.stepIndex + 1}` : undefined),
      session.provider,
      session.role,
    ].filter(Boolean).join(" • ");

  if (!context) {
    return null;
  }

  const hasHierarchy = context.parent || context.children.length > 0 || context.siblings.length > 0;
  const focusedSession = focusedSessionId
    ? [context.current, context.parent, ...context.siblings, ...context.children]
      .filter((session): session is SessionInfo => Boolean(session))
      .find((session) => session.sessionId === focusedSessionId)
    : undefined;

  /** Inline rename/delete actions for a session row */
  const SessionActions = ({ sid, displayName }: { sid: string; displayName: string }) => (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      {/* Rename */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setRenameValue(displayName);
          setRenamingId(sid);
        }}
        className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        title={t.sessions.rename}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      {/* Delete */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDelete(sid);
        }}
        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
        title={t.common.delete}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );

  /** Render a session row with name, metadata, and actions */
  const SessionRow = ({
    session,
    label,
    icon,
    iconColor = "text-slate-400",
    indent = false,
    highlighted = false,
  }: {
    session: SessionInfo;
    label?: string;
    icon: React.ReactNode;
    iconColor?: string;
    indent?: boolean;
    highlighted?: boolean;
  }) => {
    const displayName = session.name ?? getDefaultName(session);
    const isRenaming = renamingId === session.sessionId;
    const isChildSession = Boolean(session.parentSessionId);

    return (
      <div className={indent ? "ml-5" : ""}>
        <div
          onClick={() => !isRenaming && onSelectSession(session.sessionId)}
          className={`group flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${highlighted ? "bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:ring-amber-800 dark:hover:bg-amber-900/30" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        >
          <span className={`shrink-0 mt-0.5 ${iconColor}`}>{icon}</span>
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRename(session.sessionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(session.sessionId);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-[11px] font-medium bg-white dark:bg-slate-900 border border-blue-400 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-slate-300"
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                  {displayName}
                </div>
                {isChildSession && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {t.sessions.child}
                  </span>
                )}
                {highlighted && (
                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {t.sessions.focus}
                  </span>
                )}
              </div>
            )}
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {label ? `${label} • ` : ""}{session.role}{session.role ? " • " : ""}{formatTimeAgo(session.createdAt)}
            </div>
          </div>
          {!isRenaming && <SessionActions sid={session.sessionId} displayName={displayName} />}
        </div>
      </div>
    );
  };

  return (
    <div className="border-b border-slate-100 dark:border-slate-800">
      {/* Current Session Info */}
      <div className="px-3 py-3 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/30">
        <div className="flex items-start gap-2">
          <svg
            className="w-4 h-4 text-blue-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div className="min-w-0 flex-1">
            {renamingId === context.current.sessionId ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRename(context.current.sessionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(context.current.sessionId);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-900 border border-blue-400 rounded px-1 py-0.5 outline-none text-blue-700 dark:text-blue-300"
              />
            ) : (
              <div className="flex items-center gap-1">
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 truncate flex-1">
                  {context.current.name ?? getDefaultName(context.current)}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setRenameValue(context.current.name ?? getDefaultName(context.current));
                      setRenamingId(context.current.sessionId);
                    }}
                    className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                    title="Rename"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
              {context.current.role && (
                <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 rounded">
                  {context.current.role}
                </span>
              )}
              {focusedSession && focusedSession.sessionId !== context.current.sessionId && (
                <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 rounded text-amber-700 dark:text-amber-300">
                  Focus: {focusedSession.name ?? getDefaultName(focusedSession)}
                </span>
              )}
              {context.current.provider && (
                <span className="text-blue-500 dark:text-blue-400">
                  {context.current.provider}
                </span>
              )}
              <span className="text-blue-400 dark:text-blue-500">•</span>
              <span className="text-blue-500 dark:text-blue-400">
                {formatTimeAgo(context.current.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {context.kanbanContext && (
        <div className="border-b border-slate-100 dark:border-slate-800">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8m-8 5h5m-5 5h8M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.sessions.kanbanStory}
            </span>
          </div>
          <div className="px-3 pb-3 space-y-2">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900/30 dark:bg-emerald-900/10">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                  {context.kanbanContext.taskTitle}
                </span>
                {context.kanbanContext.columnId && (
                  <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-[#11161f] dark:text-emerald-300">
                    {context.kanbanContext.columnId}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                Task {context.kanbanContext.taskId.slice(0, 8)}
              </div>
              {context.kanbanContext.currentLaneSession && (
                <div className="mt-2 text-[10px] text-slate-600 dark:text-slate-300">
                  Current lane session: {formatLaneSessionLabel(context.kanbanContext.currentLaneSession)}
                  {" · "}
                  <span className="font-semibold uppercase tracking-wide">
                    {context.kanbanContext.currentLaneSession.status}
                  </span>
                </div>
              )}
              {context.kanbanContext.previousLaneSession && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-blue-100 bg-white/90 px-2.5 py-2 dark:border-blue-900/30 dark:bg-[#11161f]">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-300">
                      {t.sessions.previousLane}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-700 dark:text-slate-200">
                      {formatLaneSessionLabel(context.kanbanContext.previousLaneSession)}
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectSession(context.kanbanContext!.previousLaneSession!.sessionId)}
                    className="shrink-0 rounded-md border border-blue-200 px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/20"
                  >
                    {t.sessions.open}
                  </button>
                </div>
              )}
              {context.kanbanContext.previousLaneRun && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white/90 px-2.5 py-2 dark:border-slate-800/40 dark:bg-[#11161f]">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                      {t.sessions.previousRunInLane}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-700 dark:text-slate-200">
                      {formatLaneSessionLabel(context.kanbanContext.previousLaneRun)}
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectSession(context.kanbanContext!.previousLaneRun!.sessionId)}
                    className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/20"
                  >
                    {t.sessions.open}
                  </button>
                </div>
              )}
            </div>

            {context.kanbanContext.relatedHandoffs.length > 0 && (
              <div className="space-y-2">
                {context.kanbanContext.relatedHandoffs.map((handoff) => {
                  const counterpartSessionId = handoff.direction === "incoming"
                    ? handoff.fromSessionId
                    : handoff.toSessionId;
                  const counterpartLane = handoff.direction === "incoming"
                    ? handoff.fromColumnName ?? handoff.fromColumnId ?? "previous lane"
                    : handoff.toColumnName ?? handoff.toColumnId ?? "next lane";

                  return (
                    <div
                      key={handoff.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#121722]"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {handoff.direction}
                        </span>
                        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                          {formatRequestType(handoff.requestType)}
                        </span>
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {handoff.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">
                        {handoff.request}
                      </div>
                      {handoff.responseSummary && (
                        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-200">
                          {handoff.responseSummary}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                        <span>
                          {counterpartLane} • {formatTimeAgo(handoff.requestedAt)}
                        </span>
                        <button
                          onClick={() => onSelectSession(counterpartSessionId)}
                          className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {t.sessions.openSession}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session Hierarchy — always expanded */}
      {hasHierarchy && (
        <div className="border-b border-slate-100 dark:border-slate-800">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.sessions.hierarchy}
            </span>
          </div>

          <div className="px-3 pb-2 space-y-1">
            {/* Parent Session */}
            {context.parent && (
              <SessionRow
                session={context.parent}
                label="Parent"
                highlighted={context.parent.sessionId === focusedSessionId}
                icon={
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                }
              />
            )}

            {/* Sibling Sessions */}
            {context.siblings.length > 0 && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {context.siblings.length} Sibling Session{context.siblings.length > 1 ? "s" : ""}
                  </span>
                </div>
                {context.siblings.map((sibling) => (
                  <SessionRow
                    key={sibling.sessionId}
                    session={sibling}
                    indent
                    highlighted={sibling.sessionId === focusedSessionId}
                    icon={
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    }
                    iconColor="text-slate-500"
                  />
                ))}
              </div>
            )}

            {/* Child Sessions */}
            {context.children.length > 0 && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {context.children.length} Child Session{context.children.length > 1 ? "s" : ""}
                  </span>
                </div>
                {context.children.map((child) => (
                  <SessionRow
                    key={child.sessionId}
                    session={child}
                    indent
                    highlighted={child.sessionId === focusedSessionId}
                    icon={
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    }
                    iconColor="text-amber-500"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
