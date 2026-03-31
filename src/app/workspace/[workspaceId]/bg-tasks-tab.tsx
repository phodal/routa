"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { OverlayModal, BgTaskStatusIcon, bgTaskStatusClass, formatRelativeTime } from "./ui-components";
import { useTranslation } from "@/i18n";
import type { BackgroundTaskInfo } from "./types";

interface BgTasksTabProps {
  bgTasks: BackgroundTaskInfo[];
  workspaceId: string;
  workspaces: Array<{ id: string; title: string }>;
  onRefresh: () => void;
}

export function BgTasksTab({ bgTasks, workspaceId, workspaces, onRefresh }: BgTasksTabProps) {
  const { t } = useTranslation();
  const router = useRouter();

  const [specialists, setSpecialists] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [bgTaskFilter, setBgTaskFilter] = useState<"all" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED">("all");
  const [bgSourceFilter, setBgSourceFilter] = useState<"all" | "manual" | "schedule" | "webhook" | "polling" | "workflow" | "fleet">("all");
  const [bgAutoRefresh, setBgAutoRefresh] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Fetch specialists for agent selector
  useEffect(() => {
    fetch("/api/specialists")
      .then((r) => r.json())
      .then((d) => setSpecialists((d.specialists ?? []).filter((s: { enabled?: boolean }) => s.enabled !== false)))
      .catch(() => { });
  }, []);

  // Auto-refresh every 10s when enabled
  useEffect(() => {
    if (!bgAutoRefresh) return;
    const timer = setInterval(() => onRefresh(), 10_000);
    return () => clearInterval(timer);
  }, [bgAutoRefresh, onRefresh]);

  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [dispatchPriority, setDispatchPriority] = useState("NORMAL");
  const [dispatchTitle, setDispatchTitle] = useState("");
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [dispatchWorkspaceId, setDispatchWorkspaceId] = useState(workspaceId);

  // Edit modal state
  const [editingTask, setEditingTask] = useState<BackgroundTaskInfo | null>(null);
  const [editForm, setEditForm] = useState({ title: "", prompt: "", agentId: "", priority: "NORMAL" });
  const [editLoading, setEditLoading] = useState(false);

  const handleDispatchTask = async () => {
    if (!dispatchPrompt.trim() || !dispatchAgentId.trim()) return;
    setDispatchLoading(true);
    try {
      await fetch("/api/background-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: dispatchPrompt,
          agentId: dispatchAgentId,
          workspaceId: dispatchWorkspaceId || workspaceId,
          title: dispatchTitle.trim() || dispatchPrompt.slice(0, 80),
          priority: dispatchPriority,
        }),
      });
      setShowDispatchModal(false);
      setDispatchPrompt("");
      setDispatchAgentId("");
      setDispatchTitle("");
      setDispatchPriority("NORMAL");
      setDispatchWorkspaceId(workspaceId);
      setDuplicateWarning(null);
      onRefresh();
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleRerunTask = async (task: BackgroundTaskInfo) => {
    await fetch("/api/background-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: task.prompt,
        agentId: task.agentId,
        workspaceId,
        title: task.title,
        priority: task.priority ?? "NORMAL",
        triggerSource: "manual",
        triggeredBy: "rerun",
      }),
    });
    onRefresh();
  };

  const handleCheckDuplicate = (prompt: string, agentId: string) => {
    if (!prompt.trim() || !agentId.trim()) { setDuplicateWarning(null); return; }
    const promptKey = prompt.trim().slice(0, 120).toLowerCase();
    const dupe = bgTasks.find(
      (t) =>
        t.status === "PENDING" &&
        t.agentId === agentId.trim() &&
        t.prompt.slice(0, 120).toLowerCase() === promptKey
    );
    setDuplicateWarning(dupe ? `Duplicate: task "${dupe.title}" is already PENDING.` : null);
  };

  const handleEditTask = async () => {
    if (!editingTask) return;
    setEditLoading(true);
    try {
      await fetch(`/api/background-tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      setEditingTask(null);
      onRefresh();
    } finally {
      setEditLoading(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}`, { method: "DELETE" });
    onRefresh();
  };

  const handleForceFailTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}?force=true`, { method: "DELETE" });
    onRefresh();
  };

  const handleDeleteTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}`, { method: "DELETE" });
    onRefresh();
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      const terminalStatuses = ["COMPLETED", "CANCELLED", "FAILED"];
      const requests: Promise<Response>[] = terminalStatuses.map((status) =>
        fetch("/api/background-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteByStatus", status, workspaceId }),
        })
      );
      requests.push(
        fetch("/api/background-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteByStatus", status: "PENDING", workspaceId }),
        })
      );
      await Promise.all(requests);
      onRefresh();
    } finally {
      setClearingHistory(false);
    }
  };

  let filtered = bgTaskFilter === "all" ? bgTasks : bgTasks.filter((t) => t.status === bgTaskFilter);
  if (bgSourceFilter !== "all") filtered = filtered.filter((t) => (t.triggerSource ?? "manual") === bgSourceFilter);

  return (
    <div className="space-y-4">
      {/* ── Header row ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">{t.bgTasks.title}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBgAutoRefresh((v) => !v)}
            title={bgAutoRefresh ? t.bgTasks.autoRefreshOn : t.bgTasks.autoRefreshOff}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${bgAutoRefresh
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-[#191c28]"
              }`}
          >
            <svg className={`w-3.5 h-3.5 ${bgAutoRefresh ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {bgAutoRefresh ? t.bgTasks.live : t.common.refresh}
          </button>
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
            title={t.bgTasks.refreshNow}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {(() => {
            const clearableCount = bgTasks.filter((t) =>
              ["COMPLETED", "CANCELLED", "FAILED", "PENDING"].includes(t.status)
            ).length;
            if (clearableCount === 0) return null;
            const hasPending = bgTasks.some((t) => t.status === "PENDING");
            return (
              <button
                onClick={handleClearHistory}
                disabled={clearingHistory}
                title={`Clear ${clearableCount} tasks: all PENDING + COMPLETED/CANCELLED/FAILED`}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {clearingHistory ? t.bgTasks.clearing : `${hasPending ? t.bgTasks.clearAll : t.bgTasks.clearHistory} (${clearableCount})`}
              </button>
            );
          })()}
          <button
            data-testid="dispatch-task-btn"
            onClick={() => setShowDispatchModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t.bgTasks.dispatchNow}
          </button>
        </div>
      </div>

      {/* ── Stats / filter bar ─────────────────────────────── */}
      {bgTasks.length > 0 && (() => {
        const counts = { PENDING: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
        for (const t of bgTasks) { if (t.status in counts) (counts as Record<string, number>)[t.status]++; }
        const srcCounts: Record<string, number> = {};
        for (const t of bgTasks) { srcCounts[t.triggerSource ?? "manual"] = (srcCounts[t.triggerSource ?? "manual"] ?? 0) + 1; }
        return (
          <div className="space-y-1.5">
            <div className="flex gap-2 flex-wrap">
              {(["all", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const).map((s) => {
                const cnt = s === "all" ? bgTasks.length : counts[s];
                if (s !== "all" && cnt === 0) return null;
                const active = bgTaskFilter === s;
                const colorMap: Record<string, string> = {
                  all: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
                  PENDING: "bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400",
                  RUNNING: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
                  COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
                  FAILED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
                  CANCELLED: "bg-slate-100 dark:bg-slate-700/30 text-slate-400",
                };
                return (
                  <button
                    key={s}
                    onClick={() => setBgTaskFilter(s)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${active
                        ? "ring-2 ring-amber-400 border-amber-400 " + colorMap[s]
                        : "border-transparent " + colorMap[s] + " hover:opacity-80"
                      }`}
                  >
                    <span className="capitalize">{s === "all" ? t.bgTasks.all : s.charAt(0) + s.slice(1).toLowerCase()}</span>
                    <span className="font-bold">{cnt}</span>
                  </button>
                );
              })}
            </div>
            {Object.keys(srcCounts).length > 1 && (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[10px] text-slate-400 dark:text-slate-600 mr-0.5">Source:</span>
                {(["all", "manual", "schedule", "webhook", "polling", "workflow", "fleet"] as const).map((src) => {
                  const cnt = src === "all" ? bgTasks.length : (srcCounts[src] ?? 0);
                  if (src !== "all" && cnt === 0) return null;
                  const active = bgSourceFilter === src;
                  const srcLabel: Record<string, string> = { all: t.bgTasks.all, manual: t.bgTasks.manual, schedule: t.bgTasks.scheduled, webhook: t.bgTasks.webhook, polling: t.bgTasks.polling, workflow: t.bgTasks.workflow, fleet: t.bgTasks.fleet };
                  const srcColor: Record<string, string> = {
                    all: "text-slate-500 dark:text-slate-400",
                    manual: "text-slate-600 dark:text-slate-400",
                    schedule: "text-amber-600 dark:text-amber-400",
                    webhook: "text-blue-600 dark:text-blue-400",
                    polling: "text-emerald-600 dark:text-emerald-400",
                    workflow: "text-blue-600 dark:text-blue-400",
                    fleet: "text-pink-600 dark:text-pink-400",
                  };
                  return (
                    <button
                      key={src}
                      onClick={() => setBgSourceFilter(src)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${active
                          ? "border-amber-400 ring-1 ring-amber-400 " + srcColor[src]
                          : "border-slate-200 dark:border-[#252838] " + srcColor[src] + " hover:opacity-80"
                        }`}
                    >
                      {srcLabel[src]} <span className="opacity-70">{cnt}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Task list ─────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600">
          <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[13px]">{bgTasks.length === 0 ? t.bgTasks.noTasksYet : t.bgTasks.noFilteredTasks}</p>
          {bgTasks.length === 0 && <p className="text-[11px] mt-1">Click &ldquo;Dispatch Task&rdquo; to enqueue one.</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200/60 dark:border-[#191c28] bg-white dark:bg-[#0e1019] overflow-hidden divide-y divide-slate-100 dark:divide-[#191c28]">
          {filtered.map((task) => {
            const isExpanded = expandedTaskId === task.id;
            return (
              <div key={task.id} data-testid="bg-task-item">
                <div className="flex items-start gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity"
                    title={isExpanded ? t.bgTasks.collapse : t.bgTasks.expand}
                  >
                    <BgTaskStatusIcon status={task.status} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">{task.title}</div>
                      {task.priority && task.priority !== "NORMAL" && (
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${task.priority === "HIGH"
                            ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}>
                          {task.priority}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-2 flex-wrap">
                      <span className="font-mono">{task.agentId}</span>
                      {task.triggerSource && <><span>·</span><span className="capitalize">{task.triggerSource}</span></>}
                      {task.status === "RUNNING" && task.toolCallCount !== undefined && task.toolCallCount > 0 && (
                        <><span>·</span><span className="text-amber-600 dark:text-amber-400">{task.toolCallCount} tools</span></>
                      )}
                      {task.status === "RUNNING" && task.currentActivity && (
                        <><span>·</span><span className="text-amber-600 dark:text-amber-400 truncate max-w-[200px]">{task.currentActivity}</span></>
                      )}
                      {task.resultSessionId && (
                        <><span>·</span>
                          <button
                            onClick={() => router.push(`/workspace/${workspaceId}/sessions/${task.resultSessionId}`)}
                            className="text-blue-500 dark:text-blue-400 hover:underline"
                          >
                            view session
                          </button></>
                      )}
                      {task.errorMessage && (
                        <><span>·</span><span className="text-red-500 dark:text-red-400 truncate max-w-[240px]" title={task.errorMessage}>{task.errorMessage}</span></>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span data-testid="bg-task-status" className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${bgTaskStatusClass(task.status)}`}>
                      {task.status}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono w-12 text-right">{formatRelativeTime(task.createdAt)}</span>
                    {task.status === "PENDING" && (
                      <button
                        onClick={() => {
                          setEditingTask(task);
                          setEditForm({ title: task.title, prompt: task.prompt, agentId: task.agentId, priority: task.priority ?? "NORMAL" });
                        }}
                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#191c28] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        title={t.bgTasks.editTask}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                    )}
                    {["COMPLETED", "CANCELLED", "FAILED"].includes(task.status) && (
                      <button
                        onClick={() => handleRerunTask(task)}
                        className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                        title={t.bgTasks.reDispatch}
                      >
                        ↺ Rerun
                      </button>
                    )}
                    {task.status === "FAILED" && task.attempts < task.maxAttempts && (
                      <button
                        onClick={async () => {
                          await fetch(`/api/background-tasks/${task.id}/retry`, { method: "POST" });
                          onRefresh();
                        }}
                        className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                        title={t.bgTasks.retry}
                      >
                        {t.common.retry}
                      </button>
                    )}
                    {(task.status === "PENDING" || task.status === "RUNNING") && (
                      <button
                        onClick={() => handleCancelTask(task.id)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors"
                        title="Cancel task"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    {["COMPLETED", "CANCELLED", "FAILED"].includes(task.status) && (
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete task"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-3 pt-0 border-t border-dashed border-slate-100 dark:border-[#252838] bg-slate-50/50 dark:bg-[#0a0c12]/30">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5 mt-2">
                      <div><span className="font-semibold text-slate-600 dark:text-slate-300">Prompt:</span> <span className="whitespace-pre-wrap">{task.prompt}</span></div>
                      <div className="flex gap-4 flex-wrap">
                        <span><span className="font-semibold">ID:</span> <code className="font-mono text-[10px]">{task.id}</code></span>
                        <span><span className="font-semibold">Attempts:</span> {task.attempts}/{task.maxAttempts}</span>
                        {task.inputTokens !== undefined && task.inputTokens > 0 && (
                          <span><span className="font-semibold">Tokens:</span> {task.inputTokens}↑ {task.outputTokens}↓</span>
                        )}
                        {task.startedAt && <span><span className="font-semibold">Started:</span> {formatRelativeTime(task.startedAt)}</span>}
                        {task.completedAt && <span><span className="font-semibold">Completed:</span> {formatRelativeTime(task.completedAt)}</span>}
                      </div>
                      {task.errorMessage && (
                        <div className="text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded text-[11px]">
                          <span className="font-semibold">Error:</span> {task.errorMessage}
                        </div>
                      )}
                      {task.status === "RUNNING" && task.startedAt &&
                        Date.now() - new Date(task.startedAt).getTime() > 30 * 60 * 1000 && (
                          <div className="pt-1">
                            <button
                              onClick={() => handleForceFailTask(task.id)}
                              className="text-[10px] font-medium px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors"
                              title="Force-fail this task — use when the session is gone but the task is still marked RUNNING"
                            >
                              ⚠ Force Fail (stale)
                            </button>
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

      {/* ── Dispatch modal ────────────────────────────────── */}
      {showDispatchModal && (
        <OverlayModal onClose={() => { setShowDispatchModal(false); setDuplicateWarning(null); }} title="Dispatch Background Task">
          <div className="space-y-3 p-4">
            {duplicateWarning && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <span className="text-[12px] text-amber-700 dark:text-amber-400">{duplicateWarning}</span>
              </div>
            )}
            <div>
              <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Title <span className="text-slate-400">(optional)</span></label>
              <input
                type="text"
                placeholder="Short task title…"
                value={dispatchTitle}
                onChange={(e) => setDispatchTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Prompt</label>
              <textarea
                data-testid="dispatch-prompt-input"
                rows={4}
                placeholder="Enter the task prompt…"
                value={dispatchPrompt}
                onChange={(e) => { setDispatchPrompt(e.target.value); handleCheckDuplicate(e.target.value, dispatchAgentId); }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Agent / Provider</label>
                {specialists.length > 0 ? (
                  <select
                    data-testid="dispatch-agent-input"
                    value={dispatchAgentId}
                    onChange={(e) => { setDispatchAgentId(e.target.value); handleCheckDuplicate(dispatchPrompt, e.target.value); }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  >
                    <option value="">— Select agent —</option>
                    {specialists.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    data-testid="dispatch-agent-input"
                    type="text"
                    placeholder="e.g. opencode, claude"
                    value={dispatchAgentId}
                    onChange={(e) => { setDispatchAgentId(e.target.value); handleCheckDuplicate(dispatchPrompt, e.target.value); }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                )}
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Priority</label>
                <select
                  value={dispatchPriority}
                  onChange={(e) => setDispatchPriority(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Workspace</label>
              <select
                value={dispatchWorkspaceId}
                onChange={(e) => setDispatchWorkspaceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.title || w.id}{w.id === workspaceId ? " (current)" : ""}</option>
                ))}
                {workspaces.length === 0 && (
                  <option value={workspaceId}>{workspaceId} (current)</option>
                )}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowDispatchModal(false); setDuplicateWarning(null); }}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                data-testid="dispatch-submit-btn"
                onClick={handleDispatchTask}
                disabled={dispatchLoading || !dispatchPrompt.trim() || !dispatchAgentId.trim()}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
              >
                {dispatchLoading ? t.bgTasks.dispatching : t.bgTasks.dispatchNow}
              </button>
            </div>
          </div>
        </OverlayModal>
      )}

      {/* ── Edit modal ────────────────────────────────────── */}
      {editingTask && (
        <OverlayModal onClose={() => setEditingTask(null)} title="Edit Task">
          <div className="space-y-3 p-4">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Prompt</label>
              <textarea
                rows={5}
                value={editForm.prompt}
                onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Agent</label>
                {specialists.length > 0 ? (
                  <select
                    value={editForm.agentId}
                    onChange={(e) => setEditForm((f) => ({ ...f, agentId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  >
                    <option value="">— Select agent —</option>
                    {specialists.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={editForm.agentId}
                    onChange={(e) => setEditForm((f) => ({ ...f, agentId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                )}
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-1">Priority</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#151720] text-[13px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditingTask(null)}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleEditTask}
                disabled={editLoading || !editForm.prompt.trim() || !editForm.agentId.trim()}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
              >
                {editLoading ? t.notesTab.saving : t.common.save}
              </button>
            </div>
          </div>
        </OverlayModal>
      )}
    </div>
  );
}
