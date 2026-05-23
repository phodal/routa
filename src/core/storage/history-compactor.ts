/**
 * HistoryCompactor — Compresses and archives old session/trace data.
 *
 * Two strategies:
 * 1. Compress sessions >7 days: merge consecutive agent_message_chunk → agent_message
 * 2. Archive traces >30 days: keep only session_start, session_end, tool_call summaries
 */

import { eq, and, lt, asc, inArray } from "drizzle-orm";
import type { Database } from "../db/index";
import { sessionMessages, traces } from "../db/schema";

export interface CompactResult {
  compressedSessions: number;
  mergedChunks: number;
  archivedTraces: number;
  deletedTraces: number;
}

export type SessionHistoryNotification = {
  sessionId?: string;
  update?: {
    sessionUpdate?: string;
    content?: {
      type?: string;
      text?: string;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export interface SessionHistoryCompactionResult {
  history: SessionHistoryNotification[];
  originalCount: number;
  compactedCount: number;
  mergedChunks: number;
  mergedGroups: number;
}

export function getSessionHistoryChunkText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const notification = value as SessionHistoryNotification & {
    text?: unknown;
    content?: unknown;
  };
  const directText = typeof notification.text === "string" ? notification.text : "";
  if (directText) {
    return directText;
  }

  if (typeof notification.content === "string") {
    return notification.content;
  }

  const updateContent = notification.update?.content;
  return typeof updateContent?.text === "string" ? updateContent.text : "";
}

export function isSessionHistoryChunk(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const notification = value as SessionHistoryNotification & {
    type?: unknown;
    eventType?: unknown;
  };
  return notification.update?.sessionUpdate === "agent_message_chunk"
    || notification.type === "agent_message_chunk"
    || notification.eventType === "agent_message_chunk";
}

export function compactSessionHistoryNotifications(
  history: SessionHistoryNotification[],
): SessionHistoryCompactionResult {
  const compacted: SessionHistoryNotification[] = [];
  let currentChunks: SessionHistoryNotification[] = [];
  let currentSessionId: string | undefined;
  let mergedChunks = 0;
  let mergedGroups = 0;

  const flushChunks = () => {
    if (currentChunks.length === 0) {
      return;
    }

    if (currentChunks.length === 1) {
      compacted.push(currentChunks[0]);
      currentChunks = [];
      return;
    }

    const first = currentChunks[0];
    const firstRecord = first as SessionHistoryNotification & {
      content?: unknown;
      eventType?: unknown;
      text?: unknown;
      type?: unknown;
    };
    const text = currentChunks.map(getSessionHistoryChunkText).join("");
    const merged: SessionHistoryNotification = {
      ...first,
      sessionId: currentSessionId ?? first.sessionId,
      update: {
        ...(first.update ?? {}),
        sessionUpdate: "agent_message",
        content: {
          type: "text",
          text,
        },
        mergedFrom: currentChunks.length,
      },
    };
    if (firstRecord.type === "agent_message_chunk") {
      merged.type = "agent_message";
    }
    if (firstRecord.eventType === "agent_message_chunk") {
      merged.eventType = "agent_message";
    }
    if (typeof firstRecord.text === "string") {
      merged.text = text;
    }
    if (typeof firstRecord.content === "string") {
      merged.content = text;
    }
    compacted.push(merged);
    mergedChunks += currentChunks.length;
    mergedGroups++;
    currentChunks = [];
  };

  for (const notification of history) {
    if (isSessionHistoryChunk(notification)) {
      if (currentSessionId !== notification.sessionId) {
        flushChunks();
        currentSessionId = notification.sessionId;
      }
      currentChunks.push(notification);
      continue;
    }

    flushChunks();
    currentSessionId = notification.sessionId;
    compacted.push(notification);
  }

  flushChunks();

  return {
    history: compacted,
    originalCount: history.length,
    compactedCount: compacted.length,
    mergedChunks,
    mergedGroups,
  };
}

export class HistoryCompactor {
  constructor(private db: Database) {}

  /**
   * Run both compression and archival.
   */
  async compact(): Promise<CompactResult> {
    const [compress, archive] = await Promise.all([
      this.compressOldSessions(),
      this.archiveOldTraces(),
    ]);
    return {
      compressedSessions: compress.sessionsProcessed,
      mergedChunks: compress.chunksMerged,
      archivedTraces: archive.tracesKept,
      deletedTraces: archive.tracesDeleted,
    };
  }

  /**
   * Compress sessions older than 7 days:
   * Merge consecutive agent_message_chunk events into a single agent_message.
   */
  private async compressOldSessions(): Promise<{
    sessionsProcessed: number;
    chunksMerged: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Find session_messages with event_type = 'agent_message_chunk' older than cutoff
    const oldChunks = await this.db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.eventType, "agent_message_chunk"),
          lt(sessionMessages.createdAt, cutoff)
        )
      )
      .orderBy(
        asc(sessionMessages.sessionId),
        asc(sessionMessages.messageIndex)
      );

    if (oldChunks.length === 0) {
      return { sessionsProcessed: 0, chunksMerged: 0 };
    }

    // Group consecutive chunks by sessionId
    const sessionGroups = new Map<
      string,
      (typeof oldChunks)[number][][]
    >();

    for (const chunk of oldChunks) {
      if (!sessionGroups.has(chunk.sessionId)) {
        sessionGroups.set(chunk.sessionId, [[]]);
      }
      const groups = sessionGroups.get(chunk.sessionId)!;
      const lastGroup = groups[groups.length - 1];

      if (
        lastGroup.length === 0 ||
        lastGroup[lastGroup.length - 1].messageIndex ===
          chunk.messageIndex - 1
      ) {
        lastGroup.push(chunk);
      } else {
        groups.push([chunk]);
      }
    }

    let chunksMerged = 0;

    for (const [, groups] of sessionGroups) {
      for (const group of groups) {
        if (group.length < 2) continue;

        const first = group[0];
        const compactedGroup = compactSessionHistoryNotifications(group.map((chunk) => ({
          ...(chunk.payload as SessionHistoryNotification),
          sessionId: chunk.sessionId,
        })));
        const mergedPayload = compactedGroup.history[0];
        if (!mergedPayload || compactedGroup.compactedCount !== 1) {
          continue;
        }

        // Update first chunk to be the merged message
        await this.db
          .update(sessionMessages)
          .set({
            eventType: "agent_message",
            payload: mergedPayload,
          })
          .where(eq(sessionMessages.id, first.id));

        // Delete the rest
        const idsToDelete = group.slice(1).map((c) => c.id);
        if (idsToDelete.length > 0) {
          await this.db
            .delete(sessionMessages)
            .where(inArray(sessionMessages.id, idsToDelete));
        }

        chunksMerged += group.length;
      }
    }

    return {
      sessionsProcessed: sessionGroups.size,
      chunksMerged,
    };
  }

  /**
   * Archive traces older than 30 days:
   * Keep only session_start, session_end, and tool_call events.
   * Delete all other trace types (conversation details, file changes, etc.)
   */
  private async archiveOldTraces(): Promise<{
    tracesKept: number;
    tracesDeleted: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const keepEventTypes = [
      "session_start",
      "session_end",
      "tool_call",
    ];

    // Count traces to keep (summary events)
    const keptRows = await this.db
      .select({ id: traces.id })
      .from(traces)
      .where(
        and(
          lt(traces.timestamp, cutoff),
          inArray(traces.eventType, keepEventTypes)
        )
      );

    // Delete non-summary traces older than 30 days
    const toDelete = await this.db
      .select({ id: traces.id })
      .from(traces)
      .where(
        and(
          lt(traces.timestamp, cutoff),
          // NOT IN keepEventTypes — delete everything else
          // drizzle doesn't have notInArray, so we select and delete
        )
      );

    // Filter out the ones we want to keep
    const keepIds = new Set(keptRows.map((r) => r.id));
    const deleteIds = toDelete
      .filter((r) => !keepIds.has(r.id))
      .map((r) => r.id);

    let deletedCount = 0;
    // Batch delete in chunks of 500
    for (let i = 0; i < deleteIds.length; i += 500) {
      const batch = deleteIds.slice(i, i + 500);
      await this.db
        .delete(traces)
        .where(inArray(traces.id, batch));
      deletedCount += batch.length;
    }

    return {
      tracesKept: keptRows.length,
      tracesDeleted: deletedCount,
    };
  }
}
