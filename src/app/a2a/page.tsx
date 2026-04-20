"use client";

/**
 * A2A Protocol Test Page - /a2a
 *
 * Interactive testing interface for the Agent-to-Agent (A2A) protocol.
 * - View agent card and capabilities
 * - Send messages to remote agents
 * - Monitor task status and responses
 * - Inspect A2A protocol events
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

interface AgentCard {
  name: string;
  description: string;
  version: string;
  url?: string;
  documentationUrl?: string;
  skills: AgentSkill[];
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

interface A2ATask {
  id: string;
  contextId?: string;
  status: {
    state: "submitted" | "working" | "completed" | "failed" | "canceled";
    message?: { parts: Array<{ text?: string }> };
    timestamp?: string;
  };
  history?: Array<{ role: string; parts: Array<{ text?: string }> }>;
  metadata?: { workspaceId?: string; userPrompt?: string };
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATE_STYLES: Record<string, { label: string; dot: string; badge: string }> = {
  submitted: { label: "Submitted", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  working:   { label: "Working",   dot: "bg-amber-400 animate-pulse", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  completed: { label: "Completed", dot: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed:    { label: "Failed",    dot: "bg-red-400", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  canceled:  { label: "Canceled",  dot: "bg-slate-400", badge: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: string }) {
  const s = STATE_STYLES[state] ?? STATE_STYLES.submitted;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SkillCard({ skill }: { skill: AgentSkill }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/50 p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-0.5">{skill.id}</p>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{skill.name}</h3>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 leading-relaxed">{skill.description}</p>
        </div>
      </div>
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {skill.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {tag}
            </span>
          ))}
        </div>
      )}
      {skill.examples && skill.examples.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-500 dark:text-blue-400 hover:underline"
          >
            {expanded ? "Hide examples" : `${skill.examples.length} example${skill.examples.length > 1 ? "s" : ""}`}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1">
              {skill.examples.map((ex, i) => (
                <li key={i} className="text-xs text-slate-500 dark:text-slate-400 pl-3 border-l-2 border-blue-200 dark:border-blue-800 italic">
                  {ex}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onSelect }: { task: A2ATask; onSelect: (t: A2ATask) => void }) {
  const prompt = task.metadata?.userPrompt ?? task.history?.[0]?.parts?.[0]?.text ?? "—";
  const ts = task.status.timestamp ? new Date(task.status.timestamp).toLocaleTimeString() : "";

  return (
    <button
      onClick={() => onSelect(task)}
      className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/50 px-4 py-3 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow transition-all group"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 truncate">{task.id.slice(0, 8)}…</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {ts && <span className="text-[11px] text-slate-400 dark:text-slate-500">{ts}</span>}
          <StatusBadge state={task.status.state} />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
        {prompt.length > 120 ? prompt.slice(0, 120) + "…" : prompt}
      </p>
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function A2APage() {
  const { t } = useTranslation();
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [selectedTask, setSelectedTask] = useState<A2ATask | null>(null);
  const [prompt, setPrompt] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [sendError, setSendError] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "card" | "skills">("tasks");
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch AgentCard ──
  useEffect(() => {
    fetch("/.well-known/agent-card.json")
      .then((r) => r.json())
      .then(setAgentCard)
      .catch(console.error);
  }, []);

  // ── Fetch Tasks ──
  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const r = await desktopAwareFetch(`/api/a2a/tasks${qs}`);
      if (r.ok) {
        const data = await r.json();
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (err) {
      console.error("fetchTasks error", err);
    } finally {
      setLoadingTasks(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    refreshRef.current = setInterval(fetchTasks, 5000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [fetchTasks]);

  // ── Send Message ──
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSending(true);
    setSendError("");
    try {
      const body = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "SendMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "user",
            parts: [{ text: prompt.trim() }],
          },
          metadata: workspaceId ? { workspaceId } : {},
        },
      };
      const r = await desktopAwareFetch("/api/a2a/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) {
        setSendError(data.error.message ?? "Failed to send message");
      } else {
        setPrompt("");
        // Refresh tasks immediately
        await fetchTasks();
        // Select the new task
        if (data.result?.task) {
          setSelectedTask(data.result.task);
          setActiveTab("tasks");
        }
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-amber-500 flex items-center justify-center text-white font-bold text-sm select-none">
              A2
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-slate-50 leading-none">
                {agentCard?.name ?? "A2A Protocol"}
              </h1>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Agent-to-Agent API</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
            {agentCard?.version && (
              <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">v{agentCard.version}</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Send message */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
              Send Message
            </h2>
            <form onSubmit={handleSend} className="space-y-3">
              <input
                type="text"
                placeholder={t.a2aPage.workspaceIdOptional}
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              />
              <textarea
                rows={3}
                placeholder={t.a2aPage.describeWhatYouNeed}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(e as unknown as React.FormEvent);
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
              />
              {sendError && (
                <p className="text-xs text-red-500 dark:text-red-400">{sendError}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400 dark:text-slate-500">⌘↵ to send</p>
                <button
                  type="submit"
                  disabled={sending || !prompt.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                  {sending ? (
                    <>
                      <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Sending…
                    </>
                  ) : "Send →"}
                </button>
              </div>
            </form>
          </section>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 p-1 w-fit">
            {(["tasks", "card", "skills"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {tab === "tasks" ? `Tasks${tasks.length > 0 ? ` (${tasks.length})` : ""}` : tab === "card" ? "Agent Card" : "Skills"}
              </button>
            ))}
          </div>

          {/* Task list */}
          {activeTab === "tasks" && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {loadingTasks ? "Refreshing…" : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
                </p>
                <button
                  onClick={fetchTasks}
                  disabled={loadingTasks}
                  className="text-xs text-blue-500 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              {tasks.length === 0 && !loadingTasks ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No tasks yet. Send a message to create one.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onSelect={(t) => {
                      setSelectedTask(t);
                    }} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Agent Card JSON */}
          {activeTab === "card" && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  /.well-known/agent-card.json
                </span>
                <a
                  href="/.well-known/agent-card.json"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-500 dark:text-blue-400 hover:underline"
                >
                  Open ↗
                </a>
              </div>
              {agentCard ? (
                <pre className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(agentCard, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
              )}
            </section>
          )}

          {/* Skills */}
          {activeTab === "skills" && (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agentCard?.skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
              {!agentCard && (
                <p className="text-sm text-slate-400 dark:text-slate-500 col-span-2">Loading skills…</p>
              )}
            </section>
          )}
        </div>

        {/* Right column – Task detail */}
        <aside className="space-y-4">
          {/* Capabilities summary */}
          {agentCard && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-4">
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                Capabilities
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Streaming</span>
                  <span className={agentCard.capabilities?.streaming ? "text-emerald-500" : "text-slate-400"}>
                    {agentCard.capabilities?.streaming ? "✓" : "✗"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Push Notifications</span>
                  <span className={agentCard.capabilities?.pushNotifications ? "text-emerald-500" : "text-slate-400"}>
                    {agentCard.capabilities?.pushNotifications ? "✓" : "✗"}
                  </span>
                </div>
                {agentCard.defaultInputModes && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Input modes</p>
                    <div className="flex flex-wrap gap-1">
                      {agentCard.defaultInputModes.map((m) => (
                        <span key={m} className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {agentCard.defaultOutputModes && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Output modes</p>
                    <div className="flex flex-wrap gap-1">
                      {agentCard.defaultOutputModes.map((m) => (
                        <span key={m} className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Task detail panel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-4">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              Task Detail
            </h2>
            {selectedTask ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <StatusBadge state={selectedTask.status.state} />
                  <button
                    onClick={() => setSelectedTask(null)}
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    ✕
                  </button>
                </div>
                <div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Task ID</p>
                  <p className="font-mono text-xs text-slate-600 dark:text-slate-300 break-all">{selectedTask.id}</p>
                </div>
                {selectedTask.contextId && (
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Context ID</p>
                    <p className="font-mono text-xs text-slate-600 dark:text-slate-300 break-all">{selectedTask.contextId}</p>
                  </div>
                )}
                {selectedTask.metadata?.workspaceId && (
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Workspace</p>
                    <p className="font-mono text-xs text-slate-600 dark:text-slate-300">{selectedTask.metadata.workspaceId}</p>
                  </div>
                )}
                {selectedTask.metadata?.userPrompt && (
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Prompt</p>
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{selectedTask.metadata.userPrompt}</p>
                  </div>
                )}
                {selectedTask.status.message && (
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Status Message</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {selectedTask.status.message.parts.map((p) => p.text).join("")}
                    </p>
                  </div>
                )}
                {/* Raw JSON toggle */}
                <details className="group">
                  <summary className="cursor-pointer text-xs text-blue-500 dark:text-blue-400 hover:underline list-none">
                    Raw JSON
                  </summary>
                  <pre className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(selectedTask, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                Select a task to see details.
              </p>
            )}
          </div>

          {/* Quick API reference */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-4">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              API Endpoints
            </h2>
            <ul className="space-y-1.5 text-xs font-mono">
              {[
                { method: "GET",  path: "/.well-known/agent-card.json" },
                { method: "POST", path: "/api/a2a/rpc   SendMessage" },
                { method: "POST", path: "/api/a2a/rpc   GetTask" },
                { method: "POST", path: "/api/a2a/rpc   ListTasks" },
                { method: "POST", path: "/api/a2a/rpc   CancelTask" },
                { method: "GET",  path: "/api/a2a/tasks" },
                { method: "GET",  path: "/api/a2a/tasks/[id]" },
              ].map((ep, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={`rounded px-1 py-0.5 text-[10px] font-semibold flex-shrink-0 ${
                    ep.method === "GET"
                      ? "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400"
                      : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}>
                    {ep.method}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 break-all">{ep.path}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
