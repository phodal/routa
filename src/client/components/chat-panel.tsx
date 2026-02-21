"use client";

/**
 * ChatPanel - Full-screen ACP chat interface
 *
 * Renders streaming `session/update` SSE notifications from an opencode process.
 * Handles all ACP sessionUpdate types.
 */

import {useCallback, useEffect, useMemo, useRef, useState,} from "react";
import {v4 as uuidv4} from "uuid";
import type {AcpSessionNotification} from "../acp-client";
import type {UseAcpActions, UseAcpState} from "../hooks/use-acp";
import {type InputContext, TiptapInput} from "./tiptap-input";
import type {SkillSummary} from "../skill-client";
import {RepoPicker, type RepoSelection} from "./repo-picker";
import {extractTaskBlocks, hasTaskBlocks, type ParsedTask,} from "../utils/task-block-parser";
import {type TaskInfo, TaskProgressBar} from "./task-progress-bar";
import {MessageBubble} from "@/client/components/message-bubble";

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

interface ChatPanelProps {
  acp: UseAcpState & UseAcpActions;
  activeSessionId: string | null;
  onEnsureSession: (cwd?: string, provider?: string, modeId?: string) => Promise<string | null>;
  onSelectSession: (sessionId: string) => Promise<void>;
  skills?: SkillSummary[];
  /** Skills discovered from the selected repo */
  repoSkills?: SkillSummary[];
  onLoadSkill?: (name: string) => Promise<string | null>;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;
  /** Called when @@@task blocks are detected in Routa agent responses */
  onTasksDetected?: (tasks: ParsedTask[]) => void;
  /** Current agent role – ROUTA mode hides provider mode chips */
  agentRole?: string;
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
  onLoadSkill,
  repoSelection,
  onRepoChange,
  onTasksDetected,
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

  const streamingMsgIdRef = useRef<Record<string, string | null>>({});
  const streamingThoughtIdRef = useRef<Record<string, string | null>>({});
  const lastProcessedUpdateIndexRef = useRef(0);
  // Track the last update kind per session to determine when to create new messages
  const lastUpdateKindRef = useRef<Record<string, string | null>>({});

  // Extract task-type tool calls for TaskProgressBar
  const taskInfos = useMemo<TaskInfo[]>(() => {
    return visibleMessages
      .filter((msg) => msg.role === "tool" && msg.toolKind === "task")
      .map((msg) => {
        const rawInput = msg.toolRawInput ?? {};
        const description = (rawInput.description as string) ?? "";
        const subagentType = (rawInput.subagent_type as string) ?? "";
        // Map toolStatus to TaskInfo status
        let status: TaskInfo["status"] = "pending";
        if (msg.toolStatus === "completed") status = "completed";
        else if (msg.toolStatus === "failed") status = "failed";
        else if (msg.toolStatus === "running" || msg.toolStatus === "in_progress") status = "running";

        return {
          id: msg.id,
          title: description || msg.toolName || "Task",
          description,
          subagentType,
          status,
        };
      });
  }, [visibleMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  // When active session changes, swap visible transcript
  useEffect(() => {
    if (!activeSessionId) {
      setVisibleMessages([]);
      return;
    }
    setVisibleMessages(messagesBySession[activeSessionId] ?? []);
  }, [activeSessionId, messagesBySession]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
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
              arr[idx] = { ...arr[idx], content: arr[idx].content + text };
            } else {
              arr.push({ id: msgId, role: "assistant", content: text, timestamp: new Date() });
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
            break;
          }

          case "tool_call_update": {
            const toolCallId = update.toolCallId as string | undefined;
            const status = update.status as string | undefined;
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
            if (toolCallId) {
              const idx = arr.findIndex((m) => m.toolCallId === toolCallId);
              if (idx >= 0) {
                const existing = arr[idx];
                arr[idx] = {
                  ...existing,
                  toolStatus: status ?? existing.toolStatus,
                  toolName: (update.title as string) ?? existing.toolName,
                  toolKind: (update.kind as string) ?? existing.toolKind,
                  content: outputParts.length
                    ? `${existing.toolName ?? "tool"}\n\nOutput:\n${outputParts.join("\n")}`
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
            if (terminalId) {
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

          case "available_commands_update":
          case "config_option_update":
          case "session_info_update":
            break;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleRepoChange = onRepoChange;

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
    const sid = context.sessionId ?? activeSessionId ?? (await onEnsureSession(cwd, context.provider, context.mode));
    if (!sid) return;
    if (context.mode) {
      await acp.setMode(context.mode);
    }


    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // Build the final prompt:
    // - If a skill is selected, prepend its content
    let finalPrompt = text;
    if (context.skill && onLoadSkill) {
      const skillContent = await onLoadSkill(context.skill);
      if (skillContent) {
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

    await prompt(finalPrompt);

    streamingMsgIdRef.current[sid] = null;
    streamingThoughtIdRef.current[sid] = null;

    // After prompt completes, check assistant messages for @@@task blocks
    if (onTasksDetected) {
      setMessagesBySession((prev) => {
        const msgs = prev[sid];
        if (!msgs) return prev;

        const next = { ...prev };
        const arr = [...msgs];
        let tasksFound = false;

        for (let i = 0; i < arr.length; i++) {
          const msg = arr[i];
          if (msg.role === "assistant" && hasTaskBlocks(msg.content)) {
            const { tasks, cleanedContent } = extractTaskBlocks(msg.content);
            if (tasks.length > 0) {
              // Replace the message content with cleaned version (tasks removed)
              arr[i] = { ...msg, content: cleanedContent };
              onTasksDetected(tasks);
              tasksFound = true;
            }
          }
        }

        if (tasksFound) {
          next[sid] = arr;
          return next;
        }
        return prev;
      });
    }
  }, [activeSessionId, onEnsureSession, onSelectSession, prompt, repoSelection, onLoadSkill, acp, onTasksDetected]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f1117]">
      {/* Session info bar */}
      {activeSessionId && (
        <div className="px-5 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
            Session: {activeSessionId.slice(0, 12)}...
          </span>
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-4">
          {visibleMessages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                {connected
                  ? activeSessionId
                    ? "Send a message to start."
                    : "Select or create a session from the sidebar."
                  : "Connect via the top bar to get started."}
              </div>

              {/* ── Repo Picker in center when no messages ── */}
              {connected && (
                <div className="inline-block text-left">
                  <RepoPicker
                    value={repoSelection}
                    onChange={handleRepoChange}
                  />
                </div>
              )}
            </div>
          )}
          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-[#0f1117]">
        <div className="max-w-3xl mx-auto px-5 py-3 space-y-2">
          {/* Task Progress Bar - shows above input when tasks exist */}
          {taskInfos.length > 0 && (
            <TaskProgressBar tasks={taskInfos} />
          )}
          <div className="flex gap-2 items-end">
            <TiptapInput
              onSend={handleSend}
              placeholder={
                connected
                  ? activeSessionId
                    ? "Type a message... @ file, # agent, / skill"
                    : "Type a message to auto-create a session..."
                  : "Connect first..."
              }
              disabled={!connected}
              loading={loading}
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
