"use client";

/**
 * Messages Page - Notification & PR Agent Execution History
 * 
 * Shows:
 * - All notifications with filtering
 * - PR Agent execution history from background tasks
 * - Webhook trigger logs
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


interface BackgroundTask {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  type: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface TriggerLog {
  id: string;
  configId: string;
  eventType: string;
  eventAction?: string;
  backgroundTaskId?: string;
  signatureValid: boolean;
  outcome: "triggered" | "skipped" | "error";
  errorMessage?: string;
  createdAt: string;
}

export default function MessagesPage() {
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces();
  const [tab, setTab] = useState<"tasks" | "logs">("tasks");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [loading, setLoading] = useState(false);
  const effectiveWorkspaceId = selectedWorkspaceId || workspaces[0]?.id || "";

  useEffect(() => {
    if (!effectiveWorkspaceId) {
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const [tasksRes, logsRes] = await Promise.all([
          desktopAwareFetch(`/api/background-tasks?workspaceId=${encodeURIComponent(effectiveWorkspaceId)}&limit=50`),
          desktopAwareFetch("/api/webhooks/logs?limit=50"),
        ]);
        if (tasksRes.ok) setTasks((await tasksRes.json()).tasks ?? []);
        if (logsRes.ok) setLogs((await logsRes.json()).logs ?? []);
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchData();
  }, [effectiveWorkspaceId]);

  const formatTime = (ts: string) => new Date(ts).toLocaleString();

  const getStatusBadge = (status: BackgroundTask["status"]) => {
    const colors: Record<string, string> = {
      pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[status] ?? colors.pending}`}>{status}</span>;
  };

  const getOutcomeBadge = (outcome: TriggerLog["outcome"]) => {
    const colors: Record<string, string> = {
      triggered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      skipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[outcome] ?? ""}`}>{outcome}</span>;
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0c12]">
      {/* Header */}
      <header className="h-12 border-b border-slate-100 dark:border-[#151720] flex items-center px-5 sticky top-0 bg-[#fafafa]/90 dark:bg-[#0a0c12]/90 backdrop-blur-sm z-10">
        <Link href="/" className="flex items-center gap-2.5 mr-6">
          <Image src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">Messages</span>
        </Link>
        <div className="flex gap-1">
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspaceId={effectiveWorkspaceId || null}
            onSelect={setSelectedWorkspaceId}
            onCreate={async (title) => {
              const workspace = await createWorkspace(title);
              if (workspace?.id) {
                setSelectedWorkspaceId(workspace.id);
              }
            }}
            loading={workspacesLoading}
          />
          <button
            onClick={() => setTab("tasks")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "tasks" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
          >
            Background Tasks
          </button>
          <button
            onClick={() => setTab("logs")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "logs" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
          >
            Webhook Logs
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto p-6">
        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        ) : tab === "tasks" ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">PR Agent & Background Tasks</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No background tasks yet</p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="p-4 bg-white dark:bg-[#12141c] border border-slate-100 dark:border-[#1c1f2e] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
                    {getStatusBadge(t.status)}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500">
                    <span>Type: {t.type}</span>
                    <span>Created: {formatTime(t.createdAt)}</span>
                    {t.completedAt && <span>Completed: {formatTime(t.completedAt)}</span>}
                  </div>
                  {t.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t.error}</p>}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Webhook Trigger Logs</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No webhook logs yet</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="p-4 bg-white dark:bg-[#12141c] border border-slate-100 dark:border-[#1c1f2e] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{l.eventType}{l.eventAction ? `:${l.eventAction}` : ""}</span>
                    {getOutcomeBadge(l.outcome)}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500">
                    <span>Config: {l.configId.slice(0, 8)}</span>
                    <span>Signature: {l.signatureValid ? "✓" : "✗"}</span>
                    <span>{formatTime(l.createdAt)}</span>
                  </div>
                  {l.errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{l.errorMessage}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
