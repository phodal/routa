import { consolidateMessageHistory, getHttpSessionStore } from "@/core/acp/http-session-store";
import {
  loadHistoryFromDb,
  loadSessionFromLocalStorage,
  normalizeSessionHistory,
} from "@/core/acp/session-db-persister";
import type { AcpSessionNotification } from "@/core/store/acp-session-store";

export function mergeHistorySources<T>(inMemoryHistory: T[], dbHistory: T[]): T[] {
  if (inMemoryHistory.length === 0) return dbHistory;
  if (dbHistory.length === 0) return inMemoryHistory;
  if (dbHistory.length <= inMemoryHistory.length) return inMemoryHistory;

  const firstInMemory = JSON.stringify(inMemoryHistory[0]);
  const overlapIndex = dbHistory.findIndex((entry) => JSON.stringify(entry) === firstInMemory);

  if (overlapIndex <= 0) {
    return dbHistory;
  }

  return [...dbHistory.slice(0, overlapIndex), ...inMemoryHistory];
}

export async function loadSessionHistory(
  sessionId: string,
  { consolidated = false }: { consolidated?: boolean } = {},
): Promise<AcpSessionNotification[]> {
  const store = getHttpSessionStore();
  const initialInMemoryHistory = store.getHistory(sessionId);
  const sessionRecord = store.getSession(sessionId);
  const localSession = sessionRecord ? null : await loadSessionFromLocalStorage(sessionId);
  const dbHistory = await loadHistoryFromDb(sessionId, sessionRecord?.cwd ?? localSession?.cwd);
  const inMemoryHistory = store.getHistory(sessionId);

  let history: AcpSessionNotification[];

  if (inMemoryHistory.length === 0 && dbHistory.length > 0) {
    for (const notification of dbHistory) {
      store.pushNotificationToHistory(sessionId, notification);
    }
    history = dbHistory;
  } else if (dbHistory.length > inMemoryHistory.length) {
    history = mergeHistorySources(inMemoryHistory, dbHistory);
  } else if (initialInMemoryHistory.length > 0) {
    history = initialInMemoryHistory;
  } else {
    history = inMemoryHistory;
  }

  return normalizeSessionHistory(
    consolidated ? consolidateMessageHistory(history) : history,
  ) as AcpSessionNotification[];
}
