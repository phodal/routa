import { getToolEventName, normalizeToolKind } from "@/core/tool-call-name";
import type { AcpSessionNotification } from "@/core/store/acp-session-store";
import type { TaskContextSearchSpec } from "@/core/models/task";

const CONFIRMING_TOOL_NAMES = [
  "load_feature_tree_context",
  "read",
  "read_file",
  "glob",
  "search_files",
  "grep_search",
  "grep",
  "list_directory",
  "find_files",
] as const;

const CONFIRMING_TOOL_KINDS = new Set([
  "read-file",
  "glob",
  "grep",
]);

const CONFIRMING_SHELL_PREFIXES = new Set([
  "rg",
  "grep",
  "find",
  "fd",
]);

const FEATURE_TREE_STORY_CONFIRMATION_TOOL_NAME = "confirm_feature_tree_story_context";

const STRIP_WARNING =
  "Ignored contextSearchSpec for this backlog card because the current session has not yet confirmed retrieval hints through repo inspection or feature-tree lookup.";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function collectOutputRecords(value: unknown, records: Record<string, unknown>[], depth = 0): void {
  if (value == null || depth > 4) {
    return;
  }

  if (typeof value === "string") {
    const parsed = parseJsonRecord(value);
    if (parsed) {
      collectOutputRecords(parsed, records, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOutputRecords(item, records, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  records.push(record);
  for (const key of ["data", "result", "rawOutput", "output", "content", "text"]) {
    collectOutputRecords(record[key], records, depth + 1);
  }
}

function hasConfirmedFeatureTreeContext(record: Record<string, unknown>): boolean {
  return Boolean(
    asRecord(record.confirmedContextSearchSpec)
    || asRecord(record.selectedFeature)
    || (typeof record.featureTreeYamlBlock === "string" && record.featureTreeYamlBlock.trim().length > 0),
  );
}

function featureTreeStoryConfirmationHasEvidence(update: Record<string, unknown>): boolean {
  const records: Record<string, unknown>[] = [];
  for (const key of ["rawOutput", "output", "result", "content"]) {
    collectOutputRecords(update[key], records);
  }

  return records.some(hasConfirmedFeatureTreeContext);
}

function extractRawInput(update: Record<string, unknown>): Record<string, unknown> | undefined {
  const rawInput = asRecord(update.rawInput);
  if (rawInput) {
    return rawInput;
  }

  return asRecord(update.input);
}

function extractCommandToken(update: Record<string, unknown>): string | undefined {
  const rawInput = extractRawInput(update);
  const command = rawInput?.command;
  if (typeof command !== "string") {
    return undefined;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }

  const first = trimmed.split(/\s+/u)[0];
  return first.replace(/^.*\//u, "").toLowerCase();
}

function notificationConfirmsBacklogContext(notification: AcpSessionNotification): boolean {
  const update = asRecord(notification.update);
  if (!update) {
    return false;
  }

  const sessionUpdate = typeof update.sessionUpdate === "string" ? update.sessionUpdate : undefined;
  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
    return false;
  }

  const toolName = getToolEventName(update)?.toLowerCase();
  if (toolName?.includes(FEATURE_TREE_STORY_CONFIRMATION_TOOL_NAME)) {
    return featureTreeStoryConfirmationHasEvidence(update);
  }

  if (toolName && CONFIRMING_TOOL_NAMES.some((candidate) => toolName.includes(candidate))) {
    return true;
  }

  const kind = normalizeToolKind(typeof update.kind === "string" ? update.kind : undefined);
  if (kind && CONFIRMING_TOOL_KINDS.has(kind)) {
    return true;
  }

  const commandToken = extractCommandToken(update);
  return Boolean(commandToken && CONFIRMING_SHELL_PREFIXES.has(commandToken));
}

export async function hasConfirmedBacklogContextInspection(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) {
    return false;
  }

  const { loadSessionHistory } = await import("@/core/session-history");
  const history = await loadSessionHistory(sessionId);
  return history.some(notificationConfirmsBacklogContext);
}

export async function filterBacklogContextSearchSpec(params: {
  contextSearchSpec: TaskContextSearchSpec | undefined;
  columnId: string | undefined;
  sessionId?: string;
  hasExistingConfirmedContext?: boolean;
}): Promise<{ contextSearchSpec: TaskContextSearchSpec | undefined; stripped: boolean; warning?: string }> {
  const { contextSearchSpec, columnId, sessionId, hasExistingConfirmedContext } = params;
  if (!contextSearchSpec) {
    return { contextSearchSpec, stripped: false };
  }

  if (columnId !== "backlog") {
    return { contextSearchSpec, stripped: false };
  }

  if (!sessionId) {
    return { contextSearchSpec, stripped: false };
  }

  if (hasExistingConfirmedContext) {
    return { contextSearchSpec, stripped: false };
  }

  const confirmed = await hasConfirmedBacklogContextInspection(sessionId);
  if (confirmed) {
    return { contextSearchSpec, stripped: false };
  }

  return {
    contextSearchSpec: undefined,
    stripped: true,
    warning: STRIP_WARNING,
  };
}

export const BACKLOG_CONTEXT_SEARCH_SPEC_WARNING = STRIP_WARNING;
