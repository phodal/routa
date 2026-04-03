"use client";

/**
 * ChatPanel - Full-screen ACP chat interface
 *
 * Renders streaming `session/update` SSE notifications from an opencode process.
 * Handles all ACP sessionUpdate types.
 */

import {useCallback, useEffect, useMemo, useRef, useState,} from "react";
import {v4 as uuidv4} from "uuid";
import type {UseAcpActions, UseAcpState} from "../hooks/use-acp";
import {type InputContext, TiptapInput} from "./tiptap-input";
import type {SkillSummary} from "../skill-client";
import {type RepoSelection} from "./repo-picker";
import {SetupView} from "./chat-panel/components";
import {useChatMessages} from "./chat-panel/hooks";
import {type ParsedTask,} from "../utils/task-block-parser";
import {type TaskInfo, TaskProgressBar, type FileChangesSummary} from "./task-progress-bar";
import {
  MessageBubble,
  isAskUserQuestionMessage,
  AskUserQuestionBubble,
  hasAskUserQuestionAnswers,
} from "@/client/components/message-bubble";
import {TracePanel} from "@/client/components/trace-panel";
import type {WorkspaceData, CodebaseData} from "../hooks/use-workspaces";
import {getFileChangesSummary} from "../utils/file-changes-tracker";
import { TriangleAlert, X, KeyRound } from "lucide-react";
import { useTranslation } from "@/i18n";


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
  /** Raw output payload for tool calls before string formatting */
  toolRawOutput?: unknown;
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
  terminalInteractive?: boolean;
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
  traceSessionId?: string | null;
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
  traceSessionId,
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
  const { t } = useTranslation();
  const { connected, loading, error, authError, updates, prompt, clearAuthError } = acp;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // View mode: 'chat' or 'trace'
  const [viewMode, setViewMode] = useState<"chat" | "trace">("chat");

  // Use the extracted chat messages hook
  const {
    visibleMessages,
    sessions,
    sessionModeById,
    isSessionRunning,
    checklistItems,
    fileChangesState,
    usageInfo,
    setMessagesBySession,
    setIsSessionRunning,
    fetchSessions,
    resetStreamingRefs,
  } = useChatMessages({
    activeSessionId,
    updates,
    onTasksDetected,
  });

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
          title: description || msg.toolName || t.common.tasks,
          description,
          subagentType,
          status,
          completionSummary: msg.completionSummary,
        };
      });
  }, [visibleMessages, t]);

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

  // Fetch sessions on mount and when active session changes
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, activeSessionId]);

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
  }, [acp, activeSessionId, setMessagesBySession]);

  const handleTerminalInput = useCallback(async (terminalId: string, data: string) => {
    await acp.writeTerminal(terminalId, data);
  }, [acp]);

  const handleTerminalResize = useCallback(async (terminalId: string, cols: number, rows: number) => {
    await acp.resizeTerminal(terminalId, cols, rows);
  }, [acp]);

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

    // Reset streaming refs before sending
    resetStreamingRefs(sid);

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

    // Reset streaming refs after sending
    resetStreamingRefs(sid);

    // Task extraction is now handled by the useEffect that watches messagesBySession
  }, [activeSessionId, onEnsureSession, onSelectSession, prompt, repoSelection, onLoadSkill, acp, resetStreamingRefs, setMessagesBySession]);

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
        <div className="px-5 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              {t.sessions.sessionInfo} {activeSessionId.slice(0, 12)}...
            </span>
          </div>
          {/* View toggle: Chat | Trace */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-md p-0.5">
            <button
              onClick={() => setViewMode("chat")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewMode === "chat"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {t.chat.viewToggle.chat}
            </button>
            <button
              onClick={() => setViewMode("trace")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewMode === "trace"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {t.chat.viewToggle.trace}
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
              <TriangleAlert className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {t.chat.authRequiredTitle}
                  {authError.agentInfo && (
                    <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
                      ({authError.agentInfo.name} v{authError.agentInfo.version})
                    </span>
                  )}
                </h4>
                <button
                  onClick={clearAuthError}
                  className="shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
                  title={t.common.dismiss}
                >
                  <X className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>
              </div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {authError.message}
              </p>
              {authError.authMethods.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {t.chat.availableAuthMethods}
                  </p>
                  <div className="space-y-1.5">
                    {authError.authMethods.map((method) => (
                      <div
                        key={method.id}
                        className="flex items-start gap-2 p-2 rounded-md bg-amber-100/50 dark:bg-amber-800/20"
                      >
                        <KeyRound className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
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
        <TracePanel sessionId={traceSessionId ?? activeSessionId} />
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
          <div className="flex-1 overflow-y-auto min-h-0" data-testid="chat-panel-message-shell">
            <div className="max-w-3xl mx-auto px-5 py-5 space-y-2">
              {visibleMessages.length === 0 && activeSessionId && (
                <div className="text-center py-20 text-sm text-slate-400 dark:text-slate-500">
                  {t.sessions.placeholder}
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
                  if (
                    msg.role === "tool"
                    && isAskUserQuestionMessage(msg)
                    && !hasAskUserQuestionAnswers(msg)
                    && msg.toolStatus !== "failed"
                    && msg.toolStatus !== "completed"
                  ) {
                    return false;
                  }
                  return true;
                })
                .map((msg, index) => (
                  <MessageBubble
                    key={`${msg.id}-${index}`}
                    message={msg}
                    onSubmitAskUserQuestion={handleSubmitAskUserQuestion}
                    onTerminalInput={activeSessionId ? handleTerminalInput : undefined}
                    onTerminalResize={activeSessionId ? handleTerminalResize : undefined}
                  />
                ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0f1117]">
            <div className="max-w-3xl mx-auto px-5 py-3 space-y-2">
              {/* AskUserQuestion sticky cards — displayed above input until user submits */}
              {pendingAskUserQuestions.length > 0 && (
                <div className="space-y-2">
                  {pendingAskUserQuestions
                    .filter((msg) => msg.toolStatus !== "completed")
                    .map((msg) => (
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
                        ? t.chat.typeMessage
                        : t.chat.typeCreateSession
                      : t.chat.connectFirst
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
              {repoSelection?.path && (
                <div className="flex items-center gap-1.5 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                  <span className="font-medium text-slate-500 dark:text-slate-400">
                    {t.sessions.repoPath}
                  </span>
                  <span className="truncate font-mono" title={repoSelection.path}>
                    {repoSelection.path}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
