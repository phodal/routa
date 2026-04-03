import { v4 as uuidv4 } from "uuid";
import type { TraceRecord } from "@/core/trace";
import type { AcpSessionNotification } from "@/core/store/acp-session-store";
import type { ChatMessage, PlanEntry } from "@/client/components/chat-panel/types";
import { getToolEventLabel, getToolEventName, normalizeToolKind } from "@/client/components/chat-panel/tool-call-name";

export type TranscriptSource = "history" | "traces" | "empty";

export interface SerializedChatMessage extends Omit<ChatMessage, "timestamp"> {
  timestamp: string;
}

export interface SessionTranscriptPayload {
  sessionId: string;
  history: AcpSessionNotification[];
  messages: SerializedChatMessage[];
  source: TranscriptSource;
  historyMessageCount: number;
  traceMessageCount: number;
  latestEventKind?: string;
}

function appendStreamingChunk(
  messages: ChatMessage[],
  streamingIds: Record<string, string | null>,
  sessionId: string,
  lastKind: string | null,
  expectedKind: string,
  role: "assistant" | "thought",
  text: string,
): void {
  if (lastKind !== expectedKind) {
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
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function pushTextParts(parts: string[], content: Array<{ type: string; text?: string }> | null | undefined): void {
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
  pushTextParts(contentParts, update.content as Array<{ type: string; text?: string }> | null | undefined);

  return {
    content: contentParts.join("\n\n") || toolName,
    rawInput,
    status,
    toolCallId,
    toolKind,
    toolName,
  };
}

function appendToolCallMessage(messages: ChatMessage[], update: Record<string, unknown>): void {
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

function applyToolCallUpdate(messages: ChatMessage[], update: Record<string, unknown>): void {
  const outputParts: string[] = [];
  if (update.rawOutput) {
    outputParts.push(formatUnknownValue(update.rawOutput));
  }
  pushTextParts(outputParts, update.content as Array<{ type: string; text?: string }> | null | undefined);

  const toolCallId = update.toolCallId as string | undefined;
  const toolName = getToolEventName(update) ?? (update.kind as string | undefined) ?? "tool";
  if (!toolCallId) {
    return;
  }

  const index = messages.findIndex((message) => message.toolCallId === toolCallId);
  if (index >= 0) {
    const existing = messages[index];
    messages[index] = {
      ...existing,
      toolStatus: (update.status as string | undefined) ?? existing.toolStatus,
      toolName,
      toolKind: normalizeToolKind(update.kind as string | undefined) ?? existing.toolKind,
      delegatedTaskId: (update.delegatedTaskId as string | undefined) ?? existing.delegatedTaskId,
      toolRawInput: asRecord(update.rawInput) ?? existing.toolRawInput,
      toolRawOutput: update.rawOutput ?? existing.toolRawOutput,
      content: outputParts.length
        ? `${toolName}\n\nOutput:\n${outputParts.join("\n")}`
        : existing.content,
    };
    return;
  }

  messages.push({
    id: uuidv4(),
    role: "tool",
    content: outputParts.join("\n") || `Tool ${(update.status as string | undefined) ?? "update"}`,
    timestamp: new Date(),
    toolStatus: (update.status as string | undefined) ?? "completed",
    toolCallId,
    toolName,
    toolKind: normalizeToolKind(update.kind as string | undefined),
    toolRawInput: asRecord(update.rawInput),
    toolRawOutput: update.rawOutput,
    delegatedTaskId: update.delegatedTaskId as string | undefined,
  });
}

function normalizeMessageText(value?: string): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function historyNotificationsToMessages(
  history: AcpSessionNotification[],
  sessionId: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const streamingMsgId: Record<string, string | null> = {};
  const streamingThoughtId: Record<string, string | null> = {};
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
      case "user_message": {
        const content = update.content;
        const text = Array.isArray(content)
          ? content.map((item) => item.text ?? "").join(" ").trim()
          : (content as { text?: string } | undefined)?.text ?? "";
        if (!text) break;
        const lastMessage = messages.at(-1);
        if (lastMessage?.role === "user" && normalizeMessageText(lastMessage.content) === normalizeMessageText(text)) {
          break;
        }
        messages.push({
          id: `${sessionId}-user-${messages.length}`,
          role: "user",
          content: text,
          timestamp: new Date(),
        });
        break;
      }
      case "agent_message": {
        const content = update.content;
        const text = Array.isArray(content)
          ? content.map((item) => item.text ?? "").join(" ").trim()
          : (content as { text?: string } | undefined)?.text ?? "";
        if (!text) break;
        const lastMessage = messages.at(-1);
        if (lastMessage?.role === "assistant" && normalizeMessageText(lastMessage.content) === normalizeMessageText(text)) {
          break;
        }
        messages.push({
          id: `${sessionId}-assistant-${messages.length}`,
          role: "assistant",
          content: text,
          timestamp: new Date(),
        });
        break;
      }
      case "agent_message_chunk": {
        const text = extractText();
        if (!text) break;
        streamingThoughtId[sessionId] = null;
        appendStreamingChunk(messages, streamingMsgId, sessionId, lastKind, "agent_message_chunk", "assistant", text);
        break;
      }
      case "agent_thought_chunk": {
        const text = extractText();
        if (!text) break;
        appendStreamingChunk(messages, streamingThoughtId, sessionId, lastKind, "agent_thought_chunk", "thought", text);
        break;
      }
      case "tool_call": {
        appendToolCallMessage(messages, update);
        break;
      }
      case "tool_call_update": {
        applyToolCallUpdate(messages, update);
        break;
      }
      case "plan": {
        const entries = update.entries as PlanEntry[] | undefined;
        const planText = entries
          ? entries.map((entry) => `[${entry.status ?? "pending"}] ${entry.content}${entry.priority ? ` (${entry.priority})` : ""}`).join("\n")
          : typeof update.plan === "string"
            ? update.plan
            : JSON.stringify(update, null, 2);
        messages.push({
          id: uuidv4(),
          role: "plan",
          content: planText,
          timestamp: new Date(),
          planEntries: entries,
        });
        break;
      }
      default:
        break;
    }

    lastKind = kind;
  }

  return messages;
}

export function traceRecordsToMessages(traces: TraceRecord[], sessionId: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const sortedTraces = [...traces].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const toolMessagesByCallId = new Map<string, number>();

  for (const trace of sortedTraces) {
    if (trace.sessionId !== sessionId) continue;

    if (trace.eventType === "user_message") {
      const content = trace.conversation?.fullContent || trace.conversation?.contentPreview || "";
      if (!content) continue;
      const lastMessage = messages.at(-1);
      if (lastMessage?.role === "user" && normalizeMessageText(lastMessage.content) === normalizeMessageText(content)) {
        continue;
      }
      messages.push({ id: trace.id, role: "user", content, timestamp: new Date(trace.timestamp) });
      continue;
    }

    if (trace.eventType === "agent_message") {
      const content = trace.conversation?.fullContent || trace.conversation?.contentPreview || "";
      if (!content) continue;
      messages.push({ id: trace.id, role: "assistant", content, timestamp: new Date(trace.timestamp) });
      continue;
    }

    if (trace.eventType === "agent_thought") {
      const content = trace.conversation?.fullContent || trace.conversation?.contentPreview || "";
      if (!content) continue;
      messages.push({ id: trace.id, role: "thought", content, timestamp: new Date(trace.timestamp) });
      continue;
    }

    if (trace.eventType === "tool_call") {
      const toolCallId = trace.tool?.toolCallId;
      const toolName = trace.tool?.name ?? "tool";
      const index = messages.push({
        id: toolCallId ?? trace.id,
        role: "tool",
        content: trace.tool?.input ? `Input:\n${formatUnknownValue(trace.tool.input)}` : toolName,
        timestamp: new Date(trace.timestamp),
        toolName,
        toolStatus: trace.tool?.status ?? "running",
        toolCallId,
        toolRawInput: asRecord(trace.tool?.input),
      }) - 1;
      if (toolCallId) {
        toolMessagesByCallId.set(toolCallId, index);
      }
      continue;
    }

    if (trace.eventType === "tool_result") {
      const toolCallId = trace.tool?.toolCallId;
      const toolName = trace.tool?.name ?? "tool";
      const existingIndex = toolCallId ? toolMessagesByCallId.get(toolCallId) : undefined;
      if (typeof existingIndex === "number") {
        const existing = messages[existingIndex];
        messages[existingIndex] = {
          ...existing,
          content: trace.tool?.output == null ? existing.content : formatUnknownValue(trace.tool.output),
          toolName,
          toolStatus: trace.tool?.status ?? "completed",
          toolRawOutput: trace.tool?.output,
        };
      } else {
        const index = messages.push({
          id: toolCallId ?? trace.id,
          role: "tool",
          content: trace.tool?.output == null ? toolName : formatUnknownValue(trace.tool.output),
          timestamp: new Date(trace.timestamp),
          toolName,
          toolStatus: trace.tool?.status ?? "completed",
          toolCallId,
          toolRawOutput: trace.tool?.output,
        }) - 1;
        if (toolCallId) {
          toolMessagesByCallId.set(toolCallId, index);
        }
      }
    }
  }

  return messages;
}

export function serializeTranscriptMessages(messages: ChatMessage[]): SerializedChatMessage[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp.toISOString(),
  }));
}

export function hydrateTranscriptMessages(messages: SerializedChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    timestamp: new Date(message.timestamp),
  }));
}

export function buildPreferredTranscriptPayload(args: {
  sessionId: string;
  history: AcpSessionNotification[];
  traces: TraceRecord[];
}): SessionTranscriptPayload {
  const historyMessages = historyNotificationsToMessages(args.history, args.sessionId);
  const traceMessages = traceRecordsToMessages(args.traces, args.sessionId);
  const preferredMessages = traceMessages.length > historyMessages.length ? traceMessages : historyMessages;
  const latestHistoryUpdate = args.history.at(-1);
  const latestEventKind = typeof (latestHistoryUpdate?.update as Record<string, unknown> | undefined)?.sessionUpdate === "string"
    ? latestHistoryUpdate?.update?.sessionUpdate as string
    : undefined;

  return {
    sessionId: args.sessionId,
    history: args.history,
    messages: serializeTranscriptMessages(preferredMessages),
    source: preferredMessages.length === 0 ? "empty" : traceMessages.length > historyMessages.length ? "traces" : "history",
    historyMessageCount: historyMessages.length,
    traceMessageCount: traceMessages.length,
    latestEventKind,
  };
}
