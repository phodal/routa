import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHttpSessionStore,
  loadHistoryFromDb,
  loadSessionFromLocalStorage,
  consolidateMessageHistory,
  normalizeSessionHistory,
} = vi.hoisted(() => {
  const store = {
    getHistory: vi.fn(),
    getSession: vi.fn(),
    pushNotificationToHistory: vi.fn(),
  };

  return {
    getHttpSessionStore: vi.fn(() => store),
    loadHistoryFromDb: vi.fn(),
    loadSessionFromLocalStorage: vi.fn(),
    consolidateMessageHistory: vi.fn((history) => history),
    normalizeSessionHistory: vi.fn((history) => history),
  };
});

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore,
  consolidateMessageHistory,
}));

vi.mock("@/core/acp/session-db-persister", () => ({
  loadHistoryFromDb,
  loadSessionFromLocalStorage,
  normalizeSessionHistory,
}));

import { loadSessionHistory } from "@/core/session-history";

describe("loadSessionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const store = getHttpSessionStore();
    store.getHistory.mockReturnValue([]);
    store.getSession.mockReturnValue(undefined);
    loadHistoryFromDb.mockResolvedValue([]);
    loadSessionFromLocalStorage.mockResolvedValue(null);
  });

  it("uses local session cwd when store metadata is unavailable", async () => {
    loadSessionFromLocalStorage.mockResolvedValue({
      id: "session-123",
      cwd: "/tmp/local-cwd",
    });
    loadHistoryFromDb.mockResolvedValue([
      { sessionId: "session-123", update: { sessionUpdate: "agent_message" } },
    ]);

    const history = await loadSessionHistory("session-123", { consolidated: true });

    expect(loadSessionFromLocalStorage).toHaveBeenCalledWith("session-123");
    expect(loadHistoryFromDb).toHaveBeenCalledWith("session-123", "/tmp/local-cwd");
    expect(consolidateMessageHistory).toHaveBeenCalledTimes(1);
    expect(history).toHaveLength(1);
  });

  it("does not hit local storage when in-memory session metadata already provides cwd", async () => {
    const store = getHttpSessionStore();
    store.getSession.mockReturnValue({ cwd: "/tmp/store-cwd" });

    await loadSessionHistory("session-123", { consolidated: false });

    expect(loadSessionFromLocalStorage).not.toHaveBeenCalled();
    expect(loadHistoryFromDb).toHaveBeenCalledWith("session-123", "/tmp/store-cwd");
  });
});
