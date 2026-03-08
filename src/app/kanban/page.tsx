"use client";

/**
 * Kanban Board Page — /kanban
 *
 * Displays a drag-free Kanban board for local + GitHub issues.
 * Column status mapping: backlog | todo | in_progress | in_review | blocked | done
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KanbanStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface KanbanIssue {
  id: string;
  title: string;
  body: string;
  status: KanbanStatus;
  priority: IssuePriority;
  workspaceId: string;
  assigneeId?: string;
  labels: string[];
  githubNumber?: number;
  githubUrl?: string;
  githubState?: string;
  githubSyncedAt?: string;
  lastSyncError?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { id: KanbanStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "bg-gray-100 dark:bg-gray-800" },
  { id: "todo", label: "To Do", color: "bg-blue-50 dark:bg-blue-900/20" },
  { id: "in_progress", label: "In Progress", color: "bg-yellow-50 dark:bg-yellow-900/20" },
  { id: "in_review", label: "In Review", color: "bg-purple-50 dark:bg-purple-900/20" },
  { id: "blocked", label: "Blocked", color: "bg-red-50 dark:bg-red-900/20" },
  { id: "done", label: "Done", color: "bg-green-50 dark:bg-green-900/20" },
];

const PRIORITY_COLORS: Record<IssuePriority, string> = {
  urgent: "text-red-600 dark:text-red-400",
  high: "text-orange-500 dark:text-orange-400",
  medium: "text-yellow-500 dark:text-yellow-400",
  low: "text-blue-500 dark:text-blue-400",
  none: "text-gray-400",
};

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "—",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") ?? "default";

  const [issues, setIssues] = useState<KanbanIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<KanbanStatus>("backlog");
  const [dragging, setDragging] = useState<string | null>(null);

  // Fetch issues
  const fetchIssues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/github/issues?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error(`Failed to fetch issues: ${res.statusText}`);
      const data = await res.json();
      setIssues(data.issues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Move issue to a different column
  const moveIssue = useCallback(
    async (issueId: string, newStatus: KanbanStatus) => {
      // Optimistic update
      setIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, status: newStatus, updatedAt: new Date().toISOString() } : i))
      );

      try {
        const res = await fetch(`/api/github/issue/${issueId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (err) {
        // Rollback
        await fetchIssues();
        setError(err instanceof Error ? err.message : "Failed to update issue");
      }
    },
    [fetchIssues]
  );

  // Drag-and-drop handlers
  const handleDragStart = (issueId: string) => setDragging(issueId);
  const handleDragEnd = () => setDragging(null);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent, status: KanbanStatus) => {
    e.preventDefault();
    if (dragging) {
      moveIssue(dragging, status);
      setDragging(null);
    }
  };

  const issuesByStatus = (status: KanbanStatus) =>
    issues.filter((i) => i.status === status);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 dark:text-gray-400">
        Loading Kanban board…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="shrink-0 px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
          >
            ← Home
          </Link>
          <h1 className="text-base font-semibold">Kanban Board</h1>
          <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {issues.length} issues
          </span>
        </div>

        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-500">{error}</span>
          )}
          <button
            onClick={() => { setSelectedStatus("backlog"); setShowCreateModal(true); }}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            + New Issue
          </button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full gap-3 p-4 min-w-max">
          {COLUMNS.map((col) => (
            <div
              key={col.id}
              className={`w-64 flex flex-col rounded-lg ${col.color}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* Column header */}
              <div className="px-3 py-2 flex items-center justify-between border-b border-black/5 dark:border-white/5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                  {col.label}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {issuesByStatus(col.id).length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {issuesByStatus(col.id).map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onDragStart={() => handleDragStart(issue.id)}
                    onDragEnd={handleDragEnd}
                    onMove={moveIssue}
                  />
                ))}
                {issuesByStatus(col.id).length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-4">No issues</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <CreateIssueModal
          workspaceId={workspaceId}
          initialStatus={selectedStatus}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchIssues}
        />
      )}
    </div>
  );
}

// ─── IssueCard ────────────────────────────────────────────────────────────────

function IssueCard({
  issue,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  issue: KanbanIssue;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (id: string, status: KanbanStatus) => void;
}) {

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white dark:bg-gray-900 rounded-md p-3 shadow-sm border border-gray-200 dark:border-gray-700 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm font-medium leading-snug line-clamp-2">{issue.title}</span>
        {issue.githubNumber && (
          <a
            href={issue.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            #{issue.githubNumber}
          </a>
        )}
      </div>

      {/* Labels */}
      {issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {issue.labels.map((label) => (
            <span
              key={label}
              className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs font-medium ${PRIORITY_COLORS[issue.priority]}`}>
          {PRIORITY_LABELS[issue.priority]}
        </span>

        {/* Quick-move dropdown */}
        <select
          className="text-xs bg-transparent border-none text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300"
          value={issue.status}
          onChange={(e) => onMove(issue.id, e.target.value as KanbanStatus)}
          onClick={(e) => e.stopPropagation()}
        >
          {COLUMNS.map((col) => (
            <option key={col.id} value={col.id}>
              {col.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sync error */}
      {issue.lastSyncError && (
        <div className="mt-1 text-xs text-red-400 truncate" title={issue.lastSyncError}>
          ⚠ {issue.lastSyncError}
        </div>
      )}
    </div>
  );
}

// ─── CreateIssueModal ─────────────────────────────────────────────────────────

function CreateIssueModal({
  workspaceId,
  initialStatus,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  initialStatus: KanbanStatus;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<KanbanStatus>(initialStatus);
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/github/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body,
          status,
          priority,
          workspaceId,
          labels: labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create issue");
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold mb-4">New Issue</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Issue title"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Description
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional description…"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as KanbanStatus)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-transparent"
              >
                {COLUMNS.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-transparent"
              >
                {(["urgent", "high", "medium", "low", "none"] as IssuePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Labels (comma-separated)
            </label>
            <input
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="bug, enhancement…"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Creating…" : "Create Issue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
