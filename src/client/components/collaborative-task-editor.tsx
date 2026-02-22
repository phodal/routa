"use client";

/**
 * CollaborativeTaskEditor - Real-time collaborative task editing panel.
 *
 * Displays task notes from the Notes system with real-time SSE updates.
 * When ROUTA creates tasks, they appear here and can be edited by
 * both the user and agents simultaneously (CRDT-backed).
 *
 * Features:
 * - Live task list synced from server Notes
 * - Inline editing with debounced save
 * - Real-time updates from agents via SSE
 * - Visual indicators for agent vs user changes
 * - Task status management
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { NoteData } from "../hooks/use-notes";
import { MarkdownViewer } from "./markdown/markdown-viewer";

interface CollaborativeTaskEditorProps {
  notes: NoteData[];
  connected: boolean;
  onUpdateNote: (
    noteId: string,
    update: { title?: string; content?: string; metadata?: Record<string, unknown> }
  ) => Promise<NoteData | null>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  /** The workspace ID for context */
  workspaceId?: string;
}

export function CollaborativeTaskEditor({
  notes,
  connected,
  onUpdateNote,
  onDeleteNote,
  workspaceId = "default",
}: CollaborativeTaskEditorProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  // Filter task notes and spec note
  const taskNotes = useMemo(
    () => notes.filter((n) => n.metadata.type === "task"),
    [notes]
  );
  const specNote = useMemo(
    () => notes.find((n) => n.metadata.type === "spec"),
    [notes]
  );

  if (taskNotes.length === 0 && !specNote) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Collaborative Tasks
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300">
              {taskNotes.length}
            </span>
          </div>

          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? "bg-green-500" : "bg-gray-400"
              }`}
            />
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {connected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {/* CRDT badge */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
            CRDT
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Real-time collaborative editing
          </span>
        </div>
      </div>

      {/* Spec Note (if exists) */}
      {specNote && specNote.content && (
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-900/10">
          <div className="flex items-center gap-1.5 mb-1">
            <svg
              className="w-3 h-3 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              Spec
            </span>
          </div>
          <div className="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-3">
            <MarkdownViewer
              content={specNote.content.slice(0, 300)}
              className="text-[11px]"
            />
          </div>
        </div>
      )}

      {/* Task Notes List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {taskNotes.map((note, index) => (
            <TaskNoteCard
              key={note.id}
              note={note}
              index={index}
              expanded={expandedNoteId === note.id}
              editing={editingNoteId === note.id}
              onToggleExpand={() =>
                setExpandedNoteId((prev) =>
                  prev === note.id ? null : note.id
                )
              }
              onEdit={() => setEditingNoteId(note.id)}
              onCancelEdit={() => setEditingNoteId(null)}
              onSave={async (update) => {
                await onUpdateNote(note.id, update);
                setEditingNoteId(null);
              }}
              onDelete={
                onDeleteNote
                  ? () => onDeleteNote(note.id)
                  : undefined
              }
              onStatusChange={async (status) => {
                await onUpdateNote(note.id, {
                  metadata: { ...note.metadata, taskStatus: status },
                });
              }}
            />
          ))}

          {taskNotes.length === 0 && (
            <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
              <div className="space-y-1.5">
                <div className="text-sm">No task notes yet</div>
                <div>Tasks will appear here when ROUTA creates them</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Task Note Card ────────────────────────────────────────────────────

interface TaskNoteCardProps {
  note: NoteData;
  index: number;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (update: { title?: string; content?: string }) => Promise<void>;
  onDelete?: () => void;
  onStatusChange: (status: string) => Promise<void>;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: {
    label: "Pending",
    color: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700",
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800",
  },
  COMPLETED: {
    label: "Completed",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800",
  },
  FAILED: {
    label: "Failed",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800",
  },
};

function TaskNoteCard({
  note,
  index,
  expanded,
  editing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onStatusChange,
}: TaskNoteCardProps) {
  const status = note.metadata.taskStatus ?? "PENDING";
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.PENDING;

  const statusIcon = {
    PENDING: (
      <div className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />
    ),
    IN_PROGRESS: (
      <div className="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center flex-shrink-0 animate-pulse">
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      </div>
    ),
    COMPLETED: (
      <div className="w-5 h-5 rounded-md bg-green-500 flex items-center justify-center flex-shrink-0">
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
    ),
    FAILED: (
      <div className="w-5 h-5 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0">
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
    ),
  };

  return (
    <div className={`rounded-lg border transition-all ${statusInfo.bg}`}>
      {/* Header */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
        onClick={onToggleExpand}
      >
        {statusIcon[status as keyof typeof statusIcon] ?? statusIcon.PENDING}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500">
              #{index + 1}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {note.title}
            </span>
          </div>
          {!expanded && note.content && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
              {note.content.slice(0, 100)}
            </p>
          )}
          {/* Last updated */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-gray-400 dark:text-gray-500">
              {new Date(note.updatedAt).toLocaleTimeString()}
            </span>
            {note.metadata.assignedAgentIds &&
              note.metadata.assignedAgentIds.length > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
                  Agent: {note.metadata.assignedAgentIds.join(", ")}
                </span>
              )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 mt-0.5 ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700/50">
          {editing ? (
            <TaskNoteEditor
              note={note}
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          ) : (
            <>
              <div className="mt-2.5 text-xs">
                <MarkdownViewer
                  content={note.content || "*No content*"}
                  className="text-gray-600 dark:text-gray-300"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/50">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Edit
                </button>

                {/* Status dropdown */}
                <select
                  value={status}
                  onChange={(e) => {
                    e.stopPropagation();
                    onStatusChange(e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  <option value="PENDING">Pending</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="FAILED">Failed</option>
                </select>

                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-xs font-medium px-2.5 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Note Editor ──────────────────────────────────────────────────

function TaskNoteEditor({
  note,
  onSave,
  onCancel,
}: {
  note: NoteData;
  onSave: (update: { title?: string; content?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update local state when note changes from SSE (collaborative edit)
  useEffect(() => {
    // Only update if not currently being edited by user
    if (!saving) {
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note.title, note.content, saving]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave({ title, content });
    } finally {
      setSaving(false);
    }
  }, [title, content, onSave]);

  // Debounced auto-save for content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          // Auto-save via API (don't close editor)
          const res = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              noteId: note.id,
              content: newContent,
              workspaceId: note.workspaceId,
              source: "user",
            }),
          });
          if (!res.ok) console.warn("Auto-save failed:", res.status);
        } catch (err) {
          console.warn("Auto-save error:", err);
        }
      }, 1500);
    },
    [note.id, note.workspaceId]
  );

  return (
    <div className="mt-2.5 space-y-2">
      <div>
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
          Title
        </label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          rows={8}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-emerald-500 outline-none resize-y font-mono"
          placeholder="Task content (Markdown supported)..."
        />
        <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">
          Auto-saves after 1.5s of inactivity
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save & Close"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
