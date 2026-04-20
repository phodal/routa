/**
 * Message processing utilities for SSE updates
 */

import { v4 as uuidv4 } from "uuid";
import type { AcpSessionNotification } from "../../../acp-client";
import type { ChatMessage, PlanEntry, UsageInfo } from "../types";
import type { TraceRecord } from "@/core/trace";
import {
  historyNotificationsToMessages,
  traceRecordsToMessages,
} from "@/core/session-transcript";
import { parseChecklist, type ChecklistItem } from "../../../utils/checklist-parser";
import {
  type FileChangesState,
  updateFileChange,
  extractFileChangeFromToolResult,
  extractFilesModified,
} from "../../../utils/file-changes-tracker";
import { getToolEventLabel, getToolEventName, normalizeToolKind } from "../tool-call-name";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type StreamingRole = "assistant" | "thought";
type StreamingIds = Record<string, string | null>;
type ToolContentBlock = Array<{ type: string; text?: string }> | null | undefined;

function canContinueStreamingChunk(
  lastKind: string | null,
  expectedKind: string,
): boolean {
  if (!lastKind) return false;
  if (lastKind === expectedKind) return true;

  if (expectedKind === "agent_message_chunk") {
    return [
      "agent_thought_chunk",
      "process_output",
      "terminal_created",
      "terminal_output",
      "terminal_exited",
      "thinking_start",
      "thinking_stop",
      "thinking_signature",
      "usage_update",
    ].includes(lastKind);
  }

  if (expectedKind === "agent_thought_chunk") {
    return [
      "process_output",
      "terminal_created",
      "terminal_output",
      "terminal_exited",
      "thinking_start",
      "thinking_signature",
      "usage_update",
    ].includes(lastKind);
  }

  return false;
}

function resetStreamingStateForSession(
  sessionId: string,
  streamingMsgIdRef: React.MutableRefObject<Record<string, string | null>>,
  streamingThoughtIdRef: React.MutableRefObject<Record<string, string | null>>,
): void {
  streamingMsgIdRef.current[sessionId] = null;
  streamingThoughtIdRef.current[sessionId] = null;
}

function appendStreamingChunk(
  messages: ChatMessage[],
  streamingIds: StreamingIds,
  sessionId: string,
  lastKind: string | null,
  expectedKind: string,
  role: StreamingRole,
  text: string,
): string {
  if (!canContinueStreamingChunk(lastKind, expectedKind)) {
    streamingIds[sessionId] = null;
  }

  let messageId = streamingIds[sessionId];
  const nextText = !messageId ? text.replace(/^[\r\n]+/, "") : text;
  if (!messageId) {
    messageId = uuidv4();
    streamingIds[sessionId] = messageId;
  }

  const index = messages.findIndex((message) => message.id === messageId);
  const content = index >= 0 ? messages[index].content + text : nextText;
  if (index >= 0) {
    messages[index] = { ...messages[index], content };
  } else {
    messages.push({ id: messageId, role, content, timestamp: new Date() });
  }

  return content;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function pushTextParts(parts: string[], content: ToolContentBlock): void {
  if (!Array.isArray(content)) {
    return;
  }

  for (const item of content) {
    if (item.text) {
      parts.push(item.text);
    }
  }
}

function formatUnknownValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function buildToolCallPreview(update: Record<string, unknown>): {
  content: string;
  rawInput: Record<string, unknown> | undefined;
  status: string;
  toolCallId: string | undefined;
  toolKind: string | undefined;
  toolName: string;
} {
  const toolCallId = update.toolCallId as string | undefined;
  const toolName = getToolEventLabel(update);
  const status = (update.status as string) ?? "running";
  const toolKind = normalizeToolKind(update.kind as string | undefined);
  const rawInput = asRecord(update.rawInput);
  const contentParts: string[] = [];

  if (update.rawInput) {
    contentParts.push(`Input:\n${formatUnknownValue(update.rawInput)}`);
  }
  pushTextParts(contentParts, update.content as ToolContentBlock);

  return {
    content: contentParts.join("\n\n") || toolName,
    rawInput,
    status,
    toolCallId,
    toolKind,
    toolName,
  };
}

function appendToolCallMessage(
  messages: ChatMessage[],
  update: Record<string, unknown>,
): void {
  const preview = buildToolCallPreview(update);
  const alreadyExists = preview.toolCallId && messages.some((message) => message.toolCallId === preview.toolCallId);
  if (alreadyExists) {
    return;
  }

  messages.push({
    id: preview.toolCallId ?? uuidv4(),
    role: "tool",
    content: preview.content,
    timestamp: new Date(),
    toolName: preview.toolName,
    toolStatus: preview.status,
    toolCallId: preview.toolCallId,
    toolKind: preview.toolKind,
    toolRawInput: preview.rawInput,
  });
}

function buildToolUpdatePayload(update: Record<string, unknown>) {
  const outputParts: string[] = [];
  if (update.rawOutput) {
    outputParts.push(formatUnknownValue(update.rawOutput));
  }
  pushTextParts(outputParts, update.content as ToolContentBlock);

  return {
    delegatedTaskId: update.delegatedTaskId as string | undefined,
    outputParts,
    rawInput: asRecord(update.rawInput),
    rawOutput: update.rawOutput,
    status: update.status as string | undefined,
    toolCallId: update.toolCallId as string | undefined,
    toolKind: normalizeToolKind(update.kind as string | undefined),
    toolName: getToolEventName(update) ?? (update.kind as string | undefined),
  };
}

function applyToolCallUpdate(
  messages: ChatMessage[],
  update: Record<string, unknown>,
): {
  rawInput: Record<string, unknown> | undefined;
  rawOutput: string | undefined;
  status: string | undefined;
  toolCallId: string | undefined;
  toolName: string | undefined;
} {
  const payload = buildToolUpdatePayload(update);
  if (!payload.toolCallId) {
    return {
      rawInput: payload.rawInput,
      rawOutput: typeof payload.rawOutput === "string" ? payload.rawOutput : undefined,
      status: payload.status,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    };
  }

  const index = messages.findIndex((message) => message.toolCallId === payload.toolCallId);
  if (index >= 0) {
    const existing = messages[index];
    const nextToolKind = payload.toolKind ?? existing.toolKind;
    const mergedRawInput = nextToolKind === "request-permissions" && existing.toolRawInput
      ? {
          ...existing.toolRawInput,
          ...(payload.rawInput ?? {}),
        }
      : payload.rawInput ?? existing.toolRawInput;
    messages[index] = {
      ...existing,
      toolStatus: payload.status ?? existing.toolStatus,
      toolName: payload.toolName ?? existing.toolName,
      toolKind: nextToolKind,
      delegatedTaskId: payload.delegatedTaskId ?? existing.delegatedTaskId,
      toolRawInput: mergedRawInput,
      toolRawOutput: payload.rawOutput ?? existing.toolRawOutput,
      content: payload.outputParts.length
        ? `${payload.toolName ?? existing.toolName ?? "tool"}\n\nOutput:\n${payload.outputParts.join("\n")}`
        : existing.content,
    };
  } else {
    messages.push({
      id: uuidv4(),
      role: "tool",
      content: payload.outputParts.join("\n") || `Tool ${payload.status ?? "update"}`,
      timestamp: new Date(),
      toolStatus: payload.status ?? "completed",
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      toolKind: payload.toolKind,
      toolRawInput: payload.rawInput,
      toolRawOutput: payload.rawOutput,
      delegatedTaskId: payload.delegatedTaskId,
    });
  }

  return {
    rawInput: payload.rawInput,
    rawOutput: typeof payload.rawOutput === "string" ? payload.rawOutput : undefined,
    status: payload.status,
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
  };
}

/**
 * Process a single SSE update and mutate the messages array
 */
export function processUpdate(
  kind: string,
  update: Record<string, unknown>,
  arr: ChatMessage[],
  sid: string,
  lastKind: string | null,
  extractText: () => string,
  streamingMsgIdRef: React.MutableRefObject<Record<string, string | null>>,
  streamingThoughtIdRef: React.MutableRefObject<Record<string, string | null>>,
  setChecklistItems: SetState<ChecklistItem[]>,
  setFileChangesState: SetState<FileChangesState>,
  setUsageInfo: SetState<UsageInfo | null>,
  modeUpdates: Record<string, string>
): void {
  switch (kind) {
    case "agent_message_chunk": {
      const text = extractText();
      if (!text) break;
      streamingThoughtIdRef.current[sid] = null;
      const updatedContent = appendStreamingChunk(
        arr,
        streamingMsgIdRef.current,
        sid,
        lastKind,
        "agent_message_chunk",
        "assistant",
        text,
      );
      const parsedChecklist = parseChecklist(updatedContent);
      if (parsedChecklist.length > 0) {
        setChecklistItems(parsedChecklist);
      }
      break;
    }

    case "agent_thought_chunk": {
      const text = extractText();
      if (!text) break;

      appendStreamingChunk(
        arr,
        streamingThoughtIdRef.current,
        sid,
        lastKind,
        "agent_thought_chunk",
        "thought",
        text,
      );
      break;
    }

    case "tool_call": {
      resetStreamingStateForSession(sid, streamingMsgIdRef, streamingThoughtIdRef);
      appendToolCallMessage(arr, update);
      break;
    }

    case "tool_call_update": {
      resetStreamingStateForSession(sid, streamingMsgIdRef, streamingThoughtIdRef);
      processToolCallUpdate(update, arr, setFileChangesState);
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
          terminalInteractive: true,
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
        const idx = arr.findIndex((m) => m.role === "terminal" && m.terminalId === terminalId);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], content: arr[idx].content + termData };
        } else {
          arr.push({
            id: terminalId,
            role: "terminal",
            content: termData,
            timestamp: new Date(),
            terminalId,
            terminalInteractive: true,
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
        const idx = arr.findIndex((m) => m.role === "terminal" && m.terminalId === terminalId);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], terminalExited: true, terminalExitCode: termExitCode ?? 0 };
        }
      }
      break;
    }

    case "process_output": {
      const processData = update.data as string | undefined;
      const processSource = update.source as string | undefined;
      const processDisplayName = update.displayName as string | undefined;
      if (processData) {
        const processTermId = `process-${sid}`;
        const idx = arr.findIndex((m) => m.role === "terminal" && m.terminalId === processTermId);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], content: arr[idx].content + processData };
        } else {
          arr.push({
            id: processTermId,
            role: "terminal",
            content: processData,
            timestamp: new Date(),
            terminalId: processTermId,
            terminalCommand: processDisplayName ?? "Agent Process",
            terminalArgs: processSource ? [processSource] : undefined,
            terminalInteractive: false,
            terminalExited: false,
            terminalExitCode: null,
          });
        }
      }
      break;
    }

    case "task_completion": {
      processTaskCompletion(update, arr, setFileChangesState);
      break;
    }

    case "tool_call_start": {
      resetStreamingStateForSession(sid, streamingMsgIdRef, streamingThoughtIdRef);
      const toolCallId = update.toolCallId as string | undefined;
      const toolName = getToolEventName(update);
      const toolKind = normalizeToolKind(update.kind as string | undefined);
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
      resetStreamingStateForSession(sid, streamingMsgIdRef, streamingThoughtIdRef);
      const toolCallId = update.toolCallId as string | undefined;
      const parsedInput = update.parsedInput as Record<string, unknown> | null;
      const toolName = getToolEventName(update);
      if (toolCallId) {
        const idx = arr.findIndex((m) => m.toolCallId === toolCallId);
        if (idx >= 0) {
          const existing = arr[idx];
          const inputPreview = parsedInput
            ? `Input:\n${JSON.stringify(parsedInput, null, 2)}`
            : "(streaming parameters...)";
          arr[idx] = {
            ...existing,
            content: `${toolName ?? existing.toolName ?? "tool"}\n\n${inputPreview}`,
            toolName: toolName ?? existing.toolName,
            toolRawInput: parsedInput ?? existing.toolRawInput,
          };
        }
      }
      break;
    }

    case "thinking_start": {
      const thoughtId = `thinking-${uuidv4()}`;
      streamingThoughtIdRef.current[sid] = thoughtId;
      arr.push({ id: thoughtId, role: "thought", content: "", timestamp: new Date() });
      break;
    }

    case "thinking_stop": {
      const reasoningText = update.reasoningText as string | undefined;
      const thoughtId = streamingThoughtIdRef.current[sid];
      if (thoughtId && reasoningText) {
        const idx = arr.findIndex((m) => m.id === thoughtId);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], content: reasoningText };
        }
      }
      streamingThoughtIdRef.current[sid] = null;
      break;
    }

    case "thinking_signature":
      break;

    case "turn_complete": {
      const usage = update.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const stopReason = update.stopReason as string | undefined;

      if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        setUsageInfo({
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });
      }

      if (stopReason === "max_tokens") {
        arr.push({
          id: uuidv4(),
          role: "info",
          content: "⚠️ Response was truncated due to max tokens limit.",
          timestamp: new Date(),
        });
      }
      break;
    }

    case "available_commands_update":
    case "config_option_update":
    case "session_info_update":
      break;

    case "acp_status":
      processAcpStatus(update, arr);
      break;

    default:
      console.log(`[ChatPanel] Unhandled sessionUpdate: ${kind}`);
      break;
  }
}

function processToolCallUpdate(
  update: Record<string, unknown>,
  arr: ChatMessage[],
  setFileChangesState: SetState<FileChangesState>
): void {
  const result = applyToolCallUpdate(arr, update);

  if (result.toolName && result.status === "completed") {
    const fileChange = extractFileChangeFromToolResult(result.toolName, result.rawOutput, result.rawInput);
    if (fileChange) {
      setFileChangesState((prev) => updateFileChange({ ...prev, files: new Map(prev.files) }, fileChange));
    }
  }
}

function processTaskCompletion(
  update: Record<string, unknown>,
  arr: ChatMessage[],
  setFileChangesState: SetState<FileChangesState>
): void {
  const taskId = update.taskId as string | undefined;
  const completionSummary = update.completionSummary as string | undefined;
  const taskStatus = update.taskStatus as string | undefined;
  const filesModified = update.filesModified as string[] | undefined;

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
    const idx = arr.findIndex((m) => m.role === "tool" && m.delegatedTaskId === taskId);
    if (idx >= 0) {
      const existing = arr[idx];
      arr[idx] = {
        ...existing,
        toolStatus: taskStatus === "COMPLETED" || taskStatus === "completed" ? "completed" : "failed",
        completionSummary,
        content: completionSummary
          ? `${existing.toolName ?? "Task"}\n\n**Completed:**\n${completionSummary}`
          : existing.content,
      };
    }
  }
}

function processAcpStatus(update: Record<string, unknown>, arr: ChatMessage[]): void {
  const status = typeof update.status === "string" ? update.status : undefined;
  const error = typeof update.error === "string" ? update.error : undefined;
  if (status !== "error" || !error) {
    return;
  }

  const lastMessage = arr.at(-1);
  if (lastMessage?.role === "info" && lastMessage.content === error) {
    return;
  }

  arr.push({
    id: uuidv4(),
    role: "info",
    content: error,
    timestamp: new Date(),
    rawData: {
      sessionUpdate: "acp_status",
      status,
      error,
    },
  });
}

/**
 * Convert session history notifications to ChatMessage array
 */
export function processHistoryToMessages(
  history: AcpSessionNotification[],
  sessionId: string
): ChatMessage[] {
  return historyNotificationsToMessages(history, sessionId);
}

export function processTracesToMessages(
  traces: TraceRecord[],
  sessionId: string,
): ChatMessage[] {
  return traceRecordsToMessages(traces, sessionId);
}
