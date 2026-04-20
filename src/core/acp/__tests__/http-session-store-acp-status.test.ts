/**
 * Unit tests for HttpSessionStore.updateSessionAcpStatus
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus, AgentEventType, type AgentEvent } from "../../events/event-bus";
import { LocalSessionProvider } from "../../storage/local-session-provider";

// We need to test the store in isolation. Import the class and types.
// The singleton getter is module-scoped, so we test via the exported function.
import { getHttpSessionStore, consolidateMessageHistory } from "../http-session-store";
import type { SessionUpdateNotification } from "../http-session-store";

let tmpDir: string;
let originalHome: string | undefined;

describe("HttpSessionStore — ACP status", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "http-session-store-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  beforeEach(() => {
    // Clean up sessions from previous tests
    const store = getHttpSessionStore();
    for (const s of store.listSessions()) {
      store.deleteSession(s.sessionId);
    }
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("upsertSession stores acpStatus field", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-1",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    const session = store.getSession("test-1");
    expect(session).toBeDefined();
    expect(session!.acpStatus).toBe("connecting");
  });

  it("updateSessionAcpStatus transitions connecting → ready", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-2",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-2", "ready");

    const session = store.getSession("test-2");
    expect(session!.acpStatus).toBe("ready");
    expect(session!.acpError).toBeUndefined();
  });

  it("updateSessionAcpStatus transitions connecting → error with message", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-3",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-3", "error", "Process crashed");

    const session = store.getSession("test-3");
    expect(session!.acpStatus).toBe("error");
    expect(session!.acpError).toBe("Process crashed");
  });

  it("updateSessionAcpStatus pushes acp_status notification to history", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-4",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-4", "ready");

    const history = store.getHistory("test-4");
    expect(history.length).toBeGreaterThanOrEqual(1);

    const statusNotification = history.find(
      (n) => (n.update as Record<string, unknown>)?.sessionUpdate === "acp_status"
    );
    expect(statusNotification).toBeDefined();
    expect((statusNotification!.update as Record<string, unknown>).status).toBe("ready");
  });

  it("updateSessionAcpStatus is a no-op for unknown session", () => {
    const store = getHttpSessionStore();
    // Should not throw
    store.updateSessionAcpStatus("nonexistent", "ready");
    expect(store.getSession("nonexistent")).toBeUndefined();
  });

  it("bridges agent completion lifecycle events onto the EventBus", () => {
    const store = getHttpSessionStore();
    const eventBus = new EventBus();
    const received: AgentEvent[] = [];
    store.setEventBus(eventBus);
    eventBus.on("test-listener", (event) => {
      received.push(event);
    });

    store.upsertSession({
      sessionId: "test-complete",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    received.length = 0;

    store.pushNotification({
      sessionId: "test-complete",
      update: {
        sessionUpdate: "turn_complete",
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
        },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: AgentEventType.AGENT_COMPLETED,
      workspaceId: "ws-1",
      data: {
        sessionId: "test-complete",
        success: true,
        stopReason: "end_turn",
      },
    });
  });

  it("tracks session activity timestamps from normalized ACP updates", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-activity",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: "2026-03-18T00:00:00.000Z",
    });

    store.pushNotification({
      sessionId: "test-activity",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        name: "read_file",
        title: "Read file",
        status: "running",
      },
    });

    const activity = store.getSessionActivity("test-activity");
    expect(activity).toBeDefined();
    expect(activity?.lastEventType).toBe("tool_call");
    expect(activity?.lastMeaningfulActivityAt).toBeTruthy();
  });

  it("maps runtime error notifications into session acpStatus metadata", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-runtime-error",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "auggie",
      acpStatus: "ready",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId: "test-runtime-error",
      update: {
        sessionUpdate: "error",
        error: {
          message: "Permission denied: HTTP error: 403 Forbidden",
        },
      },
    });

    const session = store.getSession("test-runtime-error");
    expect(session?.acpStatus).toBe("error");
    expect(session?.acpError).toBe("Permission denied: HTTP error: 403 Forbidden");

    const statusNotification = store.getHistory("test-runtime-error").find(
      (entry) => (entry.update as Record<string, unknown>)?.sessionUpdate === "acp_status",
    );
    expect(statusNotification).toBeDefined();
    expect((statusNotification?.update as Record<string, unknown>)?.status).toBe("error");
  });

  it("recovers a timeout-marked ACP session when later activity arrives", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-timeout-recovery",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "codex",
      acpStatus: "error",
      acpError: "Timeout waiting for session/prompt (id=3)",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId: "test-timeout-recovery",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "still working" },
      },
    });

    const session = store.getSession("test-timeout-recovery");
    expect(session?.acpStatus).toBe("ready");
    expect(session?.acpError).toBeUndefined();
  });

  it("appends pushed notifications to the local event log", async () => {
    const store = getHttpSessionStore();
    const projectPath = path.join(process.env.HOME!, "project");
    store.upsertSession({
      sessionId: "test-jsonl-log",
      cwd: projectPath,
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    const notification: SessionUpdateNotification = {
      sessionId: "test-jsonl-log",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "persist me" },
      },
    };

    store.pushNotification(notification);
    const provider = new LocalSessionProvider(projectPath);
    let history = await provider.getHistory("test-jsonl-log");
    for (let attempt = 0; attempt < 10 && history.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      history = await provider.getHistory("test-jsonl-log");
    }

    expect(history).toHaveLength(1);
    expect((history[0] as { message: SessionUpdateNotification }).message).toEqual(notification);
  });

  it("assigns event ids and replays history after a known event", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-replay",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId: "test-replay",
      update: { sessionUpdate: "user_message", content: { type: "text", text: "one" } },
    });
    store.pushNotification({
      sessionId: "test-replay",
      update: { sessionUpdate: "agent_message", content: { type: "text", text: "two" } },
    });

    const history = store.getHistory("test-replay");
    expect(history).toHaveLength(2);
    expect(history[0].eventId).toBeTruthy();
    expect(history[1].eventId).toBeTruthy();

    const replay = store.getHistorySinceEventId("test-replay", history[0].eventId!);
    expect(replay).toHaveLength(1);
    expect(replay[0].eventId).toBe(history[1].eventId);
  });

  it("suppresses duplicate SSE delivery while prompt streaming is active", () => {
    const store = getHttpSessionStore();
    const enqueue = vi.fn();
    store.upsertSession({
      sessionId: "test-streaming",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    store.attachSse("test-streaming", {
      enqueue,
    } as unknown as ReadableStreamDefaultController<Uint8Array>);
    store.enterStreamingMode("test-streaming");

    store.pushNotification({
      sessionId: "test-streaming",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "stream response owns this delivery" },
      },
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(store.getHistory("test-streaming")).toHaveLength(1);

    store.exitStreamingMode("test-streaming");
    store.pushNotification({
      sessionId: "test-streaming",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "deliver over SSE now" },
      },
    });

    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("invokes and removes notification interceptors safely", () => {
    const store = getHttpSessionStore();
    const seen: SessionUpdateNotification[] = [];
    const interceptor = (notification: SessionUpdateNotification) => {
      seen.push(notification);
    };

    store.upsertSession({
      sessionId: "test-interceptor",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    store.addNotificationInterceptor("test-interceptor", interceptor);
    store.pushNotification({
      sessionId: "test-interceptor",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "hello interceptor" },
      },
    });
    store.removeNotificationInterceptor("test-interceptor", interceptor);
    store.pushNotification({
      sessionId: "test-interceptor",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "not intercepted" },
      },
    });

    expect(seen).toHaveLength(1);
    expect((seen[0].update as Record<string, unknown>)?.sessionUpdate).toBe("agent_message");
  });
});

describe("consolidateMessageHistory", () => {
  it("merges consecutive agent_message_chunk into single agent_message", () => {
    const notifications: SessionUpdateNotification[] = [
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } } },
    ];

    const result = consolidateMessageHistory(notifications);
    expect(result.length).toBe(1);
    const update = result[0].update as Record<string, unknown>;
    expect(update.sessionUpdate).toBe("agent_message");
    expect((update.content as { text: string }).text).toBe("Hello world");
  });

  it("preserves non-chunk notifications", () => {
    const notifications: SessionUpdateNotification[] = [
      { sessionId: "s1", update: { sessionUpdate: "tool_call", name: "read_file" } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } },
    ];

    const result = consolidateMessageHistory(notifications);
    expect(result.length).toBe(2);
    expect((result[0].update as Record<string, unknown>).sessionUpdate).toBe("tool_call");
    expect((result[1].update as Record<string, unknown>).sessionUpdate).toBe("agent_message");
  });
});
