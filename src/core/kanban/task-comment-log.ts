import { v4 as uuidv4 } from "uuid";
import type { TaskCommentEntry } from "../models/task";

export function appendTaskComment(existing: string | undefined, next: string): string {
  const trimmedNext = next.trim();
  if (!trimmedNext) {
    return existing ?? "";
  }

  const trimmedExisting = existing?.trim();
  return trimmedExisting ? `${trimmedExisting}\n\n${trimmedNext}` : trimmedNext;
}

export function appendTaskCommentEntry(
  existing: TaskCommentEntry[] | undefined,
  next: string,
  metadata?: { agentId?: string; sessionId?: string; source?: TaskCommentEntry["source"] },
): TaskCommentEntry[] {
  const trimmedNext = next.trim();
  if (!trimmedNext) {
    return existing ?? [];
  }

  const source = metadata && Object.prototype.hasOwnProperty.call(metadata, "source")
    ? metadata.source
    : "update_card";

  return [
    ...(existing ?? []),
    {
      id: uuidv4(),
      body: trimmedNext,
      createdAt: new Date().toISOString(),
      source,
      agentId: metadata?.agentId,
      sessionId: metadata?.sessionId,
    },
  ];
}
