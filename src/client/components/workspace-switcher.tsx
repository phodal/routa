"use client";

import { useState, useRef, useEffect } from "react";
import type { WorkspaceData } from "../hooks/use-workspaces";

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceData[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onCreate: (title: string) => Promise<void>;
  loading?: boolean;
  compact?: boolean;
  /** Use desktop/VS Code style theme */
  desktop?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreate,
  loading,
  compact,
  desktop,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await onCreate(title);
    setNewTitle("");
    setCreating(false);
    setOpen(false);
  };

  // Desktop theme styles
  if (desktop || compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-[var(--dt-text-primary)] transition-colors hover:bg-[var(--dt-bg-active)]"
        title={active?.title ?? "Select workspace"}
      >
          <svg className="w-3 h-3 text-[var(--dt-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="max-w-[120px] truncate">
            {loading ? "..." : (active?.title ?? "Select")}
          </span>
          <svg className={`w-2.5 h-2.5 text-[var(--dt-text-secondary)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 z-50 mt-1 w-52 border border-[var(--dt-border)] bg-[var(--dt-bg-secondary)] shadow-xl">
            <div className="py-1 max-h-52 overflow-y-auto">
              {workspaces.length === 0 && (
                <div className="px-3 py-2 text-center text-[11px] text-[var(--dt-text-secondary)]">No workspaces yet</div>
              )}
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => { onSelect(ws.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] transition-colors ${
                    ws.id === activeWorkspaceId
                      ? "bg-[var(--dt-bg-active)] text-[var(--dt-text-primary)]"
                      : "text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-tertiary)]"
                  }`}
                >
                  <svg className="w-3 h-3 shrink-0 text-[var(--dt-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="truncate flex-1">{ws.title}</span>
                  {ws.id === activeWorkspaceId && (
                    <svg className="w-3 h-3 shrink-0 text-[var(--dt-accent)]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            <div className="border-t border-[var(--dt-border)] p-1.5">
              {creating ? (
                <div className="flex gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                    placeholder="Workspace name..."
                    className="flex-1 border border-[var(--dt-border)] bg-[var(--dt-bg-tertiary)] px-2 py-1 text-[11px] text-[var(--dt-text-primary)] outline-none placeholder:text-[var(--dt-text-secondary)] focus:border-[var(--dt-accent)]"
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="bg-[var(--dt-accent)] px-2 py-1 text-[11px] font-medium text-[var(--dt-accent-contrast)] transition-colors hover:bg-[var(--dt-accent-hover)]"
                  >
                    Create
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--dt-accent)] transition-colors hover:bg-[var(--dt-bg-tertiary)]"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New Workspace
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Original light/dark theme styles
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors max-w-[180px]"
        title={active?.title ?? "Select workspace"}
      >
        <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1 text-left">
          {loading ? "..." : (active?.title ?? "Select workspace")}
        </span>
        <svg className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-50">
          <div className="py-1 max-h-52 overflow-y-auto">
            {workspaces.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 text-center">No workspaces yet</div>
            )}
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => { onSelect(ws.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${
                  ws.id === activeWorkspaceId
                    ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span className="truncate flex-1">{ws.title}</span>
                {ws.id === activeWorkspaceId && (
                  <svg className="w-3 h-3 text-indigo-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 p-2">
            {creating ? (
              <div className="flex gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                  placeholder="Workspace name..."
                  className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  className="px-2 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
