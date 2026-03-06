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

import { useState, useRef, useCallback, useMemo } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import type { NoteData } from "../hooks/use-notes";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { type CrafterAgent } from "./task-panel";

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
  /** CRAFTER agents spawned from tasks */
  crafterAgents?: CrafterAgent[];
  /** Callback when user clicks a task note that may map to a crafter */
  onSelectTaskNote?: (noteId: string) => void;
  /** Execute a single task note */
  onExecuteTask?: (noteId: string) => Promise<unknown>;
  /** Execute a selected subset of task notes */
  onExecuteSelected?: (noteIds: string[], concurrency: number) => Promise<void>;
  /** Execute all pending task notes */
  onExecuteAll?: (concurrency: number) => void;
  /** Current concurrency setting */
  concurrency?: number;
  /** Callback when concurrency changes */
  onConcurrencyChange?: (n: number) => void;
}

export function CollaborativeTaskEditor({
  notes,
  connected,
  onUpdateNote,
  onDeleteNote,
  workspaceId,
  crafterAgents = [],
  onSelectTaskNote,
  onExecuteTask,
  onExecuteSelected,
  onExecuteAll,
  concurrency = 1,
  onConcurrencyChange,
}: CollaborativeTaskEditorProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);

  // Filter task notes (spec is now shown in the dedicated Spec tab)
  const taskNotes = useMemo(
    () => notes.filter((n) => n.metadata.type === "task"),
    [notes]
  );

  if (taskNotes.length === 0) {
    return null;
  }

  const hasPending = taskNotes.some(
    (n) => !n.metadata.taskStatus || n.metadata.taskStatus === "PENDING"
  );
  const runningCrafterCount = crafterAgents.filter((agent) => agent.status === "running").length;
  const hasRunning = taskNotes.some((n) => n.metadata.taskStatus === "IN_PROGRESS") || runningCrafterCount > 0;

  const pendingNotes = taskNotes.filter(
    (n) => !n.metadata.taskStatus || n.metadata.taskStatus === "PENDING"
  );

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedNoteIds.size === pendingNotes.length) {
      setSelectedNoteIds(new Set());
    } else {
      setSelectedNoteIds(new Set(pendingNotes.map((n) => n.id)));
    }
  };

  const handleExecuteSelected = async () => {
    if (!onExecuteSelected) return;
    const ids = Array.from(selectedNoteIds);
    setSelectedNoteIds(new Set());
    await onExecuteSelected(ids, concurrency);
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Collaborative Tasks
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300">
              {taskNotes.length}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {hasRunning && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 animate-pulse">
                Executing{runningCrafterCount > 0 ? ` (${runningCrafterCount})` : ""}...
              </span>
            )}
            {pendingNotes.length > 0 && (
              <button
                onClick={toggleSelectAll}
                className="text-xs font-medium px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {selectedNoteIds.size === pendingNotes.length ? "Deselect All" : "Select All"}
              </button>
            )}
            {selectedNoteIds.size > 0 && onExecuteSelected && (
              <button
                onClick={handleExecuteSelected}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Execute Selected ({selectedNoteIds.size})
              </button>
            )}
            {hasPending && onExecuteAll && (
              <button
                onClick={() => onExecuteAll(concurrency)}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Execute All
              </button>
            )}
            {/* Connection indicator */}
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {connected ? "Live" : "Off"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
            CRDT
          </span>
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Concurrency
          </span>
          <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            {[1, 2].map((n) => (
              <button
                key={n}
                onClick={() => onConcurrencyChange?.(n)}
                className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  concurrency === n
                    ? "bg-emerald-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {taskNotes.map((note, index) => (
            <TaskNoteCard
              key={note.id}
              note={note}
              index={index}
              expanded={expandedNoteId === note.id}
              editing={editingNoteId === note.id}
              selected={selectedNoteIds.has(note.id)}
              onToggleSelect={() => toggleNoteSelection(note.id)}
              onToggleExpand={() => {
                onSelectTaskNote?.(note.id);
                setExpandedNoteId((prev) =>
                  prev === note.id ? null : note.id
                );
              }}
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
              onExecute={
                onExecuteTask
                  ? () => onExecuteTask(note.id)
                  : undefined
              }
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
  selected?: boolean;
  onToggleSelect?: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (update: { title?: string; content?: string }) => Promise<void>;
  onDelete?: () => void;
  onStatusChange: (status: string) => Promise<void>;
  onExecute?: () => void;
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

// ─── Parse task content into structured sections ────────────────────────────
interface ParsedTaskSections {
  objective?: string;
  scope?: string;
  inputs?: string;
  outputs?: string;
  definitionOfDone?: string;
  remainingContent?: string;
}

const SECTION_NAMES = ["Objective", "Scope", "Inputs", "Outputs", "Definition of Done", "Acceptance Criteria"];

function parseTaskContent(content: string): ParsedTaskSections {
  const sections: ParsedTaskSections = {};
  let remaining = content;

  // Map section names to their normalized keys
  const sectionKeyMap: Record<string, keyof ParsedTaskSections> = {
    "objective": "objective",
    "scope": "scope",
    "inputs": "inputs",
    "outputs": "outputs",
    "definitionofdone": "definitionOfDone",
    "acceptancecriteria": "definitionOfDone",
  };

  for (const name of SECTION_NAMES) {
    const pattern = new RegExp(
      `(?:^|\\n)(?:#+\\s*)?(?:\\*\\*)?${name}(?:\\*\\*)?[:\\s]*\\n([\\s\\S]*?)(?=(?:\\n(?:#+\\s*)?(?:\\*\\*)?(?:${SECTION_NAMES.join("|")})(?:\\*\\*)?[:\\s]*\\n)|$)`,
      "i"
    );
    const match = content.match(pattern);
    if (match) {
      const rawKey = name.toLowerCase().replace(/\s+/g, "");
      const normalizedKey = sectionKeyMap[rawKey];
      if (normalizedKey) {
        sections[normalizedKey] = match[1].trim();
        remaining = remaining.replace(match[0], "");
      }
    }
  }

  // Get remaining content that's not in any section
  remaining = remaining.trim();
  if (remaining && !sections.objective) {
    // If no objective found, treat remaining as objective
    sections.objective = remaining;
  } else if (remaining) {
    sections.remainingContent = remaining;
  }

  return sections;
}

// ─── Section Component for task content ─────────────────────────────────────
function TaskSection({ title, content }: { title: string; content: string }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500" />
        {title}
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-300 pl-2.5 border-l border-gray-200 dark:border-gray-700">
        <MarkdownViewer content={content} className="text-xs" />
      </div>
    </div>
  );
}

// ─── Task Content Renderer ──────────────────────────────────────────────────
function TaskContentRenderer({ content }: { content: string }) {
  if (!content) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 italic">
        No content
      </div>
    );
  }

  const sections = parseTaskContent(content);
  const hasSections = sections.objective || sections.scope || sections.inputs ||
                      sections.outputs || sections.definitionOfDone;

  if (!hasSections) {
    // No structured sections found, render as plain markdown
    return (
      <div className="text-xs text-gray-600 dark:text-gray-300">
        <MarkdownViewer content={content} className="text-xs" />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sections.objective && (
        <TaskSection title="Objective" content={sections.objective} />
      )}
      {sections.scope && (
        <TaskSection title="Scope" content={sections.scope} />
      )}
      {sections.inputs && (
        <TaskSection title="Inputs" content={sections.inputs} />
      )}
      {sections.outputs && (
        <TaskSection title="Outputs" content={sections.outputs} />
      )}
      {sections.definitionOfDone && (
        <TaskSection title="Definition of Done" content={sections.definitionOfDone} />
      )}
      {sections.remainingContent && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            <MarkdownViewer content={sections.remainingContent} className="text-xs" />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskNoteCard({
  note,
  index,
  expanded,
  editing,
  selected,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onStatusChange,
  onExecute,
}: TaskNoteCardProps) {
  const status = note.metadata.taskStatus ?? "PENDING";
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.PENDING;

  const statusIcon = {
    PENDING: (
      <div className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 shrink-0" />
    ),
    IN_PROGRESS: (
      <div className="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center shrink-0 animate-pulse">
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
      <div className="w-5 h-5 rounded-md bg-green-500 flex items-center justify-center shrink-0">
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
      <div className="w-5 h-5 rounded-md bg-red-500 flex items-center justify-center shrink-0">
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
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
        onClick={onToggleExpand}
      >
        {onToggleSelect && status === "PENDING" ? (
          <label
            className="shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect()}
              className="sr-only peer"
            />
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
              selected
                ? "bg-blue-600 border-blue-600"
                : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
            }`}>
              {selected && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </label>
        ) : (
          statusIcon[status as keyof typeof statusIcon] ?? statusIcon.PENDING
        )}
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
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete task"
            className="p-0.5 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform shrink-0 mt-0.5 ${
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
              <div className="mt-2.5 space-y-2">
                <TaskContentRenderer content={note.content || ""} />
              </div>

              {/* Actions */}
              <div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-700/50">
                <div className="flex flex-wrap items-center gap-1.5">
                {/* Execute button for pending tasks */}
                {(status === "PENDING") && onExecute && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExecute();
                    }}
                    className="text-[11px] font-medium px-2 py-1 rounded-md transition-colors bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Execute
                  </button>
                )}
                {status === "IN_PROGRESS" && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium animate-pulse px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-900/20">
                    Running...
                  </span>
                )}
                {status === "COMPLETED" && (
                  <span className="text-[11px] text-green-600 dark:text-green-400 font-medium flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 dark:bg-green-900/20">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Completed
                  </span>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="text-[11px] font-medium px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
                  className="min-w-29.5 text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
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
                    className="text-[11px] font-medium px-2 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Delete
                  </button>
                )}
                </div>
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
          const res = await desktopAwareFetch("/api/notes", {
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
