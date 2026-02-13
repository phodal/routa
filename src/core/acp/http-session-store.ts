/**
 * HttpSessionStore - In-memory store for ACP sessions and SSE delivery.
 *
 * Tracks sessions for UI listing and delivers `session/update` notifications
 * from opencode processes to the browser via Server-Sent Events.
 *
 * - Buffers notifications until SSE connects (avoids losing early updates)
 * - Supports multiple concurrent sessions with independent SSE streams
 */

export interface RoutaSessionRecord {
  sessionId: string;
  cwd: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  createdAt: string;
}

type Controller = ReadableStreamDefaultController<Uint8Array>;

interface SessionUpdateNotification {
  sessionId: string;
  update?: Record<string, unknown>;
  [key: string]: unknown;
}

class HttpSessionStore {
  private sessions = new Map<string, RoutaSessionRecord>();
  private sseControllers = new Map<string, Controller>();
  private pendingNotifications = new Map<string, SessionUpdateNotification[]>();

  upsertSession(record: RoutaSessionRecord) {
    this.sessions.set(record.sessionId, record);
  }

  listSessions(): RoutaSessionRecord[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getSession(sessionId: string): RoutaSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  attachSse(sessionId: string, controller: Controller) {
    this.sseControllers.set(sessionId, controller);
    this.flushPending(sessionId);
  }

  detachSse(sessionId: string) {
    this.sseControllers.delete(sessionId);
  }

  /**
   * Push a session/update notification. If SSE isn't connected yet, buffer it.
   *
   * Accepts the raw notification params from opencode (which may have different shapes).
   */
  pushNotification(notification: SessionUpdateNotification) {
    const sessionId = notification.sessionId;
    const controller = this.sseControllers.get(sessionId);

    if (controller) {
      this.writeSse(controller, {
        jsonrpc: "2.0",
        method: "session/update",
        params: notification,
      });
      return;
    }

    const pending = this.pendingNotifications.get(sessionId) ?? [];
    pending.push(notification);
    this.pendingNotifications.set(sessionId, pending);
  }

  /**
   * Send a one-off "connected" event (useful for UI).
   */
  pushConnected(sessionId: string) {
    const controller = this.sseControllers.get(sessionId);
    if (!controller) return;
    this.writeSse(controller, {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Connected to ACP session." },
        },
      },
    });
  }

  private flushPending(sessionId: string) {
    const controller = this.sseControllers.get(sessionId);
    if (!controller) return;

    const pending = this.pendingNotifications.get(sessionId);
    if (!pending || pending.length === 0) return;

    for (const n of pending) {
      this.writeSse(controller, {
        jsonrpc: "2.0",
        method: "session/update",
        params: n,
      });
    }
    this.pendingNotifications.delete(sessionId);
  }

  private writeSse(controller: Controller, payload: unknown) {
    const encoder = new TextEncoder();
    const event = `data: ${JSON.stringify(payload)}\n\n`;
    try {
      controller.enqueue(encoder.encode(event));
    } catch {
      // controller closed - drop silently
    }
  }
}

let singleton: HttpSessionStore | undefined;

export function getHttpSessionStore(): HttpSessionStore {
  if (!singleton) singleton = new HttpSessionStore();
  return singleton;
}
