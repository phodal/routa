"use client";

/**
 * ChatPanel - Full-screen ACP chat interface
 *
 * Renders streaming `session/update` SSE notifications from an opencode process.
 * Handles all ACP sessionUpdate types.
 */

import {useCallback, useEffect, useMemo, useRef, useState,} from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import {v4 as uuidv4} from "uuid";
import type {AcpSessionNotification} from "../acp-client";
import type {UseAcpActions, UseAcpState} from "../hooks/use-acp";
import {type InputContext, TiptapInput} from "./tiptap-input";
import type {SkillSummary} from "../skill-client";
import {type RepoSelection} from "./repo-picker";
import {SetupView} from "./chat-panel/components";
import {extractTaskBlocks, hasTaskBlocks, type ParsedTask,} from "../utils/task-block-parser";
import {type TaskInfo, TaskProgressBar, type FileChangesSummary} from "./task-progress-bar";
import {
  MessageBubble,
  isAskUserQuestionMessage,
  AskUserQuestionBubble,
  hasAskUserQuestionAnswers,
} from "@/client/components/message-bubble";
import {TracePanel} from "@/client/components/trace-panel";
import {type ChecklistItem, parseChecklist} from "../utils/checklist-parser";
import type {WorkspaceData, CodebaseData} from "../hooks/use-workspaces";
import {
  type FileChangesState,
  createFileChangesState,
  updateFileChange,
  extractFileChangeFromToolResult,
  extractFilesModified,
  getFileChangesSummary,
} from "../utils/file-changes-tracker";

// ─── Message Types ─────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "thought" | "tool" | "plan" | "info" | "terminal";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolKind?: string;
  /** Raw input parameters for tool calls */
  toolRawInput?: Record<string, unknown>;
  /** Task ID for delegated tasks (delegate_task_to_agent) */
  delegatedTaskId?: string;
  /** Completion summary when a delegated task completes */
  completionSummary?: string;
  /** Raw update payload for debug/info display */
  rawData?: Record<string, unknown>;
  planEntries?: PlanEntry[];
  usageUsed?: number;
  usageSize?: number;
  costAmount?: number;
  costCurrency?: string;
  // Terminal fields
  terminalId?: string;
  terminalCommand?: string;
  terminalArgs?: string[];
  terminalExited?: boolean;
  terminalExitCode?: number | null;
}

export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status?: "pending" | "in_progress" | "completed";
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ChatPanelProps {
  acp: UseAcpState & UseAcpActions;
  activeSessionId: string | null;
  onEnsureSession: (cwd?: string, provider?: string, modeId?: string, model?: string) => Promise<string | null>;
  onSelectSession: (sessionId: string) => Promise<void>;
  skills?: SkillSummary[];
  repoSkills?: SkillSummary[];
  onLoadSkill?: (name: string) => Promise<string | null>;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;
  onTasksDetected?: (tasks: ParsedTask[]) => void;
  agentRole?: string;
  onAgentRoleChange?: (role: string) => void;
  onCreateSession?: (provider: string) => void;
  workspaces?: WorkspaceData[];
  activeWorkspaceId?: string | null;
  onWorkspaceChange?: (id: string) => void;
  codebases?: CodebaseData[];
  /** When set, pre-fills the chat input (e.g. to restore text after a session error) */
  inputPrefill?: string | null;
  /** Called after inputPrefill has been consumed */
  onInputPrefillConsumed?: () => void;
}

// ─── Main Component ────────────────────────────────────────────────────

export function ChatPanel({
  acp,
  activeSessionId,
  onEnsureSession,
  onSelectSession,
  skills = [],
  repoSkills = [],
  agentRole,
  onAgentRoleChange,
  onCreateSession: _onCreateSession,
  onLoadSkill,
  repoSelection,
  onRepoChange,
  onTasksDetected,
  workspaces = [],
  activeWorkspaceId,
  onWorkspaceChange,
  codebases: _codebases = [],
  inputPrefill,
  onInputPrefillConsumed,
}: ChatPanelProps) {
  const { connected, loading, error, authError, updates, prompt, clearAuthError } = acp;
  const [sessions, setSessions] = useState<Array<{
    sessionId: string;
    provider?: string;
    modeId?: string;
  }>>([]);
  const [sessionModeById, setSessionModeById] = useState<Record<string, string>>({});
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // View mode: 'chat' or 'trace'
  const [viewMode, setViewMode] = useState<"chat" | "trace">("chat");
  // Track if session is currently running (receiving updates)
  const [isSessionRunning, setIsSessionRunning] = useState(false);

  const streamingMsgIdRef = useRef<Record<string, string | null>>({});
  const streamingThoughtIdRef = useRef<Record<string, string | null>>({});
  const lastProcessedUpdateIndexRef = useRef(0);
  // Track the last update kind per session to determine when to create new messages
  const lastUpdateKindRef = useRef<Record<string, string | null>>({});

  // Checklist items parsed from agent responses (for Todos display)
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  // File changes tracked from tool executions
  const [fileChangesState, setFileChangesState] = useState<FileChangesState>(createFileChangesState);
  // Usage info from the last turn completion
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);

  // Extract task-type tool calls for TaskProgressBar (existing behavior)
  const delegatedTasks = useMemo<TaskInfo[]>(() => {
    return visibleMessages
      .filter((msg) => msg.role === "tool" && msg.toolKind === "task")
      .map((msg) => {
        const rawInput = msg.toolRawInput ?? {};
        const description = (rawInput.description as string) ?? "";
        const subagentType = (rawInput.subagent_type as string) ?? (rawInput.specialist as string) ?? "";
        // Map toolStatus to TaskInfo status
        let status: TaskInfo["status"] = "pending";
        if (msg.toolStatus === "completed") status = "completed";
        else if (msg.toolStatus === "failed") status = "failed";
        else if (msg.toolStatus === "delegated") status = "delegated";
        else if (msg.toolStatus === "running" || msg.toolStatus === "in_progress") status = "running";

        return {
          id: msg.id,
          title: description || msg.toolName || "Task",
          description,
          subagentType,
          status,
          completionSummary: msg.completionSummary,
        };
      });
  }, [visibleMessages]);

  // Extract plan entries from plan messages
  const planTasks = useMemo<TaskInfo[]>(() => {
    // Find the latest plan message with entries
    const planMessages = visibleMessages.filter(
      (msg) => msg.role === "plan" && msg.planEntries && msg.planEntries.length > 0
    );
    if (planMessages.length === 0) return [];

    // Use the most recent plan
    const latestPlan = planMessages[planMessages.length - 1];
    return (latestPlan.planEntries ?? []).map((entry, index) => ({
      id: `plan-${index}`,
      title: entry.content,
      status: entry.status === "completed" ? "completed"
        : entry.status === "in_progress" ? "running"
        : "pending",
      description: entry.priority ? `Priority: ${entry.priority}` : undefined,
    }));
  }, [visibleMessages]);

  // Combine checklist items into TaskInfo format for display
  const taskInfos = useMemo<TaskInfo[]>(() => {
    // Convert checklist items to TaskInfo
    const checklistTasks: TaskInfo[] = checklistItems.map((item) => ({
      id: item.id,
      title: item.text,
      status: item.status === "in_progress" ? "running" :
              item.status === "cancelled" ? "failed" :
              item.status as TaskInfo["status"],
    }));

    // Priority: checklist items > plan tasks > delegated tasks
    if (checklistTasks.length > 0) return checklistTasks;
    if (planTasks.length > 0) return planTasks;
    return delegatedTasks;
  }, [checklistItems, planTasks, delegatedTasks]);

  // Pending AskUserQuestion messages — shown sticky above input, not in chat stream
  const pendingAskUserQuestions = useMemo(() => {
    return visibleMessages.filter(
      (msg) =>
        msg.role === "tool" &&
        isAskUserQuestionMessage(msg) &&
        !hasAskUserQuestionAnswers(msg) &&
        msg.toolStatus !== "failed",
    );
  }, [visibleMessages]);

  // File changes summary for TaskProgressBar
  const fileChangesSummary = useMemo<FileChangesSummary | undefined>(() => {
    const summary = getFileChangesSummary(fileChangesState);
    if (summary.fileCount === 0) return undefined;
    return summary;
  }, [fileChangesState]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  // Track which sessions we've already loaded history for
  const loadedHistoryRef = useRef<Set<string>>(new Set());

  // Fetch and process session history when switching sessions
  const fetchSessionHistory = useCallback(async (sessionId: string) => {
    // Skip if already loaded or if sessionId is a placeholder (static export mode)
    if (loadedHistoryRef.current.has(sessionId)) return;
    if (sessionId === "__placeholder__") return;

    try {
      const res = await desktopAwareFetch(`/api/sessions/${sessionId}/history`, { cache: "no-store" });
      const data = await res.json();
      const history = Array.isArray(data?.history) ? data.history as AcpSessionNotification[] : [];

      if (history.length === 0) {
        loadedHistoryRef.current.add(sessionId);
        return;
      }

      // Process history into messages
      const messages: ChatMessage[] = [];
      let streamingMsgId: string | null = null;
      let streamingThoughtId: string | null = null;
      let lastKind: string | null = null;

      for (const notification of history) {
        const update = (notification.update ?? notification) as Record<string, unknown>;
        const kind = update.sessionUpdate as string | undefined;
        if (!kind) continue;

        const extractText = (): string => {
          const content = update.content as { type: string; text?: string } | undefined;
          if (content?.text) return content.text;
          if (typeof update.text === "string") return update.text;
          return "";
        };

        switch (kind) {
          case "agent_message_chunk": {
            const text = extractText();
            if (!text) break;
            streamingThoughtId = null;
            const shouldCreateNew = lastKind !== "agent_message_chunk";
            if (shouldCreateNew) streamingMsgId = null;
            if (!streamingMsgId) {
              streamingMsgId = uuidv4();
              messages.push({ id: streamingMsgId, role: "assistant", content: text, timestamp: new Date() });
            } else {
              const idx = messages.findIndex((m) => m.id === streamingMsgId);
              if (idx >= 0) messages[idx] = { ...messages[idx], content: messages[idx].content + text };
            }
            break;
          }
          // Consolidated form of agent_message_chunk (stored in DB via getConsolidatedHistory)
          case "agent_message": {
            const text = extractText();
            if (!text) break;
            streamingThoughtId = null;
            streamingMsgId = uuidv4();
            messages.push({ id: streamingMsgId, role: "assistant", content: text, timestamp: new Date() });
            break;
          }
          case "agent_thought_chunk": {
            const text = extractText();
            if (!text) break;
            const shouldCreateNewThought = lastKind !== "agent_thought_chunk";
            if (shouldCreateNewThought) streamingThoughtId = null;
            if (!streamingThoughtId) {
              streamingThoughtId = uuidv4();
              messages.push({ id: streamingThoughtId, role: "thought", content: text, timestamp: new Date() });
            } else {
              const idx = messages.findIndex((m) => m.id === streamingThoughtId);
              if (idx >= 0) messages[idx] = { ...messages[idx], content: messages[idx].content + text };
            }
            break;
          }
          case "user_message": {
            const text = extractText();
            if (text) messages.push({ id: uuidv4(), role: "user", content: text, timestamp: new Date() });
            streamingMsgId = null;
            streamingThoughtId = null;
            break;
          }
          case "tool_call":
            // eslint-disable-next-line no-fallthrough
          case "tool_call_update": {
            const toolKind = update.kind as string | undefined;
            const title = (update.title as string) ?? toolKind ?? "tool";
            const status = (update.status as string) ?? "completed";
            const rawInput = (typeof update.rawInput === "object" && update.rawInput !== null)
              ? update.rawInput as Record<string, unknown>
              : undefined;
            const contentParts: string[] = [];
            if (update.rawInput) {
              contentParts.push(`Input:\n${typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput, null, 2)}`);
            }
            const toolContent = update.content as Array<{ type: string; text?: string }> | undefined;
            if (Array.isArray(toolContent)) {
              for (const c of toolContent) if (c.text) contentParts.push(c.text);
            }
            messages.push({
              id: uuidv4(),
              role: "tool",
              content: contentParts.join("\n\n") || title,
              toolName: title,
              toolStatus: status,
              toolKind,
              toolRawInput: rawInput,
              timestamp: new Date(),
            });
            break;
          }
          case "process_output": {
            const processData = update.data as string | undefined;
            const processSource = update.source as string | undefined;
            const processDisplayName = update.displayName as string | undefined;
            if (processData) {
              const processTermId = `process-${sessionId}`;
              const idx = messages.findIndex(
                (m) => m.role === "terminal" && m.terminalId === processTermId
              );
              if (idx >= 0) {
                messages[idx] = {
                  ...messages[idx],
                  content: messages[idx].content + processData,
                };
              } else {
                messages.push({
                  id: processTermId,
                  role: "terminal",
                  content: processData,
                  timestamp: new Date(),
                  terminalId: processTermId,
                  terminalCommand: processDisplayName ?? "Agent Process",
                  terminalArgs: processSource ? [processSource] : undefined,
                  terminalExited: false,
                  terminalExitCode: null,
                });
              }
            }
            break;
          }
          case "acp_status": {
            // Docker/ACP errors are handled as a config popup, not inline messages
            break;
          }
        }
        lastKind = kind;
      }

      loadedHistoryRef.current.add(sessionId);

      // Check if session is still running (last update is not turn_complete)
      if (history.length > 0) {
        const lastUpdate = history[history.length - 1];
        const lastKindFromHistory = ((lastUpdate.update ?? lastUpdate) as Record<string, unknown>).sessionUpdate as string | undefined;
        const isRunning = lastKindFromHistory !== "turn_complete" && lastKindFromHistory !== "acp_status";
        setIsSessionRunning(isRunning);
      }

      if (messages.length > 0) {
        // Extract tasks from loaded history
        let detectedTasks: ParsedTask[] = [];
        const processedMessages = [...messages];

        for (let i = 0; i < processedMessages.length; i++) {
          const msg = processedMessages[i];
          if (msg.role === "assistant" && hasTaskBlocks(msg.content)) {
            const { tasks, cleanedContent } = extractTaskBlocks(msg.content);
            if (tasks.length > 0) {
              // Replace the message content with cleaned version (tasks removed)
              processedMessages[i] = { ...msg, content: cleanedContent };
              detectedTasks = tasks;
            }
          }
        }

        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: processedMessages,
        }));

        // Notify parent about detected tasks from history
        if (detectedTasks.length > 0 && onTasksDetected) {
          onTasksDetected(detectedTasks);
        }
      }
    } catch {
      // ignore errors
    }
  }, [onTasksDetected]);

  // When active session changes, swap visible transcript and load history
  useEffect(() => {
    if (!activeSessionId) {
       
      setVisibleMessages([]);
      return;
    }
    // Clear processed message IDs when switching sessions
    processedMessageIdsRef.current.clear();
    // Reset running state when switching sessions (will be updated by SSE)
    setIsSessionRunning(false);
    // Load history if not yet loaded
    fetchSessionHistory(activeSessionId);
  }, [activeSessionId, fetchSessionHistory]);

  // Update visible messages when messagesBySession changes
  useEffect(() => {
    if (activeSessionId) {
       
      setVisibleMessages(messagesBySession[activeSessionId] ?? []);
    }
  }, [activeSessionId, messagesBySession]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await desktopAwareFetch("/api/sessions", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(list);
      const modeMap: Record<string, string> = {};
      for (const s of list) {
        if (s?.sessionId && s?.modeId) {
          modeMap[s.sessionId] = s.modeId;
        }
      }
      setSessionModeById((prev) => ({ ...prev, ...modeMap }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
     
    fetchSessions();
  }, [fetchSessions, activeSessionId]);

  // ── Process ACP SSE updates ──────────────────────────────────────────

  useEffect(() => {
    if (!updates.length) {
      lastProcessedUpdateIndexRef.current = 0;
      return;
    }

    const startIndex =
      lastProcessedUpdateIndexRef.current > updates.length
        ? 0
        : lastProcessedUpdateIndexRef.current;
    const pending = updates.slice(startIndex) as AcpSessionNotification[];
    if (!pending.length) return;
    lastProcessedUpdateIndexRef.current = updates.length;

    const modeUpdates: Record<string, string> = {};

    setMessagesBySession((prev) => {
      const next = { ...prev };
      const getSessionMessages = (sid: string): ChatMessage[] => {
        if (!next[sid]) {
          next[sid] = [];
          return next[sid];
        }
        next[sid] = [...next[sid]];
        return next[sid];
      };

      for (const notification of pending) {
        const sid = notification.sessionId;
        const update = (notification.update ?? notification) as Record<string, unknown>;
        const kind = update.sessionUpdate as string | undefined;
        if (!sid || !kind) continue;

        // Skip child agent updates — these are pushed to the parent session's SSE
        // but belong to the TaskPanel CrafterAgent view, not the main chat.
        const rawNotification = notification as Record<string, unknown>;
        const isChildAgentUpdate = !!(rawNotification.childAgentId ?? (update.childAgentId as unknown));
        if (isChildAgentUpdate) continue;

        const arr = getSessionMessages(sid);
        const extractText = (): string => {
          const content = update.content as
            | { type: string; text?: string }
            | undefined;
          if (content?.text) return content.text;
          if (typeof update.text === "string") return update.text;
          return "";
        };

        const lastKind = lastUpdateKindRef.current[sid];

        // Track session running state for the active session
        if (sid === activeSessionId) {
          if (kind === "agent_message_chunk" || kind === "tool_call" || kind === "agent_reasoning_chunk") {
            setIsSessionRunning(true);
          } else if (kind === "turn_complete") {
            setIsSessionRunning(false);
          }
        }

        switch (kind) {
          case "agent_message_chunk": {
            const text = extractText();
            if (!text) break;
            streamingThoughtIdRef.current[sid] = null;

            // If last update was NOT agent_message_chunk, create a new message
            const shouldCreateNew = lastKind !== "agent_message_chunk";
            if (shouldCreateNew) {
              streamingMsgIdRef.current[sid] = null;
            }

            let msgId = streamingMsgIdRef.current[sid];
            if (!msgId) {
              msgId = uuidv4();
              streamingMsgIdRef.current[sid] = msgId;
            }
            const idx = arr.findIndex((m) => m.id === msgId);
            if (idx >= 0) {
              const updatedContent = arr[idx].content + text;
              arr[idx] = { ...arr[idx], content: updatedContent };
              // Parse checklist from accumulated content
              const parsedChecklist = parseChecklist(updatedContent);
              if (parsedChecklist.length > 0) {
                setChecklistItems(parsedChecklist);
              }
            } else {
              arr.push({ id: msgId, role: "assistant", content: text, timestamp: new Date() });
              // Parse checklist from new content
              const parsedChecklist = parseChecklist(text);
              if (parsedChecklist.length > 0) {
                setChecklistItems(parsedChecklist);
              }
            }
            break;
          }

          case "agent_thought_chunk": {
            const text = extractText();
            if (!text) break;

            // If last update was NOT agent_thought_chunk, create a new thought
            const shouldCreateNewThought = lastKind !== "agent_thought_chunk";
            if (shouldCreateNewThought) {
              streamingThoughtIdRef.current[sid] = null;
            }

            let thoughtId = streamingThoughtIdRef.current[sid];
            if (!thoughtId) {
              thoughtId = uuidv4();
              streamingThoughtIdRef.current[sid] = thoughtId;
            }
            const idx = arr.findIndex((m) => m.id === thoughtId);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], content: arr[idx].content + text };
            } else {
              arr.push({ id: thoughtId, role: "thought", content: text, timestamp: new Date() });
            }
            break;
          }

          case "tool_call": {
            const toolCallId = update.toolCallId as string | undefined;
            const title = (update.title as string) ?? "tool";
            const status = (update.status as string) ?? "running";
            const toolKind = update.kind as string | undefined;
            const rawInput = (typeof update.rawInput === "object" && update.rawInput !== null)
              ? update.rawInput as Record<string, unknown>
              : undefined;
            const contentParts: string[] = [];
            if (update.rawInput) {
              contentParts.push(
                `Input:\n${typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput, null, 2)}`
              );
            }
            const toolContent = update.content as Array<{ type: string; text?: string }> | undefined;
            if (Array.isArray(toolContent)) {
              for (const c of toolContent) {
                if (c.text) contentParts.push(c.text);
              }
            }
            // Avoid duplicates if the same tool_call event is replayed (e.g. on reconnect)
            const alreadyExists = toolCallId && arr.some((m) => m.toolCallId === toolCallId);
            if (!alreadyExists) {
              arr.push({
                id: toolCallId ?? uuidv4(),
                role: "tool",
                content: contentParts.join("\n\n") || title,
                timestamp: new Date(),
                toolName: title,
                toolStatus: status,
                toolCallId,
                toolKind,
                toolRawInput: rawInput,
              });
            }
            break;
          }

          case "tool_call_update": {
            const toolCallId = update.toolCallId as string | undefined;
            const status = update.status as string | undefined;
            const delegatedTaskId = update.delegatedTaskId as string | undefined;
            const toolKind = update.kind as string | undefined;
            const toolName = (update.title as string) ?? toolKind;
            const rawOutput = typeof update.rawOutput === "string" ? update.rawOutput : undefined;
            const rawInput = (typeof update.rawInput === "object" && update.rawInput !== null)
              ? update.rawInput as Record<string, unknown>
              : undefined;

            const outputParts: string[] = [];
            if (update.rawOutput) {
              outputParts.push(
                typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput, null, 2)
              );
            }
            const toolContent = update.content as Array<{ type: string; text?: string }> | null | undefined;
            if (Array.isArray(toolContent)) {
              for (const c of toolContent) {
                if (c.text) outputParts.push(c.text);
              }
            }

            // Track file changes from Edit, Write, save-file, etc.
            if (toolName && status === "completed") {
              const fileChange = extractFileChangeFromToolResult(toolName, rawOutput, rawInput);
              if (fileChange) {
                setFileChangesState((prev) => updateFileChange({ ...prev, files: new Map(prev.files) }, fileChange));
              }
            }

            if (toolCallId) {
              const idx = arr.findIndex((m) => m.toolCallId === toolCallId);
              if (idx >= 0) {
                const existing = arr[idx];
                arr[idx] = {
                  ...existing,
                  toolStatus: status ?? existing.toolStatus,
                  toolName: toolName ?? existing.toolName,
                  toolKind: toolKind ?? existing.toolKind,
                  // Save delegatedTaskId for matching with task_completion
                  delegatedTaskId: delegatedTaskId ?? existing.delegatedTaskId,
                  // Update rawInput if provided (for OpenCode deferred input)
                  toolRawInput: rawInput ?? existing.toolRawInput,
                  content: outputParts.length
                    ? `${existing.toolName ?? toolName ?? "tool"}\n\nOutput:\n${outputParts.join("\n")}`
                    : existing.content,
                };
              } else {
                arr.push({
                  id: uuidv4(),
                  role: "tool",
                  content: outputParts.join("\n") || `Tool ${status ?? "update"}`,
                  timestamp: new Date(),
                  toolStatus: status ?? "completed",
                  toolCallId,
                  toolName,
                  toolKind,
                  toolRawInput: rawInput,
                  delegatedTaskId,
                });
              }
            }
            break;
          }

          case "plan": {
            const entries = update.entries as PlanEntry[] | undefined;
            const planText = entries
              ? entries.map((e) => `[${e.status ?? "pending"}] ${e.content}${e.priority ? ` (${e.priority})` : ""}`).join("\n")
              : typeof update.plan === "string" ? update.plan : JSON.stringify(update, null, 2);
            arr.push({ id: uuidv4(), role: "plan", content: planText, timestamp: new Date(), planEntries: entries });
            break;
          }

          case "usage_update": {
            const used = update.used as number | undefined;
            const size = update.size as number | undefined;
            const cost = update.cost as { amount: number; currency: string } | null | undefined;
            const usageIdx = arr.findIndex((m) => m.role === "info" && m.usageUsed !== undefined);
            const usageMsg: ChatMessage = {
              id: usageIdx >= 0 ? arr[usageIdx].id : uuidv4(),
              role: "info",
              content: "",
              timestamp: new Date(),
              usageUsed: used,
              usageSize: size,
              costAmount: cost?.amount,
              costCurrency: cost?.currency,
            };
            if (usageIdx >= 0) {
              arr[usageIdx] = usageMsg;
            } else {
              arr.push(usageMsg);
            }
            break;
          }

          case "current_mode_update": {
            const modeId = update.currentModeId as string | undefined;
            if (modeId) {
              modeUpdates[sid] = modeId;
              // Don't display mode change messages to keep conversation clean
            }
            break;
          }

          case "terminal_created": {
            const terminalId = update.terminalId as string | undefined;
            const termCommand = update.command as string | undefined;
            const termArgs = update.args as string[] | undefined;
            if (terminalId && !arr.some((m) => m.terminalId === terminalId)) {
              arr.push({
                id: terminalId,
                role: "terminal",
                content: "",
                timestamp: new Date(),
                terminalId,
                terminalCommand: termCommand,
                terminalArgs: termArgs,
                terminalExited: false,
                terminalExitCode: null,
              });
            }
            break;
          }

          case "terminal_output": {
            const terminalId = update.terminalId as string | undefined;
            const termData = update.data as string | undefined;
            if (terminalId && termData) {
              const idx = arr.findIndex(
                (m) => m.role === "terminal" && m.terminalId === terminalId
              );
              if (idx >= 0) {
                arr[idx] = {
                  ...arr[idx],
                  content: arr[idx].content + termData,
                };
              } else {
                // Terminal output before terminal_created (edge case)
                arr.push({
                  id: terminalId,
                  role: "terminal",
                  content: termData,
                  timestamp: new Date(),
                  terminalId,
                  terminalExited: false,
                  terminalExitCode: null,
                });
              }
            }
            break;
          }

          case "terminal_exited": {
            const terminalId = update.terminalId as string | undefined;
            const termExitCode = update.exitCode as number | undefined;
            if (terminalId) {
              const idx = arr.findIndex(
                (m) => m.role === "terminal" && m.terminalId === terminalId
              );
              if (idx >= 0) {
                arr[idx] = {
                  ...arr[idx],
                  terminalExited: true,
                  terminalExitCode: termExitCode ?? 0,
                };
              }
            }
            break;
          }

          case "process_output": {
            // ACP agent process output (stderr/stdout)
            // Display in a dedicated process output terminal
            const processData = update.data as string | undefined;
            const processSource = update.source as string | undefined;
            const processDisplayName = update.displayName as string | undefined;
            if (processData) {
              const processTermId = `process-${sid}`;
              const idx = arr.findIndex(
                (m) => m.role === "terminal" && m.terminalId === processTermId
              );
              if (idx >= 0) {
                arr[idx] = {
                  ...arr[idx],
                  content: arr[idx].content + processData,
                };
              } else {
                // Create new process output terminal
                arr.push({
                  id: processTermId,
                  role: "terminal",
                  content: processData,
                  timestamp: new Date(),
                  terminalId: processTermId,
                  terminalCommand: processDisplayName ?? "Agent Process",
                  terminalArgs: processSource ? [processSource] : undefined,
                  terminalExited: false,
                  terminalExitCode: null,
                });
              }
            }
            break;
          }

          case "task_completion": {
            // Task completed by a child agent - find the matching tool message and update it
            const taskId = update.taskId as string | undefined;
            const completionSummary = update.completionSummary as string | undefined;
            const taskStatus = update.taskStatus as string | undefined;
            const filesModified = update.filesModified as string[] | undefined;

            // Track file changes from task completion
            if (filesModified && filesModified.length > 0) {
              const changes = extractFilesModified(filesModified);
              setFileChangesState((prev) => {
                let state = { ...prev, files: new Map(prev.files) };
                for (const change of changes) {
                  state = updateFileChange(state, change);
                }
                return state;
              });
            }

            if (taskId) {
              const idx = arr.findIndex(
                (m) => m.role === "tool" && m.delegatedTaskId === taskId
              );
              if (idx >= 0) {
                const existing = arr[idx];
                // Update the tool message status to "completed" and add summary
                arr[idx] = {
                  ...existing,
                  toolStatus: taskStatus === "COMPLETED" || taskStatus === "completed" ? "completed" : "failed",
                  completionSummary,
                  content: completionSummary
                    ? `${existing.toolName ?? "Task"}\n\n**Completed:**\n${completionSummary}`
                    : existing.content,
                };
                console.log(`[ChatPanel] Updated task ${taskId} status to ${taskStatus}`);
              }
            }
            break;
          }

          case "available_commands_update":
          case "config_option_update":
          case "session_info_update": {
            break;
          }
          case "acp_status": {
            // Docker/ACP errors are now handled as a popup in the session page
            break;
          }
          case "tool_call_start": {
            // Tool call streaming started - create placeholder entry
            const toolCallId = update.toolCallId as string | undefined;
            const toolName = update.toolName as string | undefined;
            const toolKind = update.kind as string | undefined;
            if (toolCallId) {
              arr.push({
                id: toolCallId,
                role: "tool",
                content: `${toolName ?? "tool"}\n\n(streaming parameters...)`,
                timestamp: new Date(),
                toolName: toolName ?? "tool",
                toolStatus: "streaming",
                toolCallId,
                toolKind,
              });
            }
            break;
          }

          case "tool_call_params_delta": {
            // Progressive tool parameter streaming
            const toolCallId = update.toolCallId as string | undefined;
            const parsedInput = update.parsedInput as Record<string, unknown> | null;
            const title = update.title as string | undefined;
            if (toolCallId) {
              const idx = arr.findIndex((m) => m.toolCallId === toolCallId);
              if (idx >= 0) {
                const existing = arr[idx];
                const inputPreview = parsedInput
                  ? `Input:\n${JSON.stringify(parsedInput, null, 2)}`
                  : "(streaming parameters...)";
                arr[idx] = {
                  ...existing,
                  content: `${title ?? existing.toolName ?? "tool"}\n\n${inputPreview}`,
                  toolRawInput: parsedInput ?? existing.toolRawInput,
                };
              }
            }
            break;
          }

          // ─── Extended Thinking Support ──────────────────────────────
          case "thinking_start": {
            // Extended thinking block started
            // Create a new thought message or use existing
            const thoughtId = `thinking-${uuidv4()}`;
            streamingThoughtIdRef.current[sid] = thoughtId;
            arr.push({
              id: thoughtId,
              role: "thought",
              content: "",
              timestamp: new Date(),
            });
            break;
          }

          case "thinking_stop": {
            // Extended thinking block completed
            const reasoningText = update.reasoningText as string | undefined;
            const thoughtId = streamingThoughtIdRef.current[sid];
            if (thoughtId && reasoningText) {
              const idx = arr.findIndex((m) => m.id === thoughtId);
              if (idx >= 0) {
                arr[idx] = {
                  ...arr[idx],
                  content: reasoningText,
                };
              }
            }
            streamingThoughtIdRef.current[sid] = null;
            break;
          }

          case "thinking_signature": {
            // Extended thinking signature delta - no UI action needed
            break;
          }

          // ─── Stop Reason Handling ───────────────────────────────────
          case "turn_complete": {
            const stopReason = update.stopReason as string | undefined;
            const usage = update.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            const reasoningText = update.reasoningText as string | undefined;

            // Capture and store usage info for display in input
            if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
              const inputTokens = usage.input_tokens ?? 0;
              const outputTokens = usage.output_tokens ?? 0;
              setUsageInfo({
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              });
            }

            // Log usage for debugging
            if (usage) {
              console.log(`[ChatPanel] Turn complete: ${stopReason}, tokens: in=${usage.input_tokens}, out=${usage.output_tokens}`);
            }

            // Handle specific stop reasons
            if (stopReason === "max_tokens") {
              // Add truncation warning message (use "info" role since "system" is not a valid MessageRole)
              arr.push({
                id: uuidv4(),
                role: "info",
                content: "⚠️ Response was truncated due to max tokens limit.",
                timestamp: new Date(),
              });
            }

            // Store reasoning text if present (Extended Thinking)
            if (reasoningText) {
              console.log(`[ChatPanel] Extended thinking completed: ${reasoningText.slice(0, 100)}...`);
            }
            break;
          }

          default:
            console.log(`[ChatPanel] Unhandled sessionUpdate: ${kind}`);
            break;
        }

        // Track last update kind for streaming message grouping
        lastUpdateKindRef.current[sid] = kind;
      }

      return next;
    });

    if (Object.keys(modeUpdates).length > 0) {
      setSessionModeById((prev) => ({ ...prev, ...modeUpdates }));
    }
  }, [updates]);

  // ── Extract tasks from messages after SSE updates ────────────────────
  // Track which messages have been checked for tasks to avoid re-processing
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onTasksDetected || !activeSessionId) return;

    const messages = messagesBySession[activeSessionId];
    if (!messages || messages.length === 0) return;

    // Check if any NEW assistant message contains task blocks
    let detectedTasks: ParsedTask[] = [];
    let hasNewTasksToExtract = false;

    for (const msg of messages) {
      if (msg.role === "assistant" &&
          !processedMessageIdsRef.current.has(msg.id) &&
          hasTaskBlocks(msg.content)) {
        hasNewTasksToExtract = true;
        break;
      }
    }

    if (!hasNewTasksToExtract) return;

    // Extract tasks and clean message content
    setMessagesBySession((prev) => {
      const msgs = prev[activeSessionId];
      if (!msgs) return prev;

      const arr = [...msgs];
      let tasksFound = false;

      for (let i = 0; i < arr.length; i++) {
        const msg = arr[i];
        if (msg.role === "assistant" &&
            !processedMessageIdsRef.current.has(msg.id) &&
            hasTaskBlocks(msg.content)) {
          const { tasks, cleanedContent } = extractTaskBlocks(msg.content);
          if (tasks.length > 0) {
            // Replace the message content with cleaned version (tasks removed)
            arr[i] = { ...msg, content: cleanedContent };
            detectedTasks = tasks;
            tasksFound = true;
            // Mark this message as processed
            processedMessageIdsRef.current.add(msg.id);
          }
        }
      }

      if (tasksFound) {
        return { ...prev, [activeSessionId]: arr };
      }
      return prev;
    });

    // Notify parent about detected tasks
    if (detectedTasks.length > 0) {
      onTasksDetected(detectedTasks);
    }
  }, [messagesBySession, activeSessionId, onTasksDetected]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleRepoChange = onRepoChange;

  const handleSubmitAskUserQuestion = useCallback(async (
    toolCallId: string,
    response: Record<string, unknown>,
  ) => {
    await acp.respondToUserInput(toolCallId, response);
    // Optimistically mark as completed so the sticky card disappears immediately
    if (activeSessionId) {
      setMessagesBySession((prev) => {
        const msgs = prev[activeSessionId] ?? [];
        return {
          ...prev,
          [activeSessionId]: msgs.map((msg) =>
            msg.toolCallId === toolCallId
              ? {
                  ...msg,
                  toolStatus: "completed",
                  toolRawInput: {
                    ...((msg.toolRawInput as Record<string, unknown>) ?? {}),
                    ...response,
                  },
                }
              : msg,
          ),
        };
      });
    }
  }, [acp, activeSessionId]);

  const handleSend = useCallback(async (text: string, context: InputContext) => {
    if (!text.trim()) return;

    // Use cwd from repo selection if set
    const cwd = context.cwd || repoSelection?.path || undefined;

    // If user selected a provider via @mention, switch to it
    if (context.provider) {
      acp.setProvider(context.provider);
    }

    if (context.sessionId && context.sessionId !== activeSessionId) {
      await onSelectSession(context.sessionId);
    }

    // Ensure we have a session — pass cwd and provider
    const sid = context.sessionId ?? activeSessionId ?? (await onEnsureSession(cwd, context.provider, context.mode, context.model));
    if (!sid) return;
    if (context.mode) {
      await acp.setMode(context.mode);
    }


    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // Build the final prompt:
    // - If a skill is selected, load its content and pass as structured context
    //   to the backend so it can inject via appendSystemPrompt (SDK) or
    //   prepend to prompt (CLI) for proper skill integration.
    let finalPrompt = text;
    let skillContext: { skillName: string; skillContent: string } | undefined;
    if (context.skill && onLoadSkill) {
      const skillContent = await onLoadSkill(context.skill);
      if (skillContent) {
        skillContext = { skillName: context.skill, skillContent };
        // Also prepend as fallback for providers that don't support appendSystemPrompt
        finalPrompt = `[Skill: ${context.skill}]\n${skillContent}\n\n---\n\n${text}`;
      }
    }

    // Show the user message
    setMessagesBySession((prev) => {
      const next = { ...prev };
      const arr = next[sid] ? [...next[sid]] : [];
      const displayParts: string[] = [];
      // @ is now for files
      if (context.files && context.files.length > 0) {
        for (const file of context.files) {
          displayParts.push(`@${file.label}`);
        }
      }
      // # is now for agents/sessions
      if (context.sessionId) displayParts.push(`#session-${context.sessionId.slice(0, 8)}`);
      if (context.provider) displayParts.push(`#${context.provider}`);
      if (context.mode) displayParts.push(`[${context.mode}]`);
      if (context.skill) displayParts.push(`/${context.skill}`);
      const prefix = displayParts.length ? displayParts.join(" ") + " " : "";
      arr.push({ id: uuidv4(), role: "user", content: prefix + text, timestamp: new Date() });
      next[sid] = arr;
      return next;
    });

    await prompt(finalPrompt, skillContext);

    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // Task extraction is now handled by the useEffect that watches messagesBySession
  }, [activeSessionId, onEnsureSession, onSelectSession, prompt, repoSelection, onLoadSkill, acp]);

  // ── Setup State ──────────────────────────────────────────────────────

  const [setupInput, setSetupInput] = useState("");

  const handleStartSession = useCallback(async () => {
    if (!setupInput.trim()) return;
    await handleSend(setupInput, {});
    setSetupInput("");
  }, [setupInput, handleSend]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f1117]">
      {/* Session info bar with view toggle */}
      {activeSessionId && (
        <div className="px-5 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
              Session: {activeSessionId.slice(0, 12)}...
            </span>
          </div>
          {/* View toggle: Chat | Trace */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-md p-0.5">
            <button
              onClick={() => setViewMode("chat")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewMode === "chat"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setViewMode("trace")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewMode === "trace"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Trace
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs border-b border-red-100 dark:border-red-900/20">
          {error}
        </div>
      )}

      {/* Authentication Required Banner */}
      {authError && (
        <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/20">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Authentication Required
                  {authError.agentInfo && (
                    <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
                      ({authError.agentInfo.name} v{authError.agentInfo.version})
                    </span>
                  )}
                </h4>
                <button
                  onClick={clearAuthError}
                  className="shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
                  title="Dismiss"
                >
                  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {authError.message}
              </p>
              {authError.authMethods.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Available authentication methods:
                  </p>
                  <div className="space-y-1.5">
                    {authError.authMethods.map((method) => (
                      <div
                        key={method.id}
                        className="flex items-start gap-2 p-2 rounded-md bg-amber-100/50 dark:bg-amber-800/20"
                      >
                        <svg className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
                            {method.name}
                          </div>
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            {method.description}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - Chat or Trace */}
      {viewMode === "trace" ? (
        <TracePanel sessionId={activeSessionId} />
      ) : (visibleMessages.length === 0 && !activeSessionId) ? (

        /* ── Setup / Empty State ── */
        <SetupView
          setupInput={setupInput}
          onSetupInputChange={setSetupInput}
          onStartSession={handleStartSession}
          connected={connected}
          providers={acp.providers}
          selectedProvider={acp.selectedProvider}
          onProviderChange={acp.setProvider}
          onFetchModels={acp.listProviderModels}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId ?? null}
          onWorkspaceChange={(id) => onWorkspaceChange?.(id)}
          repoSelection={repoSelection}
          onRepoChange={onRepoChange}
          agentRole={agentRole}
          onAgentRoleChange={onAgentRoleChange}
        />

      ) : (

        /* ── Active Chat State ── */
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="max-w-3xl mx-auto px-5 py-5 space-y-2">
              {visibleMessages.length === 0 && activeSessionId && (
                <div className="text-center py-20 text-sm text-gray-400 dark:text-gray-500">
                  Send a message to start.
                </div>
              )}
              {visibleMessages
                .filter((msg) => {
                  // Hide plan messages that have entries (they show in TaskProgressBar)
                  if (msg.role === "plan" && msg.planEntries && msg.planEntries.length > 0) {
                    return false;
                  }
                  // Hide task-type tool messages (delegated tasks) - they show in the right panel CraftersView
                  if (msg.role === "tool" && msg.toolKind === "task") {
                    return false;
                  }
                  // Hide pending AskUserQuestion from chat stream — shown sticky above input
                  if (msg.role === "tool" && isAskUserQuestionMessage(msg) && !hasAskUserQuestionAnswers(msg) && msg.toolStatus !== "failed") {
                    return false;
                  }
                  return true;
                })
                .map((msg, index) => (
                  <MessageBubble
                    key={`${msg.id}-${index}`}
                    message={msg}
                    onSubmitAskUserQuestion={handleSubmitAskUserQuestion}
                  />
                ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-[#0f1117]">
            <div className="max-w-3xl mx-auto px-5 py-3 space-y-2">
              {/* AskUserQuestion sticky cards — displayed above input until user submits */}
              {pendingAskUserQuestions.length > 0 && (
                <div className="space-y-2">
                  {pendingAskUserQuestions.map((msg) => (
                    <AskUserQuestionBubble
                      key={msg.id}
                      message={msg}
                      onSubmit={handleSubmitAskUserQuestion}
                    />
                  ))}
                </div>
              )}
              {/* Task Progress Bar - shows above input when tasks or file changes exist */}
              {(taskInfos.length > 0 || fileChangesSummary) && (
                <TaskProgressBar tasks={taskInfos} fileChanges={fileChangesSummary} />
              )}
              <div className="flex gap-2 items-end">
                <TiptapInput
                  onSend={handleSend}
                  onStop={() => {
                    setIsSessionRunning(false);
                    acp.cancel();
                  }}
                  placeholder={
                    connected
                      ? activeSessionId
                        ? "Type a message... @ file, # agent, / skill"
                        : "Type a message to auto-create a session..."
                      : "Connect first..."
                  }
                  disabled={!connected}
                  loading={loading || isSessionRunning}
                  skills={skills}
                  repoSkills={repoSkills}
                  providers={acp.providers}
                  selectedProvider={acp.selectedProvider}
                  onProviderChange={acp.setProvider}
                  sessions={sessions}
                  activeSessionMode={activeSessionId ? sessionModeById[activeSessionId] : undefined}
                  repoSelection={repoSelection}
                  onRepoChange={handleRepoChange}
                  agentRole={agentRole}
                  usageInfo={usageInfo}
                  onFetchModels={acp.listProviderModels}
                  prefillText={inputPrefill}
                  onPrefillConsumed={onInputPrefillConsumed}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
