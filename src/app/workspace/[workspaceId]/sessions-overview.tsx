"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "@/i18n";
import { formatRelativeTime } from "./ui-components";
import type { SessionInfo } from "./types";
import { ChevronDown, ChevronRight, PieChart, RefreshCw, SquareArrowOutUpRight, MessageCircleMore, SquarePen, Trash2 } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


interface SessionsOverviewProps {
  sessions: SessionInfo[];
  workspaceId: string;
  onNavigate: (sessionId: string) => void;
  onRefresh: () => void;
  filterSession?: (session: SessionInfo & { parentSessionId?: string }) => boolean;
}

export function SessionsOverview({ sessions, workspaceId, onNavigate, onRefresh, filterSession }: SessionsOverviewProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [sessionTree, setSessionTree] = useState<Map<string, SessionInfo[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Build parent-child tree
  useEffect(() => {
    if (!expanded) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        const allSessions = Array.isArray(data?.sessions)
          ? (filterSession ? data.sessions.filter(filterSession) : data.sessions)
          : [];
        const tree = new Map<string, SessionInfo[]>();

        allSessions.forEach((session: SessionInfo & { parentSessionId?: string }) => {
          const parentId = session.parentSessionId || "root";
          if (!tree.has(parentId)) {
            tree.set(parentId, []);
          }
          tree.get(parentId)!.push(session);
        });

        tree.set("all", allSessions);
        setSessionTree(tree);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, filterSession, workspaceId]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm(t.sessions.deleteConfirm)) return;
    try {
      await desktopAwareFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      onRefresh();
    } catch (error) {
      console.error(t.sessions.deleteFailed, error);
    }
    setContextMenu(null);
  };

  const handleRenameSession = (sessionId: string, currentName: string) => {
    setRenamingSession(sessionId);
    setRenameValue(currentName);
    setContextMenu(null);
  };

  const handleSaveRename = async (sessionId: string) => {
    if (!renameValue.trim()) return;
    try {
      await desktopAwareFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      onRefresh();
    } catch (error) {
      console.error(t.sessions.renameFailed, error);
    }
    setRenamingSession(null);
  };

  const displaySessions = expanded
    ? (sessionTree.size > 0 ? (sessionTree.get("all") || []) : sessions)
    : sessions.slice(0, 6);

  const renderSession = (session: SessionInfo, depth = 0) => {
    const children = sessionTree.get(session.sessionId) || [];
    const hasChildren = children.length > 0;
    const isRenaming = renamingSession === session.sessionId;

    return (
      <div key={session.sessionId} style={{ marginLeft: depth * 20 }}>
        <div
          className="group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-[#151720] transition-colors"
          onContextMenu={(e) => handleContextMenu(e, session.sessionId)}
        >
          {depth > 0 && (
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          )}
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
            depth > 0
              ? "bg-slate-100 dark:bg-slate-900/20"
              : "bg-blue-50 dark:bg-blue-900/20"
          }`}>
            <MessageCircleMore className={`w-3.5 h-3.5 ${depth > 0
        ? "text-slate-500 dark:text-slate-400"
        : "text-blue-500 dark:text-blue-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </div>
          <div className="flex-1 min-w-0" onClick={() => !isRenaming && onNavigate(session.sessionId)}>
            <div className="flex items-center gap-2">
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveRename(session.sessionId);
                    if (e.key === "Escape") setRenamingSession(null);
                  }}
                  onBlur={() => handleSaveRename(session.sessionId)}
                  autoFocus
                  className="text-[13px] font-medium px-2 py-1 rounded border border-blue-500 dark:border-blue-400 bg-white dark:bg-[#0e1019] text-slate-700 dark:text-slate-300 outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors cursor-pointer">
                  {session.name || session.provider || `Session ${session.sessionId.slice(0, 8)}`}
                </div>
              )}
              {hasChildren && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900/30 text-slate-600 dark:text-slate-400 font-mono">
                  {children.length}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
              {session.role && <span className="capitalize">{session.role.toLowerCase()}</span>}
              {session.role && session.provider && <span className="mx-1">·</span>}
              {session.provider && <span>{session.provider}</span>}
            </div>
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono shrink-0">
            {formatRelativeTime(session.createdAt)}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </div>
        {expanded && hasChildren && children.map(child => renderSession(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-[#0e1019] border border-slate-200/60 dark:border-[#191c28] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200/60 dark:border-[#191c28] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
            {t.sessions.recentSessions}
          </h3>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-[#191c28] text-slate-500 dark:text-slate-400 font-mono">
            {sessions.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
          >
            {expanded ? t.sessions.showLess : t.sessions.showAll}
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
      </div>
      <div className={`${expanded ? "max-h-150 overflow-y-auto" : ""}`}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400 dark:text-slate-500">
            <PieChart className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"/>
          </div>
        ) : displaySessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-slate-400 dark:text-slate-500">
            {t.sessions.noSessionsHint}
          </div>
        ) : (
          <div className="py-2">
            {displaySessions.map(session => renderSession(session))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-[#2a2d3e] dark:bg-[#1a1d2e]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const session = sessions.find(s => s.sessionId === contextMenu.sessionId);
              if (session) {
                handleRenameSession(contextMenu.sessionId, session.name || session.provider || `Session ${session.sessionId.slice(0, 8)}`);
              }
            }}
            className="w-full px-3 py-2 text-left text-[12px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252838] transition-colors flex items-center gap-2"
          >
            <SquarePen className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.sessions.rename}
          </button>
          <button
            onClick={() => onNavigate(contextMenu.sessionId)}
            className="w-full px-3 py-2 text-left text-[12px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252838] transition-colors flex items-center gap-2"
          >
            <SquareArrowOutUpRight className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.sessions.open}
          </button>
          <div className="h-px bg-slate-200 dark:bg-[#2a2d3e] my-1" />
          <button
            onClick={() => handleDeleteSession(contextMenu.sessionId)}
            className="w-full px-3 py-2 text-left text-[12px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.common.delete}
          </button>
        </div>
      )}
    </div>
  );
}
