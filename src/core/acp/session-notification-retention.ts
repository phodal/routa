import type { AcpSessionNotification } from "../store/acp-session-store";

const TOOL_CALL_PARAMS_DELTA = "tool_call_params_delta";
const COMPACTION_REASON = "tool_call_params_delta_persistence";
const MAX_PARTIAL_JSON_CHARS = 512;

function truncateText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function byteLength(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  return Buffer.byteLength(value, "utf8");
}

function objectKeyCount(value: unknown): number | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).length
    : undefined;
}

export function compactToolCallParamsDeltaUpdate(
  update: Record<string, unknown>,
): Record<string, unknown> {
  if (update.sessionUpdate !== TOOL_CALL_PARAMS_DELTA) {
    return update;
  }
  if (
    update.compacted === true &&
    update.compactionReason === COMPACTION_REASON &&
    update.accumulatedJson === undefined &&
    update.parsedInput === undefined
  ) {
    return update;
  }

  const compacted: Record<string, unknown> = {
    sessionUpdate: TOOL_CALL_PARAMS_DELTA,
  };

  for (const key of ["toolCallId", "toolName", "name", "kind", "title"] as const) {
    if (update[key] !== undefined) {
      compacted[key] = update[key];
    }
  }

  const partialJson = truncateText(update.partialJson, MAX_PARTIAL_JSON_CHARS);
  if (partialJson !== undefined) {
    compacted.partialJson = partialJson;
  }

  const partialJsonBytes = byteLength(update.partialJson);
  if (partialJsonBytes !== undefined) {
    compacted.partialJsonBytes = partialJsonBytes;
  }

  const accumulatedJsonBytes = byteLength(update.accumulatedJson);
  if (accumulatedJsonBytes !== undefined) {
    compacted.accumulatedJsonBytes = accumulatedJsonBytes;
  }

  const parsedInputKeys = objectKeyCount(update.parsedInput);
  if (parsedInputKeys !== undefined) {
    compacted.parsedInputKeys = parsedInputKeys;
  }

  compacted.compacted = true;
  compacted.compactionReason = COMPACTION_REASON;
  return compacted;
}

export function compactSessionNotificationForPersistence<T extends AcpSessionNotification>(
  notification: T,
): T {
  const update = notification.update;
  if (!update || update.sessionUpdate !== TOOL_CALL_PARAMS_DELTA) {
    return notification;
  }

  return {
    ...notification,
    update: compactToolCallParamsDeltaUpdate(update),
  };
}

export function compactSessionHistoryForPersistence<T extends AcpSessionNotification>(
  history: T[],
): T[] {
  return history.map((notification) => compactSessionNotificationForPersistence(notification));
}
