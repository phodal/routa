"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { desktopAwareFetch, shouldSuppressTeardownError } from "../utils/diagnostics";

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
      if (!tearingDownRef.current) {
        setLoading(false);
      }
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
      <div className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 text-xs">
        Loading...
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
        className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        title="Rename"
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
        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500"
        title="Delete"
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
    iconColor = "text-gray-400",
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
          className={`group flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${highlighted ? "bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:ring-amber-800 dark:hover:bg-amber-900/30" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}
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
                className="w-full text-[11px] font-medium bg-white dark:bg-gray-900 border border-blue-400 rounded px-1 py-0.5 outline-none text-gray-700 dark:text-gray-300"
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">
                  {displayName}
                </div>
                {isChildSession && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    Child
                  </span>
                )}
                {highlighted && (
                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    Focus
                  </span>
                )}
              </div>
            )}
            <div className="text-[10px] text-gray-400 dark:text-gray-500">
              {label ? `${label} • ` : ""}{session.role}{session.role ? " • " : ""}{formatTimeAgo(session.createdAt)}
            </div>
          </div>
          {!isRenaming && <SessionActions sid={session.sessionId} displayName={displayName} />}
        </div>
      </div>
    );
  };

  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
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
                className="w-full text-xs font-semibold bg-white dark:bg-gray-900 border border-blue-400 rounded px-1 py-0.5 outline-none text-blue-700 dark:text-blue-300"
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

      {/* Session Hierarchy — always expanded */}
      {hasHierarchy && (
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Hierarchy
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
                  <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
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
                    iconColor="text-purple-500"
                  />
                ))}
              </div>
            )}

            {/* Child Sessions */}
            {context.children.length > 0 && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
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
