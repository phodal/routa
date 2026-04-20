"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserAcpClient } from "@/client/acp-client";
import { type CrafterAgent, type CrafterMessage } from "@/client/components/task-panel";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import { type NoteData } from "@/client/hooks/use-notes";
import {
  desktopAwareFetch,
  getDesktopApiBaseUrl,
  shouldSuppressTeardownError,
} from "@/client/utils/diagnostics";
import type { ParsedTask } from "@/client/utils/task-block-parser";
import {
  type NoteTaskQueueItem,
  type UseSessionCraftersParams,
  type UseSessionCraftersResult,
  appendStreamMessage,
  extractDelegationPayload,
  extractResultId,
  extractUpdateText,
} from "./session-crafter-shared";
import { useSessionMcpTool } from "./use-session-mcp-tool";

export function useSessionCrafters(params: UseSessionCraftersParams): UseSessionCraftersResult {
  const {
    sessionId,
    workspaceId,
    isResolved,
    acpConnected,
    acpUpdates,
    notesHook,
    repoSelection,
    focusedSessionId,
    setFocusedSessionId,
    bumpRefresh,
    resolveAgentConfig,
  } = params;

  const [routaTasks, setRoutaTasks] = useState<ParsedTask[]>([]);
  const [crafterAgents, setCrafterAgents] = useState<CrafterAgent[]>([]);
  const [activeCrafterId, setActiveCrafterId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(1);
  const noteTaskQueueRef = useRef<NoteTaskQueueItem[]>([]);
  const routaTaskQueueRef = useRef<string[]>([]);
  const runningCrafterCountRef = useRef(0);
  const lastChildUpdateIndexRef = useRef(0);
  const providerChildClientsRef = useRef<Map<string, BrowserAcpClient>>(new Map());
  const crafterAgentsRestoredRef = useRef<Set<string>>(new Set());
  const syncedCrafterStatusRef = useRef<Map<string, string>>(new Map());
  const handleExecuteTaskRef = useRef<((taskId: string) => Promise<CrafterAgent | null>) | null>(null);
  const { callMcpTool } = useSessionMcpTool(workspaceId);

  useEffect(() => {
    const clients = providerChildClientsRef.current;
    return () => {
      for (const client of clients.values()) {
        client.disconnect();
      }
      clients.clear();
    };
  }, []);

  useEffect(() => {
    if (!isResolved || sessionId === "__placeholder__") return;
    if (!sessionId || !acpConnected) return;
    if (crafterAgentsRestoredRef.current.has(sessionId)) return;
    crafterAgentsRestoredRef.current.add(sessionId);

    desktopAwareFetch(`/api/sessions?parentSessionId=${sessionId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.sessions?.length) return;
        const childSessions = data.sessions as Array<{
          sessionId: string;
          name?: string;
          routaAgentId?: string;
          role?: string;
        }>;

        setCrafterAgents((prev) => {
          if (prev.length > 0) return prev;

          const restored: CrafterAgent[] = childSessions
            .filter((childSession) => childSession.role === "CRAFTER")
            .map((childSession) => ({
              id: childSession.routaAgentId ?? childSession.sessionId,
              sessionId: childSession.sessionId,
              taskId: "",
              taskTitle: childSession.name ?? "CRAFTER Task",
              status: "completed",
              messages: [],
            }));

          if (restored.length > 0) {
            setActiveCrafterId(restored[0].id);
          }
          return restored;
        });
      })
      .catch((error) => {
        console.warn("[SessionPage] Failed to restore CRAFTER agents:", error);
      });
  }, [acpConnected, isResolved, sessionId]);

  const handleUpdateAgentMessages = useCallback((agentId: string, messages: CrafterMessage[]) => {
    setCrafterAgents((prev) =>
      prev.map((agent) => (agent.id === agentId ? { ...agent, messages } : agent)),
    );
  }, []);

  useEffect(() => {
    if (!notesHook.notes.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync restored crafter task IDs from collaborative note metadata
    setCrafterAgents((prev) => {
      let changed = false;
      const next = prev.map((agent) => {
        if (agent.taskId) return agent;

        const matchedNote = notesHook.notes.find((note) =>
          note.metadata.type === "task" && (
            note.metadata.childSessionId === agent.sessionId ||
            note.metadata.assignedAgentIds?.includes(agent.id) ||
            note.title === agent.taskTitle
          ));

        if (!matchedNote) return agent;
        changed = true;
        return {
          ...agent,
          taskId: matchedNote.id,
        };
      });

      return changed ? next : prev;
    });
  }, [notesHook.notes]);

  useEffect(() => {
    if (!focusedSessionId) return;
    const matchedAgent = crafterAgents.find((agent) => agent.sessionId === focusedSessionId);
    if (matchedAgent && matchedAgent.id !== activeCrafterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selected crafter aligned with focused child session
      setActiveCrafterId(matchedAgent.id);
    }
  }, [activeCrafterId, crafterAgents, focusedSessionId]);

  useEffect(() => {
    const updates = acpUpdates;
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

    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply incoming child-agent stream updates into crafter view state
    setCrafterAgents((prev) => {
      const updated = [...prev];
      let changed = false;

      for (const notification of pending) {
        const raw = notification as Record<string, unknown>;
        const update = (raw.update ?? raw) as Record<string, unknown>;
        const childAgentId = (update.childAgentId ?? raw.childAgentId) as string | undefined;

        if (!childAgentId) continue;

        const agentIndex = updated.findIndex((agent) => agent.id === childAgentId);
        if (agentIndex < 0) continue;

        const agent = { ...updated[agentIndex] };
        let messages = [...agent.messages];
        const kind = update.sessionUpdate as string | undefined;
        if (!kind) continue;
        changed = true;

        switch (kind) {
          case "agent_message_chunk":
            messages = appendStreamMessage(messages, "assistant", extractUpdateText(update));
            break;
          case "agent_thought_chunk":
            messages = appendStreamMessage(messages, "thought", extractUpdateText(update));
            break;
          case "tool_call": {
            const toolCallId = update.toolCallId as string | undefined;
            const toolName = getToolEventLabel(update);
            messages.push({
              id: toolCallId ?? crypto.randomUUID(),
              role: "tool",
              content: toolName,
              timestamp: new Date(),
              toolName,
              toolStatus: (update.status as string) ?? "running",
            });
            break;
          }
          case "tool_call_update": {
            const toolCallId = update.toolCallId as string | undefined;
            const status = update.status as string | undefined;
            if (toolCallId) {
              const toolName = getToolEventLabel(update);
              const messageIndex = messages.findIndex((message) =>
                message.id === toolCallId || (message.role === "tool" && message.toolName === toolName),
              );
              if (messageIndex >= 0) {
                messages[messageIndex] = {
                  ...messages[messageIndex],
                  toolName: toolName ?? messages[messageIndex].toolName,
                  toolStatus: status ?? messages[messageIndex].toolStatus,
                };
              }
            }
            break;
          }
          case "completed":
          case "ended":
            agent.status = "completed";
            if (agent.taskId) {
              setRoutaTasks((prevTasks) =>
                prevTasks.map((task) => (
                  task.id === agent.taskId ? { ...task, status: "completed" as const } : task
                )),
              );
            }
            break;
          case "task_completion": {
            const taskStatus = update.taskStatus as string | undefined;
            const summary = update.completionSummary as string | undefined;
            if (taskStatus === "NEEDS_FIX" || taskStatus === "BLOCKED" || taskStatus === "FAILED") {
              agent.status = "error";
              if (summary) {
                messages.push({
                  id: crypto.randomUUID(),
                  role: "info",
                  content: `Error: ${summary}`,
                  timestamp: new Date(),
                });
              }
              if (agent.taskId) {
                setRoutaTasks((prevTasks) =>
                  prevTasks.map((task) => (
                    task.id === agent.taskId ? { ...task, status: "confirmed" as const } : task
                  )),
                );
              }
            } else {
              agent.status = "completed";
              if (summary) {
                messages.push({
                  id: crypto.randomUUID(),
                  role: "info",
                  content: summary,
                  timestamp: new Date(),
                });
              }
              if (agent.taskId) {
                setRoutaTasks((prevTasks) =>
                  prevTasks.map((task) => (
                    task.id === agent.taskId ? { ...task, status: "completed" as const } : task
                  )),
                );
              }
            }
            break;
          }
          case "session_renamed": {
            const newName = update.name as string | undefined;
            if (newName) {
              agent.taskTitle = newName;
            }
            break;
          }
          default:
            break;
        }

        agent.messages = messages;
        updated[agentIndex] = agent;
      }

      return changed ? updated : prev;
    });
  }, [acpUpdates]);

  const handleTasksDetected = useCallback(async (tasks: ParsedTask[]) => {
    setRoutaTasks(tasks);

    for (const task of tasks) {
      const taskContent = [
        task.objective && `## Objective\n${task.objective}`,
        task.scope && `## Scope\n${task.scope}`,
        task.definitionOfDone && `## Definition of Done\n${task.definitionOfDone}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      try {
        await notesHook.createNote({
          noteId: `task-${task.id}`,
          title: task.title,
          content: taskContent,
          type: "task",
          sessionId,
          metadata: { taskStatus: "PENDING" },
        });
      } catch {
        await notesHook.updateNote(`task-${task.id}`, {
          title: task.title,
          content: taskContent,
        });
      }
    }
  }, [notesHook, sessionId]);

  const handleConfirmAllTasks = useCallback(() => {
    setRoutaTasks((prev) =>
      prev.map((task) => (
        task.status === "pending" ? { ...task, status: "confirmed" as const } : task
      )),
    );
  }, []);

  const handleConfirmTask = useCallback((taskId: string) => {
    setRoutaTasks((prev) =>
      prev.map((task) => (
        task.id === taskId ? { ...task, status: "confirmed" as const } : task
      )),
    );
  }, []);

  const handleEditTask = useCallback((taskId: string, updated: Partial<ParsedTask>) => {
    setRoutaTasks((prev) =>
      prev.map((task) => (
        task.id === taskId ? { ...task, ...updated } : task
      )),
    );
  }, []);

  const handleExecuteTask = useCallback(async (taskId: string): Promise<CrafterAgent | null> => {
    const task = routaTasks.find((item) => item.id === taskId);
    if (!task) return null;

    if (concurrency <= 1 && runningCrafterCountRef.current > 0) {
      routaTaskQueueRef.current.push(taskId);
      return null;
    }

    runningCrafterCountRef.current++;
    setRoutaTasks((prev) =>
      prev.map((item) => (
        item.id === taskId ? { ...item, status: "running" as const } : item
      )),
    );

    try {
      const createResult = await callMcpTool("create_task", {
        title: task.title,
        objective: task.objective,
        creationSource: "session",
        scope: task.scope || undefined,
        sessionId,
        acceptanceCriteria: task.definitionOfDone
          ? task.definitionOfDone.split("\n").filter(Boolean).map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
          : undefined,
      });

      const resultText = createResult?.content?.[0]?.text ?? "{}";
      const mcpTaskId = extractResultId(resultText);
      let agentId: string | undefined;
      let childSessionId: string | undefined;
      let delegationError: string | undefined;

      if (!mcpTaskId) {
        delegationError = `Failed to create task in MCP store. Raw: ${resultText.slice(0, 200)}`;
      } else {
        try {
          const delegateResult = await callMcpTool("delegate_task_to_agent", {
            taskId: mcpTaskId,
            callerAgentId: "routa-ui",
            callerSessionId: sessionId,
            specialist: "CRAFTER",
          });
          const delegation = extractDelegationPayload(delegateResult?.content?.[0]?.text ?? "{}");
          agentId = delegation.agentId;
          childSessionId = delegation.sessionId;
          delegationError = delegation.error;
        } catch (error) {
          delegationError = error instanceof Error ? error.message : String(error);
        }
      }

      const crafterAgent: CrafterAgent = {
        id: agentId ?? `crafter-${taskId}`,
        sessionId: childSessionId ?? "",
        taskId,
        taskTitle: task.title,
        status: delegationError ? "error" : "running",
        messages: delegationError
          ? [{
              id: crypto.randomUUID(),
              role: "info",
              content: `Delegation failed: ${delegationError}`,
              timestamp: new Date(),
            }]
          : [],
      };

      setCrafterAgents((prev) => [...prev, crafterAgent]);
      if (concurrency === 1 || !activeCrafterId) {
        setActiveCrafterId(crafterAgent.id);
      }

      if (delegationError) {
        runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
      }

      setRoutaTasks((prev) =>
        prev.map((item) => (
          item.id === taskId
            ? { ...item, status: delegationError ? ("confirmed" as const) : ("completed" as const) }
            : item
        )),
      );

      return crafterAgent;
    } catch {
      runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
      setRoutaTasks((prev) =>
        prev.map((item) => (
          item.id === taskId ? { ...item, status: "confirmed" as const } : item
        )),
      );
      return null;
    }
  }, [activeCrafterId, callMcpTool, concurrency, routaTasks, sessionId]);

  const handleExecuteAllTasks = useCallback(async (requestedConcurrency: number) => {
    const confirmedTasks = routaTasks.filter((task) => task.status === "confirmed");
    if (confirmedTasks.length === 0) return;

    const effectiveConcurrency = Math.min(requestedConcurrency, confirmedTasks.length);
    if (effectiveConcurrency <= 1) {
      routaTaskQueueRef.current = confirmedTasks.slice(1).map((task) => task.id);
      const agent = await handleExecuteTask(confirmedTasks[0].id);
      if (agent) setActiveCrafterId(agent.id);
      return;
    }

    routaTaskQueueRef.current = [];
    const queue = [...confirmedTasks];
    while (queue.length > 0) {
      const batch = queue.splice(0, effectiveConcurrency);
      const results = await Promise.allSettled(batch.map((task) => handleExecuteTask(task.id)));
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          setActiveCrafterId(result.value.id);
          break;
        }
      }
    }
  }, [handleExecuteTask, routaTasks]);

  const handleSelectCrafter = useCallback((agentId: string) => {
    setActiveCrafterId(agentId);
    const matchedAgent = crafterAgents.find((agent) => agent.id === agentId);
    if (matchedAgent?.sessionId) {
      setFocusedSessionId(matchedAgent.sessionId);
      bumpRefresh();
    }
  }, [bumpRefresh, crafterAgents, setFocusedSessionId]);

  const findCrafterForNote = useCallback((note: NoteData) => {
    const childSessionId = note.metadata.childSessionId;
    const assignedAgentIds = note.metadata.assignedAgentIds ?? [];
    return crafterAgents.find((agent) =>
      agent.taskId === note.id ||
      (childSessionId ? agent.sessionId === childSessionId : false) ||
      agent.taskTitle === note.title ||
      assignedAgentIds.includes(agent.id),
    ) ?? null;
  }, [crafterAgents]);

  const handleSelectNoteTask = useCallback((noteId: string) => {
    const note = notesHook.notes.find((item) => item.id === noteId);
    if (!note) return;

    const childSessionId = note.metadata.childSessionId;
    const matchedAgent = findCrafterForNote(note);

    if (matchedAgent) {
      setActiveCrafterId(matchedAgent.id);
      if (matchedAgent.sessionId) {
        setFocusedSessionId(matchedAgent.sessionId);
        bumpRefresh();
      }
      return;
    }

    if (childSessionId) {
      setFocusedSessionId(childSessionId);
      bumpRefresh();
    }
  }, [bumpRefresh, findCrafterForNote, notesHook.notes, setFocusedSessionId]);

  const handleConcurrencyChange = useCallback((nextConcurrency: number) => {
    setConcurrency(nextConcurrency);
  }, []);

  useEffect(() => {
    for (const agent of crafterAgents) {
      const syncKey = `${agent.status}:${agent.taskId ?? ""}`;
      const previousStatus = syncedCrafterStatusRef.current.get(agent.id);
      if (previousStatus === syncKey) continue;
      syncedCrafterStatusRef.current.set(agent.id, syncKey);

      if (!agent.taskId) continue;
      const note = notesHook.notes.find((item) => item.id === agent.taskId);
      if (!note) continue;

      const nextTaskStatus = agent.status === "completed"
        ? "COMPLETED"
        : agent.status === "error"
          ? "FAILED"
          : agent.status === "running"
            ? "IN_PROGRESS"
            : note.metadata.taskStatus;

      const assignedAgentIds = note.metadata.assignedAgentIds ?? [];
      const shouldSyncAgentId = assignedAgentIds.length !== 1 || assignedAgentIds[0] !== agent.id;
      const shouldSyncChildSessionId = Boolean(agent.sessionId) && note.metadata.childSessionId !== agent.sessionId;
      const shouldSyncTaskStatus = Boolean(nextTaskStatus) && note.metadata.taskStatus !== nextTaskStatus;

      if (shouldSyncAgentId || shouldSyncChildSessionId || shouldSyncTaskStatus) {
        void notesHook.updateNote(agent.taskId, {
          metadata: {
            ...note.metadata,
            ...(nextTaskStatus ? { taskStatus: nextTaskStatus } : {}),
            assignedAgentIds: [agent.id],
            ...(agent.sessionId ? { childSessionId: agent.sessionId } : {}),
          },
        });
      }
    }
  }, [crafterAgents, notesHook]);

  useEffect(() => {
    const staleTasks = notesHook.notes.filter((note) => {
      if (note.metadata.type !== "task" || note.metadata.taskStatus !== "IN_PROGRESS") {
        return false;
      }

      const updatedAtMs = Date.parse(note.updatedAt);
      if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < 10_000) {
        return false;
      }

      const matchedAgent = findCrafterForNote(note);
      if (!matchedAgent) {
        return true;
      }

      return matchedAgent.status !== "running";
    });

    if (!staleTasks.length) return;

    void Promise.allSettled(staleTasks.map((note) => {
      const matchedAgent = findCrafterForNote(note);
      const nextStatus = matchedAgent?.status === "completed"
        ? "COMPLETED"
        : matchedAgent?.status === "error"
          ? "FAILED"
          : "PENDING";

      if (note.metadata.taskStatus === nextStatus) {
        return Promise.resolve(null);
      }

      return notesHook.updateNote(note.id, {
        metadata: {
          ...note.metadata,
          taskStatus: nextStatus,
        },
      });
    }));
  }, [findCrafterForNote, notesHook]);

  const handleExecuteQuickAccessNoteTask = useCallback(async (noteId: string): Promise<CrafterAgent | null> => {
    const note = notesHook.notes.find((item) => item.id === noteId);
    if (!note) return null;

    if (concurrency <= 1 && runningCrafterCountRef.current > 0) {
      noteTaskQueueRef.current.push({ noteId, mode: "quick-access" });
      return null;
    }

    runningCrafterCountRef.current++;

    await notesHook.updateNote(noteId, {
      metadata: { ...note.metadata, taskStatus: "IN_PROGRESS" },
    });

    try {
      const createResult = await callMcpTool("create_task", {
        title: note.title,
        objective: note.content || note.title,
        creationSource: "session",
        workspaceId,
        sessionId,
      });

      const mcpTaskId = extractResultId(createResult?.content?.[0]?.text ?? "{}");
      let agentId: string | undefined;
      let childSessionId: string | undefined;
      let delegationError: string | undefined;

      if (!mcpTaskId) {
        delegationError = "Failed to create task in MCP task store.";
      } else {
        try {
          const delegateResult = await callMcpTool("delegate_task_to_agent", {
            taskId: mcpTaskId,
            callerAgentId: "routa-ui",
            callerSessionId: sessionId,
            specialist: "CRAFTER",
          });
          const delegation = extractDelegationPayload(delegateResult?.content?.[0]?.text ?? "{}");
          agentId = delegation.agentId;
          childSessionId = delegation.sessionId;
          delegationError = delegation.error;
        } catch (error) {
          delegationError = error instanceof Error ? error.message : String(error);
        }
      }

      const crafterAgent: CrafterAgent = {
        id: agentId ?? `crafter-collab-${noteId}`,
        sessionId: childSessionId ?? "",
        taskId: noteId,
        taskTitle: note.title,
        status: delegationError ? "error" : "running",
        messages: delegationError
          ? [{
              id: crypto.randomUUID(),
              role: "info",
              content: `Delegation failed: ${delegationError}`,
              timestamp: new Date(),
            }]
          : [],
      };

      if (delegationError) {
        await notesHook.updateNote(noteId, {
          metadata: { ...note.metadata, taskStatus: "FAILED" },
        });
        runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
      }

      if (!delegationError && (childSessionId || agentId || mcpTaskId)) {
        await notesHook.updateNote(noteId, {
          metadata: {
            ...note.metadata,
            taskStatus: "IN_PROGRESS",
            ...(childSessionId ? { childSessionId } : {}),
            ...(mcpTaskId ? { linkedTaskId: mcpTaskId } : {}),
            ...(agentId ? { assignedAgentIds: [agentId] } : {}),
          },
        });
      }

      setCrafterAgents((prev) => [...prev, crafterAgent]);
      setActiveCrafterId(crafterAgent.id);
      if (childSessionId) {
        setFocusedSessionId(childSessionId);
        bumpRefresh();
      }

      return crafterAgent;
    } catch {
      runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
      await notesHook.updateNote(noteId, {
        metadata: { ...note.metadata, taskStatus: "PENDING" },
      });
      return null;
    }
  }, [bumpRefresh, callMcpTool, concurrency, notesHook, sessionId, setFocusedSessionId, workspaceId]);

  const handleExecuteProviderNoteTask = useCallback(async (noteId: string): Promise<CrafterAgent | null> => {
    const note = notesHook.notes.find((item) => item.id === noteId);
    if (!note) return null;

    if (concurrency <= 1 && runningCrafterCountRef.current > 0) {
      noteTaskQueueRef.current.push({ noteId, mode: "provider" });
      return null;
    }

    runningCrafterCountRef.current++;

    const existingMetadata = note.metadata ?? {};
    const { provider, model, baseUrl, apiKey } = resolveAgentConfig("CRAFTER");
    const branch = repoSelection?.branch || undefined;
    const cwd = repoSelection?.path ?? undefined;
    const promptText = [note.title.trim(), note.content?.trim()].filter(Boolean).join("\n\n");

    await notesHook.updateNote(noteId, {
      metadata: { ...existingMetadata, taskStatus: "IN_PROGRESS" },
    });

    const providerClient = new BrowserAcpClient(getDesktopApiBaseUrl());
    let childSessionId: string | null = null;
    let crafterAgentId: string | null = null;

    try {
      await providerClient.initialize();
      const sessionResult = await providerClient.newSession({
        cwd,
        branch,
        name: note.title,
        provider,
        role: "CRAFTER",
        workspaceId,
        model,
        parentSessionId: sessionId,
        baseUrl,
        apiKey,
      });

      childSessionId = sessionResult.sessionId;
      crafterAgentId = sessionResult.routaAgentId ?? sessionResult.sessionId;
      providerChildClientsRef.current.set(childSessionId, providerClient);

      providerClient.onUpdate((notification) => {
        const raw = notification as Record<string, unknown>;
        const update = (raw.update ?? raw) as Record<string, unknown>;
        const notificationSessionId = (notification.sessionId ?? raw.sessionId) as string | undefined;

        if (!childSessionId || notificationSessionId !== childSessionId || !crafterAgentId) {
          return;
        }

        setCrafterAgents((prev) => {
          const agentIndex = prev.findIndex((agent) => agent.id === crafterAgentId);
          if (agentIndex < 0) return prev;

          const nextAgents = [...prev];
          const nextAgent = { ...nextAgents[agentIndex] };
          let messages = [...nextAgent.messages];
          const kind = update.sessionUpdate as string | undefined;

          switch (kind) {
            case "agent_message_chunk":
              messages = appendStreamMessage(messages, "assistant", extractUpdateText(update));
              break;
            case "agent_thought_chunk":
              messages = appendStreamMessage(messages, "thought", extractUpdateText(update));
              break;
            case "tool_call":
              messages.push({
                id: (update.toolCallId as string | undefined) ?? crypto.randomUUID(),
                role: "tool",
                content: getToolEventLabel(update),
                timestamp: new Date(),
                toolName: getToolEventLabel(update),
                toolStatus: (update.status as string | undefined) ?? "running",
              });
              break;
            case "tool_call_update": {
              const toolCallId = update.toolCallId as string | undefined;
              if (!toolCallId) return prev;
              const messageIndex = messages.findIndex((message) => message.id === toolCallId);
              if (messageIndex >= 0) {
                messages[messageIndex] = {
                  ...messages[messageIndex],
                  toolName: getToolEventLabel(update) ?? messages[messageIndex].toolName,
                  toolStatus: (update.status as string | undefined) ?? messages[messageIndex].toolStatus,
                };
              }
              break;
            }
            case "completed":
            case "ended":
            case "turn_complete":
              nextAgent.status = "completed";
              break;
            default:
              return prev;
          }

          nextAgent.messages = messages;
          nextAgents[agentIndex] = nextAgent;
          return nextAgents;
        });
      });

      const crafterAgent: CrafterAgent = {
        id: crafterAgentId,
        sessionId: childSessionId,
        taskId: noteId,
        taskTitle: note.title,
        status: "running",
        messages: [],
      };

      setCrafterAgents((prev) => [...prev, crafterAgent]);
      setActiveCrafterId(crafterAgent.id);
      setFocusedSessionId(childSessionId);
      bumpRefresh();

      await notesHook.updateNote(noteId, {
        metadata: {
          ...existingMetadata,
          taskStatus: "IN_PROGRESS",
          childSessionId,
          provider,
          assignedAgentIds: [crafterAgent.id],
        },
      });

      const promptResult = await providerClient.prompt(childSessionId, promptText || note.title);
      const finalContent = promptResult.content?.trim();
      const finalMessages = finalContent
        ? [{
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: finalContent,
            timestamp: new Date(),
          }]
        : [];

      setCrafterAgents((prev) => prev.map((agent) => (
        agent.id !== crafterAgent.id
          ? agent
          : {
              ...agent,
              status: "completed",
              messages: finalMessages.length > 0 ? finalMessages : agent.messages,
            }
      )));

      await notesHook.updateNote(noteId, {
        metadata: {
          ...existingMetadata,
          taskStatus: "COMPLETED",
          childSessionId,
          provider,
        },
      });

      providerClient.disconnect();
      providerChildClientsRef.current.delete(childSessionId);
      runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);

      return {
        id: crafterAgent.id,
        sessionId: childSessionId,
        taskId: noteId,
        taskTitle: note.title,
        status: "completed",
        messages: finalMessages,
      };
    } catch (error) {
      if (shouldSuppressTeardownError(error)) {
        if (childSessionId) {
          providerClient.disconnect();
          providerChildClientsRef.current.delete(childSessionId);
        }
        runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
        return null;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (crafterAgentId && childSessionId) {
        setCrafterAgents((prev) => prev.map((agent) => (
          agent.id !== crafterAgentId
            ? agent
            : {
                ...agent,
                status: "error",
                messages: [{
                  id: crypto.randomUUID(),
                  role: "info",
                  content: `Execution failed: ${errorMessage}`,
                  timestamp: new Date(),
                }],
              }
        )));
      }

      await notesHook.updateNote(noteId, {
        metadata: {
          ...existingMetadata,
          taskStatus: "FAILED",
          ...(childSessionId ? { childSessionId } : {}),
          provider,
        },
      });

      if (childSessionId) {
        providerClient.disconnect();
        providerChildClientsRef.current.delete(childSessionId);
      }

      runningCrafterCountRef.current = Math.max(0, runningCrafterCountRef.current - 1);
      return null;
    }
  }, [bumpRefresh, concurrency, notesHook, repoSelection, resolveAgentConfig, sessionId, setFocusedSessionId, workspaceId]);

  useEffect(() => {
    const previousRunning = runningCrafterCountRef.current;
    const currentRunning = crafterAgents.filter((agent) => agent.status === "running").length;
    runningCrafterCountRef.current = currentRunning;

    if (currentRunning >= previousRunning) return;

    const queuedNoteTask = noteTaskQueueRef.current.shift();
    if (queuedNoteTask) {
      const handler = queuedNoteTask.mode === "provider"
        ? handleExecuteProviderNoteTask
        : handleExecuteQuickAccessNoteTask;
      void handler(queuedNoteTask.noteId).then((agent) => {
        if (agent) setActiveCrafterId(agent.id);
      });
      return;
    }

    const taskId = routaTaskQueueRef.current.shift();
    if (taskId && handleExecuteTaskRef.current) {
      void handleExecuteTaskRef.current(taskId).then((agent) => {
        if (agent) setActiveCrafterId(agent.id);
      });
    }
  }, [crafterAgents, handleExecuteProviderNoteTask, handleExecuteQuickAccessNoteTask]);

  const handleExecuteSelectedNoteTasks = useCallback(async (noteIds: string[], requestedConcurrency: number) => {
    const pendingNoteIds = noteIds.filter((noteId) => {
      const note = notesHook.notes.find((item) => item.id === noteId);
      return Boolean(note && (!note.metadata.taskStatus || note.metadata.taskStatus === "PENDING"));
    });
    if (!pendingNoteIds.length) return;

    const effectiveConcurrency = Math.max(1, Math.min(requestedConcurrency, pendingNoteIds.length));
    const queue = [...pendingNoteIds];
    while (queue.length > 0) {
      const batch = queue.splice(0, effectiveConcurrency);
      await Promise.allSettled(batch.map((noteId) => handleExecuteProviderNoteTask(noteId)));
    }
  }, [handleExecuteProviderNoteTask, notesHook.notes]);

  const handleExecuteAllNoteTasks = useCallback(async (requestedConcurrency: number) => {
    const pendingNoteIds = notesHook.notes
      .filter((note) => note.metadata.type === "task" && (!note.metadata.taskStatus || note.metadata.taskStatus === "PENDING"))
      .map((note) => note.id);
    await handleExecuteSelectedNoteTasks(pendingNoteIds, requestedConcurrency);
  }, [handleExecuteSelectedNoteTasks, notesHook.notes]);

  const handleOpenOrExecuteNoteTask = useCallback(async (noteId: string): Promise<CrafterAgent | null> => {
    const note = notesHook.notes.find((item) => item.id === noteId);
    if (!note) return null;

    const matchedAgent = findCrafterForNote(note);
    if (matchedAgent || note.metadata.childSessionId) {
      handleSelectNoteTask(noteId);
      return matchedAgent;
    }

    return handleExecuteProviderNoteTask(noteId);
  }, [findCrafterForNote, handleExecuteProviderNoteTask, handleSelectNoteTask, notesHook.notes]);

  useEffect(() => {
    handleExecuteTaskRef.current = handleExecuteTask;
  }, [handleExecuteTask]);

  return {
    routaTasks,
    crafterAgents,
    activeCrafterId,
    concurrency,
    handleTasksDetected,
    handleConfirmAllTasks,
    handleConfirmTask,
    handleEditTask,
    handleExecuteTask,
    handleExecuteAllTasks,
    handleSelectCrafter,
    handleSelectNoteTask,
    handleConcurrencyChange,
    handleExecuteProviderNoteTask,
    handleOpenOrExecuteNoteTask,
    handleExecuteAllNoteTasks,
    handleExecuteSelectedNoteTasks,
    handleUpdateAgentMessages,
  };
}
