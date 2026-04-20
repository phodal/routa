import type { NotificationHandler, JsonRpcMessage } from "@/core/acp/protocol-types";

interface DockerCreateSessionResponse {
  sessionId?: string;
  id?: string;
}

export class DockerOpenCodeAdapter {
  private baseUrl: string;
  private onNotification: NotificationHandler;
  private _alive = false;
  private localSessionId: string | null = null;
  private remoteSessionId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, onNotification: NotificationHandler) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.onNotification = onNotification;
  }

  get alive(): boolean {
    return this._alive;
  }

  async connect(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Docker OpenCode health check failed: ${res.status} ${res.statusText}`);
    }
    this._alive = true;
  }

  async createSession(title?: string): Promise<string> {
    if (!this._alive) {
      throw new Error("DockerOpenCodeAdapter is not connected");
    }

    const res = await fetch(`${this.baseUrl}/session/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title ?? "Routa Docker Session" }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json() as { error?: string };
        if (body.error) detail = `: ${body.error}`;
      } catch { /* ignore parse failure */ }
      throw new Error(`Failed to create docker OpenCode session: ${res.status} ${res.statusText}${detail}`);
    }

    const data = (await res.json()) as DockerCreateSessionResponse;
    const remoteId = data.sessionId ?? data.id;
    if (!remoteId) {
      throw new Error("Docker OpenCode session response missing session ID");
    }

    this.remoteSessionId = remoteId;
    this.localSessionId = `docker-opencode-${remoteId}`;
    return this.localSessionId;
  }

  async *promptStream(
    text: string,
    acpSessionId?: string,
    skillContent?: string,
    workspaceId?: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this._alive || !this.remoteSessionId) {
      throw new Error("Docker OpenCode session is not active");
    }

    const sessionId = acpSessionId ?? this.localSessionId ?? this.remoteSessionId;
    this.abortController = new AbortController();

    const res = await fetch(`${this.baseUrl}/session/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: this.abortController.signal,
      body: JSON.stringify({
        sessionId: this.remoteSessionId,
        prompt: text,
        skillContent,
        workspaceId,
      }),
    });

    if (!res.ok) {
      throw new Error(`Docker OpenCode prompt failed: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Docker OpenCode stream has no readable body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data:")) continue;
          const payload = frame.slice(5).trim();
          if (!payload) continue;

          const parsed = this.parseStreamPayload(payload, sessionId);
          if (!parsed) continue;

          this.onNotification(parsed);
          yield `data: ${JSON.stringify(parsed)}\n\n`;
        }
      }

      const complete = this.turnComplete(sessionId);
      this.onNotification(complete);
      yield `data: ${JSON.stringify(complete)}\n\n`;
      return;
    }

    const raw = await res.json();
    const content = typeof raw?.content === "string"
      ? raw.content
      : (typeof raw?.message === "string" ? raw.message : "");

    if (content) {
      const msg = this.agentChunk(sessionId, content);
      this.onNotification(msg);
      yield `data: ${JSON.stringify(msg)}\n\n`;
    }

    const complete = this.turnComplete(sessionId);
    this.onNotification(complete);
    yield `data: ${JSON.stringify(complete)}\n\n`;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async close(): Promise<void> {
    this.cancel();
    if (this.remoteSessionId) {
      await fetch(`${this.baseUrl}/session/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: this.remoteSessionId }),
      }).catch(() => {});
    }
    this.remoteSessionId = null;
    this.localSessionId = null;
    this._alive = false;
  }

  kill(): void {
    this.close().catch(() => {});
  }

  private parseStreamPayload(payload: string, sessionId: string): JsonRpcMessage | null {
    try {
      const data = JSON.parse(payload) as Record<string, unknown>;

      // Already ACP-compatible — but override sessionId to match Routa's
      // ACP session ID (the bridge relays the opencode-internal ID which
      // won't match the frontend's activeSessionId).
      if (data.method === "session/update") {
        const params = data.params as Record<string, unknown> | undefined;
        if (params) {
          params.sessionId = sessionId;
        }
        return data as unknown as JsonRpcMessage;
      }

      // Flexible conversion from a raw event object.
      const type = typeof data.type === "string" ? data.type : "agent_message_chunk";
      if (type === "error") {
        return {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            type: "error",
            error: { message: typeof data.message === "string" ? data.message : "Docker OpenCode error" },
          },
        };
      }

      const text = typeof data.content === "string"
        ? data.content
        : (typeof data.text === "string" ? data.text : "");

      if (!text) return null;
      return this.agentChunk(sessionId, text);
    } catch {
      if (!payload) return null;
      return this.agentChunk(sessionId, payload);
    }
  }

  private agentChunk(sessionId: string, text: string): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    };
  }

  private turnComplete(sessionId: string): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason: "end_turn",
        },
      },
    };
  }
}
