"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n";
import { formatRelativeTime, TaskStatusIcon } from "./ui-components";
import type { NoteData } from "@/client/hooks/use-notes";
import type { SessionInfo } from "./types";

export function NoteTasksTab({
  notes,
  loading,
  sessions: _sessions,
  onDeleteNote,
  onUpdateNoteMetadata,
  onDeleteAllTaskNotes,
}: {
  notes: NoteData[];
  loading: boolean;
  workspaceId: string;
  sessions: SessionInfo[];
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNoteMetadata: (noteId: string, metadata: Record<string, unknown>) => Promise<void>;
  onDeleteAllTaskNotes: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const specNotes = notes.filter(n => n.metadata?.type === "spec").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const taskNotes = notes.filter(n => n.metadata?.type === "task").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Group task notes by parentNoteId
  const tasksByParent = new Map<string, NoteData[]>();
  for (const task of taskNotes) {
    const parentId = task.metadata?.parentNoteId ?? "__orphan__";
    tasksByParent.set(parentId, [...(tasksByParent.get(parentId) ?? []), task]);
  }

  const [expandedSpec, setExpandedSpec] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatingNoteId, setUpdatingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "REVIEW_REQUIRED", "NEEDS_FIX", "COMPLETED", "BLOCKED", "CANCELLED"];

  const filteredTaskNotes = statusFilter === "all"
    ? taskNotes
    : taskNotes.filter(n => (n.metadata?.taskStatus ?? "PENDING").toUpperCase() === statusFilter);

  const statusColor = (status: string) => {
    const s = (status ?? "PENDING").toUpperCase();
    const map: Record<string, string> = {
      PENDING: "bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400",
      IN_PROGRESS: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
      REVIEW_REQUIRED: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
      NEEDS_FIX: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
      COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
      BLOCKED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
      CANCELLED: "bg-slate-100 dark:bg-slate-700/30 text-slate-400",
    };
    return map[s] ?? map.PENDING;
  };

  const handleStatusChange = async (noteId: string, newStatus: string) => {
    setUpdatingNoteId(noteId);
    try { await onUpdateNoteMetadata(noteId, { taskStatus: newStatus }); }
    finally { setUpdatingNoteId(null); }
  };

  const handleDelete = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try { await onDeleteNote(noteId); }
    finally { setDeletingNoteId(null); }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try { await onDeleteAllTaskNotes(); }
    finally { setClearingAll(false); }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t.notesTab.noteTasks}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Spec notes and their derived tasks — created from <code className="font-mono text-[10px]">@@@task</code> blocks
          </p>
        </div>
        {taskNotes.length > 0 && (
          <button onClick={handleClearAll} disabled={clearingAll}
            className="text-[11px] text-red-500 dark:text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
            {clearingAll ? t.notesTab.clearing : t.notesTab.clearTaskNotes}
          </button>
        )}
      </div>

      {/* ── Spec Notes ── */}
      {specNotes.length > 0 && (
        <div className="mb-8">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 flex items-center gap-2">
            <span>{t.notesTab.sourceSpecs}</span>
            <span className="font-mono text-slate-300 dark:text-slate-600">{specNotes.length}</span>
          </div>
          <div className="space-y-2">
            {specNotes.map((spec) => {
              const childTasks = tasksByParent.get(spec.id) ?? [];
              const isExpanded = expandedSpec === spec.id;
              const doneCount = childTasks.filter(t => (t.metadata?.taskStatus ?? "").toUpperCase() === "COMPLETED").length;
              return (
                <div key={spec.id} className="bg-white dark:bg-[#12141c] rounded-xl border border-blue-200/60 dark:border-blue-800/30 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors"
                    onClick={() => setExpandedSpec(isExpanded ? null : spec.id)}>
                    <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                    </svg>
                    <span className="flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">{spec.title}</span>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">Spec</span>
                    {childTasks.length > 0 && (
                      <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                        {doneCount}/{childTasks.length} done
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono shrink-0">{formatRelativeTime(spec.updatedAt)}</span>
                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-blue-100 dark:border-blue-800/20">
                      {spec.content ? (
                        <pre className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                          {spec.content.slice(0, 2000)}{spec.content.length > 2000 ? "\n…" : ""}
                        </pre>
                      ) : (
                        <p className="mt-3 text-[11px] text-slate-400 italic">(empty spec)</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Task Notes ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
            <span>{t.notesTab.taskNotes}</span>
            <span className="font-mono text-slate-300 dark:text-slate-600">{taskNotes.length}</span>
          </div>
        </div>

        {/* Status filter */}
        {taskNotes.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {(["all", ...TASK_STATUSES] as const).map((s) => {
              const cnt = s === "all" ? taskNotes.length : taskNotes.filter(n => (n.metadata?.taskStatus ?? "PENDING").toUpperCase() === s).length;
              if (s !== "all" && cnt === 0) return null;
              const active = statusFilter === s;
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${active
                      ? `ring-2 ring-emerald-400 border-emerald-400 ${statusColor(s)}`
                      : `border-transparent ${statusColor(s)} hover:opacity-80`
                    }`}>
                  <span>{s === "all" ? t.notesTab.all : s.replace(/_/g, " ")}</span>
                  <span className="font-bold ml-0.5">{cnt}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">Loading…</div>
        ) : filteredTaskNotes.length === 0 ? (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">
            <svg className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">{taskNotes.length === 0 ? t.notesTab.noTaskNotesYet : `${t.notesTab.noFilteredTasks} ${statusFilter.replace(/_/g, " ")}`}</p>
            {taskNotes.length === 0 && (
              <p className="text-[12px] mt-1">Add <code className="font-mono text-[10px]">@@@task</code> blocks to a spec note, then save it to generate tasks.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTaskNotes.map((task) => {
              const isExpanded = expandedTask === task.id;
              const parentSpec = specNotes.find(s => s.id === task.metadata?.parentNoteId);
              const status = task.metadata?.taskStatus ?? "PENDING";
              return (
                <div key={task.id} className="bg-white dark:bg-[#12141c] rounded-xl border border-slate-200/60 dark:border-[#1c1f2e] overflow-hidden hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => setExpandedTask(isExpanded ? null : task.id)} className="shrink-0">
                      <TaskStatusIcon status={status} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate block">{task.title}</span>
                      {parentSpec && (
                        <span className="text-[10px] text-blue-500 dark:text-blue-400 truncate block">↳ {parentSpec.title}</span>
                      )}
                    </div>
                    <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusColor(status)}`}>
                      {status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono shrink-0">{formatRelativeTime(task.updatedAt)}</span>
                    <select
                      value={status}
                      disabled={updatingNoteId === task.id}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="text-[10px] border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#0e1019] text-slate-600 dark:text-slate-400 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                    >
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                    </select>
                    <button onClick={() => handleDelete(task.id)} disabled={deletingNoteId === task.id}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button onClick={() => setExpandedTask(isExpanded ? null : task.id)} className="shrink-0">
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-100 dark:border-[#191c28]">
                      <div className="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-400">
                        <div><span className="font-semibold">{t.notesTab.noteId}</span> <code className="font-mono text-[11px]">{task.id}</code></div>
                        {task.metadata?.linkedTaskId && (
                          <div><span className="font-semibold">{t.notesTab.taskRecord}</span> <code className="font-mono text-[11px]">{task.metadata.linkedTaskId}</code></div>
                        )}
                        {task.metadata?.parentNoteId && (
                          <div><span className="font-semibold">{t.notesTab.parentSpec}</span> <code className="font-mono text-[11px]">{task.metadata.parentNoteId}</code></div>
                        )}
                        {task.metadata?.assignedAgentIds && task.metadata.assignedAgentIds.length > 0 && (
                          <div><span className="font-semibold">Assigned:</span> {task.metadata.assignedAgentIds.join(", ")}</div>
                        )}
                        {task.sessionId && <div><span className="font-semibold">Session:</span> <code className="font-mono text-[11px]">{task.sessionId}</code></div>}
                        <div><span className="font-semibold">Created:</span> {new Date(task.createdAt).toLocaleString()}</div>
                        {task.content && (
                          <div className="mt-2 p-3 bg-slate-50 dark:bg-[#0a0c12] rounded-lg">
                            <div className="text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">{t.notesTab.taskSpecContent}</div>
                            <pre className="text-[11px] whitespace-pre-wrap font-mono text-slate-500 dark:text-slate-400 max-h-48 overflow-y-auto">{task.content}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
