import { describe, expect, it } from "vitest";

import { consumeAcpPromptResponse, extractAcpPromptErrorForTest } from "../prompt-response";

describe("consumeAcpPromptResponse", () => {
  it("throws on JSON-RPC error payloads even when HTTP status is 200", async () => {
    const response = new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "req-1",
      error: {
        code: -32000,
        message: "Permission denied: HTTP error: 403 Forbidden",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(consumeAcpPromptResponse(response)).rejects.toThrow("Permission denied: HTTP error: 403 Forbidden");
  });

  it("includes nested ACP error data in JSON-RPC prompt failures", async () => {
    const response = new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "req-2",
      error: {
        code: -32000,
        message: "Internal error",
        data: {
          source: "acp",
          code: -32603,
          data: "failed to deserialize response",
        },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(consumeAcpPromptResponse(response)).rejects.toThrow(
      "Internal error: acp: -32603: failed to deserialize response",
    );
  });

  it("throws when an SSE prompt stream emits an error event", async () => {
    const response = new Response(
      [
        "data: {\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"sessionId\":\"sess-1\",\"type\":\"error\",\"error\":{\"message\":\"stream failed\"}}}\n\n",
      ].join(""),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );

    await expect(consumeAcpPromptResponse(response)).rejects.toThrow("stream failed");
  });

  it("resolves when SSE prompt stream completes without an explicit error", async () => {
    const response = new Response(
      [
        "data: {\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"sessionId\":\"sess-1\",\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"hello\"}}}}\n\n",
      ].join(""),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );

    await expect(consumeAcpPromptResponse(response)).resolves.toBeUndefined();
  });
});

describe("extractAcpPromptErrorForTest", () => {
  it("extracts error messages from nested session/update error payloads", () => {
    expect(extractAcpPromptErrorForTest({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "error",
          error: {
            message: "provider failed",
          },
        },
      },
    })).toBe("provider failed");
  });
});
