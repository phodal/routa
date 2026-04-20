/**
 * @vitest-environment node
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionUpdateNotification } from "../http-session-store";
import { getHttpSessionStore } from "../http-session-store";
import {
  appendSessionNotificationEvent,
  hasUserMessageInHistory,
  loadHistorySinceEventIdFromDb,
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  normalizeSessionHistory,
  persistSessionToDb,
  updateSessionExecutionBindingInDb,
} from "../session-db-persister";
import { LocalSessionProvider } from "../../storage/local-session-provider";

let tmpDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-db-persister-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  const store = getHttpSessionStore();
  for (const session of store.listSessions()) {
    store.deleteSession(session.sessionId);
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  // Close SQLite database to release file locks on Windows
  try {
    const { closeSqliteDatabase } = await import("../../db/sqlite");
    closeSqliteDatabase();
  } catch {
    // Ignore if import fails
  }

  // On Windows, file locks may not be released immediately after close
  // Add a small delay and retry the cleanup
  if (process.platform === "win32") {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows may keep file locks; cleanup will happen on reboot
  }
});

describe("session-db-persister", () => {
  it("detects persisted user prompts in session history", () => {
    const history: SessionUpdateNotification[] = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "acp_status",
          status: "ready",
        },
      } as SessionUpdateNotification,
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message",
          content: { type: "text", text: "hello" },
        },
      } as SessionUpdateNotification,
    ];

    expect(hasUserMessageInHistory(history)).toBe(true);
  });

  it("returns false when no user prompt has been stored", () => {
    const history: SessionUpdateNotification[] = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "acp_status",
          status: "ready",
        },
      } as SessionUpdateNotification,
    ];

    expect(hasUserMessageInHistory(history)).toBe(false);
  });

  it("appends session notifications to the local JSONL event log", async () => {
    const projectPath = path.join(tmpDir, "project");
    const sessionId = "session-jsonl";
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId,
      cwd: projectPath,
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    const notification: SessionUpdateNotification = {
      sessionId,
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "hello from jsonl" },
      },
    };

    await appendSessionNotificationEvent(sessionId, notification);

    const history = await new LocalSessionProvider(projectPath).getHistory(sessionId);
    expect(history).toHaveLength(1);
    expect((history[0] as { message: SessionUpdateNotification }).message).toEqual(notification);
  });

  it("loads only notifications after a durable event id", async () => {
    const projectPath = path.join(tmpDir, "project-replay");
    const sessionId = "session-replay";
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId,
      cwd: projectPath,
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    const first: SessionUpdateNotification = {
      sessionId,
      eventId: "evt-1",
      update: {
        sessionUpdate: "user_message",
        content: { type: "text", text: "first" },
      },
    };
    const second: SessionUpdateNotification = {
      sessionId,
      eventId: "evt-2",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "second" },
      },
    };

    await appendSessionNotificationEvent(sessionId, first);
    await appendSessionNotificationEvent(sessionId, second);

    const replay = await loadHistorySinceEventIdFromDb(sessionId, "evt-1", projectPath);
    expect(replay).toHaveLength(1);
    expect(replay[0]).toEqual(second);
  });

  it("falls back to in-memory history when durable replay misses the event id", async () => {
    const sessionId = "session-memory-fallback";
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId,
      cwd: path.join(tmpDir, "memory-fallback"),
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId,
      eventId: "evt-a",
      update: { sessionUpdate: "user_message", content: { type: "text", text: "a" } },
    });
    store.pushNotification({
      sessionId,
      eventId: "evt-b",
      update: { sessionUpdate: "agent_message", content: { type: "text", text: "b" } },
    });

    const replay = await loadHistorySinceEventIdFromDb(sessionId, "evt-a");
    expect(replay).toHaveLength(1);
    expect(replay[0].eventId).toBe("evt-b");
  });

  it("persists sessions to local JSONL storage alongside database writes", async () => {
    const projectPath = path.join(tmpDir, "persisted-session");

    await persistSessionToDb({
      id: "persisted-1",
      name: "Persisted Session",
      cwd: projectPath,
      workspaceId: "ws-1",
      routaAgentId: "agent-1",
      provider: "opencode",
      role: "CRAFTER",
      modeId: "plan",
      model: "glm-4.7",
      specialistId: "researcher",
    });

    const session = await loadSessionFromLocalStorage("persisted-1");
    expect(session).toMatchObject({
      id: "persisted-1",
      name: "Persisted Session",
      cwd: projectPath,
      workspaceId: "ws-1",
      provider: "opencode",
      role: "CRAFTER",
      modeId: "plan",
      model: "glm-4.7",
      specialistId: "researcher",
    });
  });

  it("loads persisted sessions from local JSONL storage", async () => {
    const projectPath = path.join(tmpDir, "local-session");
    const provider = new LocalSessionProvider(projectPath);

    await provider.save({
      id: "local-1",
      cwd: projectPath,
      workspaceId: "ws-local",
      routaAgentId: "agent-local",
      provider: "claude",
      role: "CRAFTER",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const session = await loadSessionFromLocalStorage("local-1");
    expect(session).toMatchObject({
      id: "local-1",
      cwd: projectPath,
      workspaceId: "ws-local",
      routaAgentId: "agent-local",
      provider: "claude",
      role: "CRAFTER",
    });
  });

  it("treats execution binding updates for missing sessions as a safe no-op", async () => {
    await expect(updateSessionExecutionBindingInDb("missing-session", {
      executionMode: "runner",
      ownerInstanceId: "instance-7",
      leaseExpiresAt: "2026-04-16T00:00:00.000Z",
    })).resolves.toBeUndefined();
    expect(await loadSessionFromDb("missing-session")).toBeNull();
  });
});

describe("normalizeSessionHistory", () => {
  it("collapses repeated conversation blocks", () => {
    const firstBlock = [
      {
        sessionId: "s1",
        update: { sessionUpdate: "user_message", content: { type: "text", text: "hello" } },
      },
      {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message", content: { type: "text", text: "world" } },
      },
    ];

    expect(normalizeSessionHistory([...firstBlock, ...firstBlock])).toEqual(firstBlock);
  });

  it("keeps repeated non-conversation records intact", () => {
    const input = [
      { sessionId: "s1", update: { sessionUpdate: "acp_status", status: "ready" } },
      { sessionId: "s1", update: { sessionUpdate: "acp_status", status: "ready" } },
    ];

    expect(normalizeSessionHistory(input)).toEqual(input);
  });
});
