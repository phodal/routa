import { getRoutaSystem } from "@/core/routa-system";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import {
  loadSessionFromDb,
  loadSessionFromLocalStorage,
} from "@/core/acp/session-db-persister";
import { findTaskForSession } from "@/core/kanban/session-kanban-context";
import { getTaskLaneSession } from "@/core/kanban/task-lane-history";

import { getTraceReader, type TraceQuery } from "./reader";
import type { TraceRecord } from "./types";

function dedupeTraceRecords(records: TraceRecord[]): TraceRecord[] {
  const deduped = new Map<string, TraceRecord>();
  for (const record of records) {
    const key = record.id || `${record.sessionId}:${record.timestamp}:${record.eventType}`;
    if (!deduped.has(key)) {
      deduped.set(key, record);
    }
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

async function resolveSessionCwd(sessionId: string): Promise<string | undefined> {
  const store = getHttpSessionStore();
  await store.hydrateFromDb();

  const activeSession = store.getSession(sessionId);
  if (activeSession?.cwd) {
    return activeSession.cwd;
  }

  const persistedSession =
    (await loadSessionFromDb(sessionId)) ?? (await loadSessionFromLocalStorage(sessionId));
  if (persistedSession?.cwd) {
    return persistedSession.cwd;
  }

  const system = getRoutaSystem();
  const workspaces = await system.workspaceStore.list();
  for (const workspace of workspaces) {
    const tasks = await system.taskStore.listByWorkspace(workspace.id);
    const task = findTaskForSession(tasks, sessionId);
    const laneSession = task ? getTaskLaneSession(task, sessionId) : undefined;
    if (laneSession?.cwd) {
      return laneSession.cwd;
    }
  }

  return undefined;
}

export async function resolveTraceReaderCwds(
  sessionId?: string,
  fallbackCwd: string = process.cwd(),
): Promise<string[]> {
  const cwds = new Set<string>([fallbackCwd]);

  if (sessionId) {
    const sessionCwd = await resolveSessionCwd(sessionId);
    if (sessionCwd) {
      cwds.add(sessionCwd);
    }
  }

  return Array.from(cwds);
}

export async function queryTracesWithSessionFallback(
  query: TraceQuery = {},
  fallbackCwd: string = process.cwd(),
): Promise<TraceRecord[]> {
  const { limit, offset, sessionId, ...readerQuery } = query;
  const readerCwds = await resolveTraceReaderCwds(sessionId, fallbackCwd);

  const traceGroups = await Promise.all(
    readerCwds.map((cwd) =>
      getTraceReader(cwd).query({
        ...readerQuery,
        sessionId,
      }),
    ),
  );

  const traces = dedupeTraceRecords(traceGroups.flat());
  const start = offset ?? 0;
  const end = limit === undefined ? undefined : start + limit;
  return traces.slice(start, end);
}
