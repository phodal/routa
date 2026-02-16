"use client";

/**
 * Routa JS - Main Page
 *
 * Full-screen layout:
 *   - Top bar: Logo, Agent selector, protocol badges
 *   - Left sidebar: Provider selector, Sessions, Skills
 *   - Right area: Chat panel
 *   - Right sidebar (resizable): Task panel / CRAFTERs view
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { SkillPanel } from "@/client/components/skill-panel";
import { ChatPanel } from "@/client/components/chat-panel";
import { SessionPanel } from "@/client/components/session-panel";
import { TaskPanel, type CrafterAgent, type CrafterMessage } from "@/client/components/task-panel";
import { CollaborativeTaskEditor } from "@/client/components/collaborative-task-editor";
import { useAcp } from "@/client/hooks/use-acp";
import { useSkills } from "@/client/hooks/use-skills";
import { useNotes } from "@/client/hooks/use-notes";
import type { RepoSelection } from "@/client/components/repo-picker";
import type { ParsedTask } from "@/client/utils/task-block-parser";

type AgentRole = "CRAFTER" | "ROUTA" | "GATE" | "DEVELOPER";

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>("CRAFTER");
  const [showAgentToast, setShowAgentToast] = useState(false);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [routaTasks, setRoutaTasks] = useState<ParsedTask[]>([]);
  const acp = useAcp();
  const skillsHook = useSkills();
  const notesHook = useNotes("default");

  // ── Collaborative editing panel view ──────────────────────────────────
  const [taskPanelMode, setTaskPanelMode] = useState<"tasks" | "collab">("tasks");

  // ── Resizable sidebar state ──────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // ── CRAFTERs view state ──────────────────────────────────────────────
  const [crafterAgents, setCrafterAgents] = useState<CrafterAgent[]>([]);
  const [activeCrafterId, setActiveCrafterId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(1);

  // Track last processed update index for child agent routing
  const lastChildUpdateIndexRef = useRef(0);

  // Auto-connect on mount so providers are loaded immediately
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load repo skills when repo selection changes
  useEffect(() => {
    if (repoSelection?.path) {
      skillsHook.loadRepoSkills(repoSelection.path);
    } else {
      skillsHook.clearRepoSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoSelection?.path]);

  // ── Resize handlers ──────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Moving left increases width (sidebar is on the right)
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(280, Math.min(700, resizeStartWidthRef.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Prevent text selection during resize
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  // ── Route child agent SSE updates to crafter agents ──────────────────

  useEffect(() => {
    const updates = acp.updates;
    if (!updates.length) {
      lastChildUpdateIndexRef.current = 0;
      return;
    }

    const startIndex =
      lastChildUpdateIndexRef.current > updates.length
        ? 0
        : lastChildUpdateIndexRef.current;
    const pending = updates.slice(startIndex);
    if (!pending.length) return;
    lastChildUpdateIndexRef.current = updates.length;

    setCrafterAgents((prev) => {
      let updated = [...prev];
      let changed = false;

      for (const notification of pending) {
        const raw = notification as Record<string, unknown>;
        const update = (raw.update ?? raw) as Record<string, unknown>;
        const childAgentId = (update.childAgentId ?? raw.childAgentId) as string | undefined;

        if (!childAgentId) continue;

        const agentIdx = updated.findIndex((a) => a.id === childAgentId);
        if (agentIdx < 0) continue;

        const agent = { ...updated[agentIdx] };
        const messages = [...agent.messages];
        const kind = update.sessionUpdate as string | undefined;

        if (!kind) continue;
        changed = true;

        const extractText = (): string => {
          const content = update.content as { type: string; text?: string } | undefined;
          if (content?.text) return content.text;
          if (typeof update.text === "string") return update.text as string;
          return "";
        };

        switch (kind) {
          case "agent_message_chunk": {
            const text = extractText();
            if (!text) break;
            // Find or create streaming message
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && !lastMsg.toolName) {
              messages[messages.length - 1] = { ...lastMsg, content: lastMsg.content + text };
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: "assistant",
                content: text,
                timestamp: new Date(),
              });
            }
            break;
          }

          case "agent_thought_chunk": {
            const text = extractText();
            if (!text) break;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "thought") {
              messages[messages.length - 1] = { ...lastMsg, content: lastMsg.content + text };
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: "thought",
                content: text,
                timestamp: new Date(),
              });
            }
            break;
          }

          case "tool_call": {
            const toolCallId = update.toolCallId as string | undefined;
            const title = (update.title as string) ?? "tool";
            const status = (update.status as string) ?? "running";
            messages.push({
              id: toolCallId ?? crypto.randomUUID(),
              role: "tool",
              content: title,
              timestamp: new Date(),
              toolName: title,
              toolStatus: status,
            });
            break;
          }

          case "tool_call_update": {
            const toolCallId = update.toolCallId as string | undefined;
            const status = update.status as string | undefined;
            if (toolCallId) {
              const idx = messages.findIndex((m) => m.id === toolCallId || (m.role === "tool" && m.toolName === (update.title as string)));
              if (idx >= 0) {
                messages[idx] = {
                  ...messages[idx],
                  toolStatus: status ?? messages[idx].toolStatus,
                };
              }
            }
            break;
          }

          case "completed":
          case "ended": {
            agent.status = "completed";
            break;
          }

          default:
            break;
        }

        agent.messages = messages;
        updated[agentIdx] = agent;
      }

      return changed ? updated : prev;
    });
  }, [acp.updates]);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const ensureConnected = useCallback(async () => {
    if (!acp.connected) {
      await acp.connect();
    }
  }, [acp]);

  const handleCreateSession = useCallback(
    async (provider: string) => {
      await ensureConnected();
      const cwd = repoSelection?.path ?? undefined;
      const role = selectedAgent !== "CRAFTER" ? selectedAgent : undefined;
      const result = await acp.createSession(cwd, provider, undefined, role);
      if (result?.sessionId) {
        setActiveSessionId(result.sessionId);
        bumpRefresh();
      }
    },
    [acp, ensureConnected, bumpRefresh, repoSelection, selectedAgent]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      await ensureConnected();
      acp.selectSession(sessionId);
      setActiveSessionId(sessionId);
      bumpRefresh();
    },
    [acp, ensureConnected, bumpRefresh]
  );

  const ensureSessionForChat = useCallback(async (cwd?: string, provider?: string, modeId?: string): Promise<string | null> => {
    await ensureConnected();
    if (activeSessionId) return activeSessionId;
    const role = selectedAgent !== "CRAFTER" ? selectedAgent : undefined;
    const result = await acp.createSession(cwd, provider ?? acp.selectedProvider, modeId, role);
    if (result?.sessionId) {
      setActiveSessionId(result.sessionId);
      bumpRefresh();
      return result.sessionId;
    }
    return null;
  }, [acp, activeSessionId, ensureConnected, bumpRefresh, selectedAgent]);

  const handleLoadSkill = useCallback(async (name: string): Promise<string | null> => {
    const skill = await skillsHook.loadSkill(name, repoSelection?.path);
    return skill?.content ?? null;
  }, [skillsHook, repoSelection?.path]);

  const handleAgentChange = useCallback((role: AgentRole) => {
    setSelectedAgent(role);
    if (role === "ROUTA") {
      setShowAgentToast(true);
      setTimeout(() => setShowAgentToast(false), 2500);
    }
  }, []);

  // ── Routa Task Panel Handlers ─────────────────────────────────────────

  const handleTasksDetected = useCallback(async (tasks: ParsedTask[]) => {
    setRoutaTasks(tasks);

    // Auto-save tasks to Notes system for collaborative editing
    for (const task of tasks) {
      try {
        await notesHook.createNote({
          noteId: `task-${task.id}`,
          title: task.title,
          content: [
            task.objective && `## Objective\n${task.objective}`,
            task.scope && `## Scope\n${task.scope}`,
            task.definitionOfDone && `## Definition of Done\n${task.definitionOfDone}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          type: "task",
          metadata: { taskStatus: "PENDING" },
        });
      } catch {
        // Note may already exist, try updating
        await notesHook.updateNote(`task-${task.id}`, {
          title: task.title,
          content: [
            task.objective && `## Objective\n${task.objective}`,
            task.scope && `## Scope\n${task.scope}`,
            task.definitionOfDone && `## Definition of Done\n${task.definitionOfDone}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
      }
    }

    // Auto-switch to collab mode when tasks are detected
    if (tasks.length > 0) {
      setTaskPanelMode("collab");
    }
  }, [notesHook]);

  /**
   * Call a Routa MCP tool via the /api/mcp endpoint.
   */
  const mcpSessionRef = useCallback(() => {
    return { current: null as string | null };
  }, [])();

  const callMcpTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    if (!mcpSessionRef.current) {
      const initRes = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "routa-ui", version: "0.1.0" },
          },
        }),
      });
      const sessionId = initRes.headers.get("mcp-session-id");
      if (sessionId) mcpSessionRef.current = sessionId;
    }

    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(mcpSessionRef.current ? { "Mcp-Session-Id": mcpSessionRef.current } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "MCP tool call failed");
    return data.result;
  }, [mcpSessionRef]);

  const handleConfirmAllTasks = useCallback(() => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.status === "pending" ? { ...t, status: "confirmed" as const } : t))
    );
  }, []);

  const handleConfirmTask = useCallback((taskId: string) => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "confirmed" as const } : t))
    );
  }, []);

  const handleEditTask = useCallback((taskId: string, updated: Partial<ParsedTask>) => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t))
    );
  }, []);

  /**
   * Execute a single task by creating it in the MCP task store
   * and delegating to a CRAFTER agent.
   * Returns the created CrafterAgent info.
   */
  const handleExecuteTask = useCallback(async (taskId: string): Promise<CrafterAgent | null> => {
    const task = routaTasks.find((t) => t.id === taskId);
    if (!task) return null;

    // Mark as running
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "running" as const } : t))
    );

    try {
      // 1. Create task in MCP task store
      const createResult = await callMcpTool("create_task", {
        title: task.title,
        objective: task.objective,
        scope: task.scope || undefined,
        acceptanceCriteria: task.definitionOfDone
          ? task.definitionOfDone.split("\n").filter(Boolean).map((l) => l.replace(/^\d+[.)]\s*/, "").trim())
          : undefined,
      });

      // Extract created taskId from result
      const resultText = createResult?.content?.[0]?.text ?? "{}";
      let mcpTaskId: string | undefined;
      try {
        const parsed = JSON.parse(resultText);
        mcpTaskId = parsed.taskId ?? parsed.id;
      } catch {
        const m = resultText.match(/"(?:taskId|id)"\s*:\s*"([^"]+)"/);
        mcpTaskId = m?.[1];
      }

      let agentId: string | undefined;
      let childSessionId: string | undefined;

      if (!mcpTaskId) {
        console.warn("[TaskPanel] Could not extract taskId from create_task result:", resultText);
        if (activeSessionId) {
          await acp.prompt(
            `Execute task: "${task.title}"\nObjective: ${task.objective}\nScope: ${task.scope}\nDone when: ${task.definitionOfDone}`
          );
        }
      } else {
        // 2. Delegate to a CRAFTER agent
        try {
          const delegateResult = await callMcpTool("delegate_task_to_agent", {
            taskId: mcpTaskId,
            callerAgentId: "routa-ui",
            specialist: "CRAFTER",
          });

          // Extract agent info from delegation result
          const delegateText = delegateResult?.content?.[0]?.text ?? "{}";
          try {
            const parsed = JSON.parse(delegateText);
            agentId = parsed.agentId;
            childSessionId = parsed.sessionId;
          } catch {
            const agentMatch = delegateText.match(/"agentId"\s*:\s*"([^"]+)"/);
            const sessionMatch = delegateText.match(/"sessionId"\s*:\s*"([^"]+)"/);
            agentId = agentMatch?.[1];
            childSessionId = sessionMatch?.[1];
          }
        } catch (delegateErr) {
          console.warn("[TaskPanel] delegate_task_to_agent failed, falling back to prompt:", delegateErr);
          if (activeSessionId) {
            await acp.prompt(
              `Task "${task.title}" has been created (ID: ${mcpTaskId}). Please delegate it to a CRAFTER agent and execute it.`
            );
          }
        }
      }

      // 3. Create CrafterAgent record
      const crafterAgent: CrafterAgent = {
        id: agentId ?? `crafter-${taskId}`,
        sessionId: childSessionId ?? "",
        taskId,
        taskTitle: task.title,
        status: "running",
        messages: [],
      };

      setCrafterAgents((prev) => [...prev, crafterAgent]);

      // Auto-select this agent if concurrency is 1
      if (concurrency === 1) {
        setActiveCrafterId(crafterAgent.id);
      } else if (!activeCrafterId) {
        setActiveCrafterId(crafterAgent.id);
      }

      // Mark completed (the orchestrator will handle the actual completion)
      setRoutaTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "completed" as const } : t))
      );

      return crafterAgent;
    } catch (err) {
      console.error("[TaskPanel] Task execution failed:", err);
      setRoutaTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "confirmed" as const } : t))
      );
      return null;
    }
  }, [routaTasks, activeSessionId, acp, callMcpTool, concurrency, activeCrafterId]);

  /**
   * Execute all confirmed tasks with configurable concurrency.
   * concurrency=1: sequential, auto-switch view to running agent
   * concurrency=2: up to 2 tasks in parallel
   */
  const handleExecuteAllTasks = useCallback(async (requestedConcurrency: number) => {
    const confirmedTasks = routaTasks.filter((t) => t.status === "confirmed");
    if (confirmedTasks.length === 0) return;

    const effectiveConcurrency = Math.min(requestedConcurrency, confirmedTasks.length);

    if (effectiveConcurrency <= 1) {
      // Sequential execution - auto-switch to each agent's view
      for (const task of confirmedTasks) {
        const agent = await handleExecuteTask(task.id);
        if (agent) {
          setActiveCrafterId(agent.id);
        }
      }
    } else {
      // Parallel execution with concurrency limit
      const queue = [...confirmedTasks];
      const runBatch = async () => {
        const batch = queue.splice(0, effectiveConcurrency);
        const promises = batch.map((task) => handleExecuteTask(task.id));
        const results = await Promise.allSettled(promises);
        // Select the first agent from the batch
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            setActiveCrafterId(result.value.id);
            break;
          }
        }
      };

      while (queue.length > 0) {
        await runBatch();
      }
    }
  }, [routaTasks, handleExecuteTask]);

  const handleSelectCrafter = useCallback((agentId: string) => {
    setActiveCrafterId(agentId);
  }, []);

  const handleConcurrencyChange = useCallback((n: number) => {
    setConcurrency(n);
  }, []);

  const hasCollabNotes = notesHook.notes.some((n) => n.metadata.type === "task" || n.metadata.type === "spec");
  const showTaskPanel = routaTasks.length > 0 || crafterAgents.length > 0 || hasCollabNotes;

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#0f1117]">
      {/* ─── Top Bar ──────────────────────────────────────────────── */}
      <header className="h-[52px] shrink-0 bg-white dark:bg-[#161922] border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-4 z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.svg"
            alt="Routa"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Routa
          </span>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

        {/* Agent selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Agent:</span>
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => handleAgentChange(e.target.value as AgentRole)}
              className="appearance-none pl-3 pr-7 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 cursor-pointer focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="CRAFTER">CRAFTER</option>
              <option value="ROUTA">ROUTA</option>
              <option value="GATE">GATE</option>
              <option value="DEVELOPER">DEVELOPER</option>
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            ACTIVE
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Protocol badges */}
        <div className="flex items-center gap-2">
          <ProtocolBadge name="MCP" endpoint="/api/mcp" />
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
          <a
            href="/mcp-tools"
            className="px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-[11px] font-medium text-blue-600 dark:text-blue-300"
          >
            Agent MCP Tools
          </a>
        </div>

        {/* Connection status */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <button
          onClick={async () => {
            if (acp.connected) {
              acp.disconnect();
            } else {
              await acp.connect();
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            acp.connected
              ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30"
              : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${acp.connected ? "bg-green-500" : "bg-gray-400"}`} />
          {acp.connected ? "Connected" : "Disconnected"}
        </button>
      </header>

      {/* ─── Main Area ────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ─── Left Sidebar ──────────────────────────────────────── */}
        <aside className="w-[300px] shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col overflow-hidden">
          {/* Provider + New Session */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Provider
              </label>
              {acp.providers.length > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {acp.providers.filter((p) => p.status === "available").length}/{acp.providers.length} installed
                </span>
              )}
            </div>

            {/* Provider list */}
            <ProviderList
              providers={acp.providers}
              selectedProvider={acp.selectedProvider}
              onSelect={acp.setProvider}
            />

            {/* Serverless limitation warning */}
            {acp.providers.length > 0 && acp.providers.filter((p) => p.status === "available").length === 0 && (
              <div className="mt-2 px-2.5 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-1.5">
                  <span className="text-amber-600 dark:text-amber-400 text-xs">⚠️</span>
                  <div className="flex-1 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                    <p className="font-medium mb-1">CLI tools unavailable on Vercel</p>
                    <p className="text-amber-600 dark:text-amber-400">
                      Serverless platforms cannot run CLI processes.
                      Deploy to a VPS or use API-based providers instead.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => handleCreateSession(acp.selectedProvider)}
              disabled={acp.providers.length === 0 || !acp.selectedProvider}
              className="mt-2 w-full px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Session
            </button>
          </div>

          {/* Sessions */}
          <div className="flex-1 overflow-y-auto">
            <SessionPanel
              selectedSessionId={activeSessionId}
              onSelect={handleSelectSession}
              refreshKey={refreshKey}
            />

            {/* Divider */}
            <div className="mx-3 my-1 border-t border-gray-100 dark:border-gray-800" />

            {/* Skills */}
            <SkillPanel
              skillsHook={skillsHook}
            />
          </div>
        </aside>

        {/* ─── Chat Area ──────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">
          <ChatPanel
            acp={acp}
            activeSessionId={activeSessionId}
            onEnsureSession={ensureSessionForChat}
            onSelectSession={handleSelectSession}
            skills={skillsHook.skills}
            repoSkills={skillsHook.repoSkills}
            onLoadSkill={handleLoadSkill}
            repoSelection={repoSelection}
            onRepoChange={setRepoSelection}
            onTasksDetected={handleTasksDetected}
            agentRole={selectedAgent}
          />
        </main>

        {/* ─── Right Panel: Routa Sub-Tasks (Resizable) ───────────── */}
        {showTaskPanel && (
          <aside
            className="shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col overflow-hidden relative"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Resize handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors group"
              onMouseDown={handleResizeStart}
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition-colors" />
            </div>

            {/* Panel Mode Toggle */}
            {hasCollabNotes && (
              <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1">
                <button
                  onClick={() => setTaskPanelMode("tasks")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                    taskPanelMode === "tasks"
                      ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  Tasks
                </button>
                <button
                  onClick={() => setTaskPanelMode("collab")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors flex items-center gap-1 ${
                    taskPanelMode === "collab"
                      ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${notesHook.connected ? "bg-green-500" : "bg-gray-400"}`} />
                  Collab Edit
                </button>
              </div>
            )}

            {taskPanelMode === "tasks" ? (
              <TaskPanel
                tasks={routaTasks}
                onConfirmAll={handleConfirmAllTasks}
                onExecuteAll={handleExecuteAllTasks}
                onConfirmTask={handleConfirmTask}
                onEditTask={handleEditTask}
                onExecuteTask={handleExecuteTask}
                crafterAgents={crafterAgents}
                activeCrafterId={activeCrafterId}
                onSelectCrafter={handleSelectCrafter}
                concurrency={concurrency}
                onConcurrencyChange={handleConcurrencyChange}
              />
            ) : (
              <CollaborativeTaskEditor
                notes={notesHook.notes}
                connected={notesHook.connected}
                onUpdateNote={notesHook.updateNote}
                onDeleteNote={notesHook.deleteNote}
                workspaceId="default"
              />
            )}
          </aside>
        )}
      </div>

      {/* ─── Resize overlay (prevents iframe/content interference) ─── */}
      {isResizing && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}

      {/* ─── Agent Toast ──────────────────────────────────────────── */}
      {showAgentToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium shadow-lg animate-fade-in">
          ROUTA mode: Coordinator will plan, delegate to CRAFTER agents, and verify with GATE.
        </div>
      )}
    </div>
  );
}

// ─── Provider List Component ──────────────────────────────────────────

function ProviderList({
  providers,
  selectedProvider,
  onSelect,
}: {
  providers: Array<{ id: string; name: string; command?: string; status?: string }>;
  selectedProvider: string;
  onSelect: (id: string) => void;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);

  if (providers.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] px-3 py-3 text-xs text-gray-400 text-center">
        Connecting...
      </div>
    );
  }

  const available = providers.filter((p) => p.status === "available");
  const unavailable = providers.filter((p) => p.status !== "available");

  const renderProvider = (p: (typeof providers)[0]) => {
    const isAvailable = p.status === "available";
    const isSelected = p.id === selectedProvider;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onSelect(p.id)}
        className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 transition-colors ${
          isSelected
            ? "bg-blue-50 dark:bg-blue-900/20"
            : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
        } ${!isAvailable ? "opacity-50" : ""}`}
      >
        {/* Status dot */}
        <span
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            isAvailable ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        {/* Name + command */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium truncate ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-gray-100"}`}>
              {p.name}
            </span>
            <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono truncate">
              {p.command}
            </span>
          </div>
        </div>
        {/* Status badge */}
        <span
          className={`shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded ${
            isAvailable
              ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
          }`}
        >
          {isAvailable ? "Ready" : "Not found"}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] divide-y divide-gray-50 dark:divide-gray-800">
      {/* Available providers - always visible */}
      {available.map(renderProvider)}

      {/* Unavailable providers - collapsible */}
      {unavailable.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowUnavailable((v) => !v)}
            className="w-full px-2.5 py-1.5 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <span>
              {unavailable.length} unavailable
            </span>
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${showUnavailable ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showUnavailable && unavailable.map(renderProvider)}
        </>
      )}
    </div>
  );
}

function ProtocolBadge({
  name,
  endpoint,
}: {
  name: string;
  endpoint: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 dark:bg-[#1e2130] text-[11px] font-medium text-gray-500 dark:text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      {name}
      <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">
        {endpoint}
      </span>
    </div>
  );
}
