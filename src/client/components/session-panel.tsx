"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { useTranslation } from "@/i18n";
import { Folder, Zap, MessageCircle, EllipsisVertical, Play, GitFork, Circle } from "lucide-react";


export type SessionContinuityStatus = "active" | "interrupted" | "restorable" | "stale";

export interface SessionResumeCapabilities {
  supported: boolean;
  mode: "native" | "replay" | "both";
  supportsFork?: boolean;
  supportsList?: boolean;
}

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  /** Model used for this session */
  model?: string;
  createdAt: string;
  /** Parent session ID for crafter subtasks */
  parentSessionId?: string;
  /** Session continuity status */
  continuityStatus?: SessionContinuityStatus;
  /** Provider resume capabilities */
  resumeCapabilities?: SessionResumeCapabilities;
}

interface WorkspaceGroup {
  id: string;
  title: string;
  sessions: SessionInfo[];
}

interface SessionPanelProps {
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  workspaceId?: string;
  onResume?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
}

export function SessionPanel({
  selectedSessionId,
  onSelect,
  refreshKey,
  onSessionDeleted,
  workspaceId,
  onResume,
  onFork,
}: SessionPanelProps) {
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsRes, workspacesRes] = await Promise.all([
        desktopAwareFetch(workspaceId ? `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/sessions", { cache: "no-store" }),
        desktopAwareFetch("/api/workspaces?status=active")
      ]);

      const sessionsData = await sessionsRes.json();
      const workspacesData = await workspacesRes.json();

      const sessions: SessionInfo[] = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];
      const workspaces = Array.isArray(workspacesData?.workspaces) ? workspacesData.workspaces : [];

      const grouped = workspaces.map((ws: { id: string; title: any; }) => ({
        id: ws.id,
        title: ws.title,
        sessions: sessions.filter(s => s.workspaceId === ws.id)
      })).filter((g: { sessions: string | any[]; }) => g.sessions.length > 0);

      setWorkspaceGroups(grouped);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, refreshKey]);

  const handleRename = async (sessionId: string, name: string) => {
    try {
      await desktopAwareFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      fetchSessions();
    } catch (e) {
      console.error("Failed to rename session", e);
    }
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await desktopAwareFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      fetchSessions();
      onSessionDeleted?.(sessionId);
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const startEdit = (s: SessionInfo) => {
    setEditingId(s.sessionId);
    setEditName(s.name ?? getDefaultName(s));
    setMenuOpen(null);
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

  const totalSessions = workspaceGroups.reduce((sum, g) => sum + g.sessions.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t.sessions.title}
          </span>
          {totalSessions > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full">
              {totalSessions}
            </span>
          )}
        </div>
        <button
          onClick={fetchSessions}
          disabled={loading}
          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50 transition-colors"
        >
          {loading ? "..." : t.common.refresh}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {workspaceGroups.length === 0 ? (
          <div className="px-3 py-4 text-center text-slate-400 dark:text-slate-500 text-xs">
            {t.sessions.noSessions}
          </div>
        ) : (
          workspaceGroups.map((group) => (
            <div key={group.id} className="bg-slate-50 dark:bg-slate-900/30 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
                <Folder className="w-3 h-3 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{group.title}</span>
                <span className="ml-auto text-[10px] text-slate-400">{group.sessions.length}</span>
              </div>

              <div className="p-1.5 space-y-1">
                {(() => {
                  // Separate parent sessions from child (crafter) sessions
                  const parentSessions = group.sessions.filter(s => !s.parentSessionId);
                  const childSessionMap = new Map<string, SessionInfo[]>();
                  const orphanSessions: SessionInfo[] = [];

                  for (const s of group.sessions) {
                    if (s.parentSessionId) {
                      // Check if parent exists in the current session list
                      const parentExists = group.sessions.some(p => p.sessionId === s.parentSessionId);
                      if (parentExists) {
                        const children = childSessionMap.get(s.parentSessionId) ?? [];
                        children.push(s);
                        childSessionMap.set(s.parentSessionId, children);
                      } else {
                        // Parent doesn't exist - treat as orphan
                        orphanSessions.push(s);
                      }
                    }
                  }

                  return (
                    <>
                      {parentSessions.map((s) => {
                        const children = childSessionMap.get(s.sessionId) ?? [];
                        const active = s.sessionId === selectedSessionId;
                        const isEditing = editingId === s.sessionId;
                        const displayName = s.name ?? getDefaultName(s);
                        const isHovered = hoveredSession === s.sessionId;

                        return (
                          <div key={s.sessionId}>
                            <SessionItem
                              s={s}
                              active={active}
                              isEditing={isEditing}
                              displayName={displayName}
                              isHovered={isHovered}
                              editName={editName}
                              menuOpen={menuOpen}
                              menuRef={menuRef}
                              selectedSessionId={selectedSessionId}
                              onSelect={onSelect}
                              onSetHovered={setHoveredSession}
                              onSetMenuOpen={setMenuOpen}
                              onStartEdit={startEdit}
                              onDelete={handleDelete}
                              onSetEditingId={setEditingId}
                              onSetEditName={setEditName}
                              onRename={handleRename}
                              indent={0}
                              onResume={onResume}
                              onFork={onFork}
                            />
                            {/* Child crafter sessions */}
                            {children.length > 0 && (
                              <div className="ml-3 pl-2 border-l-2 border-slate-200 dark:border-slate-700 space-y-0.5 mt-0.5">
                                {children.map((child) => {
                                  const childActive = child.sessionId === selectedSessionId;
                                  const childIsEditing = editingId === child.sessionId;
                                  const childDisplayName = child.name ?? getDefaultName(child);
                                  const childIsHovered = hoveredSession === child.sessionId;

                                  return (
                                    <SessionItem
                                      key={child.sessionId}
                                      s={child}
                                      active={childActive}
                                      isEditing={childIsEditing}
                                      displayName={childDisplayName}
                                      isHovered={childIsHovered}
                                      editName={editName}
                                      menuOpen={menuOpen}
                                      menuRef={menuRef}
                                      selectedSessionId={selectedSessionId}
                                      onSelect={onSelect}
                                      onSetHovered={setHoveredSession}
                                      onSetMenuOpen={setMenuOpen}
                                      onStartEdit={startEdit}
                                      onDelete={handleDelete}
                                      onSetEditingId={setEditingId}
                                      onSetEditName={setEditName}
                                      onRename={handleRename}
                                      indent={1}
                                      onResume={onResume}
                                      onFork={onFork}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Orphan sessions (child sessions whose parent is not in the list) */}
                      {orphanSessions.map((s) => {
                        const active = s.sessionId === selectedSessionId;
                        const isEditing = editingId === s.sessionId;
                        const displayName = s.name ?? getDefaultName(s);
                        const isHovered = hoveredSession === s.sessionId;

                        return (
                          <SessionItem
                            key={s.sessionId}
                            s={s}
                            active={active}
                            isEditing={isEditing}
                            displayName={displayName}
                            isHovered={isHovered}
                            editName={editName}
                            menuOpen={menuOpen}
                            menuRef={menuRef}
                            selectedSessionId={selectedSessionId}
                            onSelect={onSelect}
                            onSetHovered={setHoveredSession}
                            onSetMenuOpen={setMenuOpen}
                            onStartEdit={startEdit}
                            onDelete={handleDelete}
                            onSetEditingId={setEditingId}
                            onSetEditName={setEditName}
                            onRename={handleRename}
                            indent={0}
                            onResume={onResume}
                            onFork={onFork}
                          />
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Session Item Component ────────────────────────────────────────────

interface SessionItemProps {
  s: SessionInfo;
  active: boolean;
  isEditing: boolean;
  displayName: string;
  isHovered: boolean;
  editName: string;
  menuOpen: string | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onSetHovered: (sessionId: string | null) => void;
  onSetMenuOpen: (sessionId: string | null) => void;
  onStartEdit: (s: SessionInfo) => void;
  onDelete: (sessionId: string) => void;
  onSetEditingId: (id: string | null) => void;
  onSetEditName: (name: string) => void;
  onRename: (sessionId: string, name: string) => void;
  indent: number;
  onResume?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
}

function SessionItem({
  s,
  active,
  isEditing,
  displayName,
  isHovered,
  editName,
  menuOpen,
  menuRef,
  onSelect,
  onSetHovered,
  onSetMenuOpen,
  onStartEdit,
  onDelete,
  onSetEditingId,
  onSetEditName,
  onRename,
  indent,
  onResume,
  onFork,
}: SessionItemProps) {
  const { t } = useTranslation();
  const isChild = indent > 0;
  const roleIcon = isChild ? (
    <Zap className="w-3 h-3 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
  ) : null;

  return (
    <div
      className="relative"
      onMouseEnter={() => onSetHovered(s.sessionId)}
      onMouseLeave={() => onSetHovered(null)}
    >
      {isEditing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRename(s.sessionId, editName);
            onSetEditingId(null);
          }}
          className="px-2 py-1.5"
        >
          <input
            type="text"
            value={editName}
            onChange={(e) => onSetEditName(e.target.value)}
            autoFocus
            className="w-full text-xs px-1.5 py-1 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            onBlur={() => {
              if (editName.trim()) {
                onRename(s.sessionId, editName);
              }
              onSetEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSetEditingId(null);
            }}
          />
        </form>
      ) : (
        <div
          onClick={() => onSelect(s.sessionId)}
          className={`${isChild ? "px-2 py-1.5" : "px-2.5 py-2"} rounded-md cursor-pointer transition-colors ${active
            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            : "hover:bg-white dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
            }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              {roleIcon}
              <div className="min-w-0">
                <div className={`${isChild ? "text-[11px]" : "text-xs"} font-medium truncate`}>
                  {displayName}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                  {s.continuityStatus && (
                    <span className={`inline-flex items-center gap-0.5 ${
                      s.continuityStatus === "active" ? "text-green-500" :
                      s.continuityStatus === "restorable" ? "text-blue-500" :
                      s.continuityStatus === "interrupted" ? "text-amber-500" :
                      "text-slate-400"
                    }`}>
                      <Circle className="w-1.5 h-1.5" fill="currentColor" />
                    </span>
                  )}
                  {s.provider && <span>{s.provider}</span>}
                  {s.role && <span>• {s.role}</span>}
                </div>
              </div>
            </div>
            {(isHovered || active || menuOpen === s.sessionId) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetMenuOpen(menuOpen === s.sessionId ? null : s.sessionId);
                }}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <EllipsisVertical className="w-3 h-3 text-slate-400" fill="currentColor" viewBox="0 0 20 20"/>
              </button>
            )}
          </div>
        </div>
      )}

      {menuOpen === s.sessionId && (
        <div
          ref={menuRef}
          className="absolute right-2 top-8 z-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg py-1 min-w-[100px]"
        >
          {onResume && s.resumeCapabilities?.supported && (
            <button
              type="button"
              onClick={() => {
                onSetMenuOpen(null);
                onResume(s.sessionId);
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 flex items-center gap-1.5"
            >
              <Play className="w-3 h-3" />
              {t.sessions.resume}
            </button>
          )}
          {onFork && s.resumeCapabilities?.supportsFork && (
            <button
              type="button"
              onClick={() => {
                onSetMenuOpen(null);
                onFork(s.sessionId);
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 text-purple-600 dark:text-purple-400 flex items-center gap-1.5"
            >
              <GitFork className="w-3 h-3" />
              {t.sessions.fork}
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartEdit(s)}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
          >
            {t.sessions.rename}
          </button>
          <button
            type="button"
            onClick={() => {
              onSetMenuOpen(null);
              onDelete(s.sessionId);
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
          >
            {t.common.delete}
          </button>
        </div>
      )}
    </div>
  );
}
