import { AgentRole } from "../models/agent";
import type { CompletionSnapshotSource } from "../storage/agent-memory-writer";

export interface ChildCompletionMemorySnapshot {
  sessionId: string;
  role: AgentRole;
  agentId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  summary?: string;
  verificationVerdict: string | null;
  verificationReport: string | null;
  snapshotSource: CompletionSnapshotSource;
}

const COMPLETION_SNAPSHOT_PRIORITY: Record<CompletionSnapshotSource, number> = {
  session_end: 0,
  auto: 1,
  reported: 2,
  error: 3,
};

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function shouldReplaceCompletionStatus(
  currentStatus: string,
  incomingStatus: string,
  currentSource: CompletionSnapshotSource,
  incomingSource: CompletionSnapshotSource,
): boolean {
  if (incomingStatus === currentStatus) {
    return false;
  }
  if (currentStatus === "unknown") {
    return true;
  }

  return COMPLETION_SNAPSHOT_PRIORITY[incomingSource] >= COMPLETION_SNAPSHOT_PRIORITY[currentSource];
}

export function completionSnapshotsEqual(
  left: ChildCompletionMemorySnapshot | undefined,
  right: ChildCompletionMemorySnapshot | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.sessionId === right.sessionId
    && left.role === right.role
    && left.agentId === right.agentId
    && left.taskId === right.taskId
    && left.taskTitle === right.taskTitle
    && left.status === right.status
    && left.summary === right.summary
    && left.verificationVerdict === right.verificationVerdict
    && left.verificationReport === right.verificationReport
    && left.snapshotSource === right.snapshotSource;
}

export function mergeCompletionSnapshot(
  current: ChildCompletionMemorySnapshot | undefined,
  incoming: ChildCompletionMemorySnapshot,
): ChildCompletionMemorySnapshot {
  if (!current) {
    return incoming;
  }

  const merged: ChildCompletionMemorySnapshot = {
    ...current,
    sessionId: incoming.sessionId,
    role: incoming.role,
    agentId: incoming.agentId,
    taskId: incoming.taskId,
    taskTitle: incoming.taskTitle,
  };

  if (shouldReplaceCompletionStatus(current.status, incoming.status, current.snapshotSource, incoming.snapshotSource)) {
    merged.status = incoming.status;
  }
  if (incoming.summary !== undefined && incoming.summary !== current.summary) {
    merged.summary = incoming.summary;
  }
  if (
    incoming.verificationVerdict !== null
    && incoming.verificationVerdict !== current.verificationVerdict
  ) {
    merged.verificationVerdict = incoming.verificationVerdict;
  }
  if (
    incoming.verificationReport !== null
    && incoming.verificationReport !== current.verificationReport
  ) {
    merged.verificationReport = incoming.verificationReport;
  }

  if (!completionSnapshotsEqual(current, merged)) {
    merged.snapshotSource = incoming.snapshotSource;
  }

  return merged;
}
