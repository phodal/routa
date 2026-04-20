/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAcpClient } from "../acp-client";

class MockEventSource {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly url: string;
  readyState = 1;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  emitMessage(payload: unknown, lastEventId?: string) {
    this.onmessage?.({
      data: JSON.stringify(payload),
      lastEventId: lastEventId ?? "",
    } as MessageEvent<string>);
  }

  emitClosedError() {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.();
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

describe("BrowserAcpClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects with the last seen SSE event id", async () => {
    const client = new BrowserAcpClient("");
    client.attachSession("session-1");
    await vi.waitFor(() => {
      expect(MockEventSource.instances[0]).toBeDefined();
    });

    const first = MockEventSource.instances[0];
    expect(first.url).toContain("/api/acp?sessionId=session-1");
    expect(first.url).not.toContain("lastEventId=");

    first.emitMessage({
      method: "session/update",
      params: {
        sessionId: "session-1",
        eventId: "evt-1",
        update: { sessionUpdate: "agent_message" },
      },
    }, "evt-1");

    first.emitClosedError();
    await vi.advanceTimersByTimeAsync(2000);

    const second = MockEventSource.instances[1];
    expect(second).toBeDefined();
    expect(second.url).toContain("sessionId=session-1");
    expect(second.url).toContain("lastEventId=evt-1");
  });

  it("retries transient ownership conflicts before attaching", async () => {
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      requestCount += 1;
      if (requestCount <= 2) {
        return new Response(JSON.stringify({
          error: "Session is currently owned by instance web-2 until 2099-01-01T00:00:00.000Z.",
          ownerInstanceId: "web-2",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    }));

    const client = new BrowserAcpClient("");
    const issues: string[] = [];
    client.onConnectionIssue((issue) => {
      issues.push(issue.message);
    });

    client.attachSession("session-1");
    await vi.runAllTimersAsync();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(requestCount).toBeGreaterThanOrEqual(3);
    expect(issues).toEqual([
      "Session is currently owned by instance web-2 until 2099-01-01T00:00:00.000Z.",
      "Session is currently owned by instance web-2 until 2099-01-01T00:00:00.000Z.",
    ]);
  });

  it("loads an existing session and attaches SSE to it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === "session/load") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            sessionId: "session-resume-1",
            provider: "codex",
            acpStatus: "ready",
            resumeMode: "native",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    }));

    const client = new BrowserAcpClient("");
    const result = await client.loadSession({
      sessionId: "session-resume-1",
      cwd: "/tmp/codex",
    });

    expect(result).toMatchObject({
      sessionId: "session-resume-1",
      provider: "codex",
      resumeMode: "native",
    });
    expect(client.sessionId).toBe("session-resume-1");
    await vi.waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toContain("sessionId=session-resume-1");
    });
  });

  it("preserves sessionMayContinue on RPC errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Session timed out but may continue",
        sessionMayContinue: true,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new BrowserAcpClient("");

    await expect(client.initialize()).rejects.toMatchObject({
      code: -32000,
      message: "Session timed out but may continue",
      sessionMayContinue: true,
    });
  });

  it("preserves sessionMayContinue on prompt errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32010,
        message: "Prompt timed out",
        sessionMayContinue: true,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new BrowserAcpClient("");

    await expect(client.prompt("session-1", "continue")).rejects.toMatchObject({
      code: -32010,
      message: "Prompt timed out",
      sessionMayContinue: true,
    });
  });
});
