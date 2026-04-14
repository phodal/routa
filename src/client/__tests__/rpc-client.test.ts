/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/diagnostics", () => ({
  isTauriRuntime: () => false,
}));

vi.mock("../config/backend", () => ({
  resolveApiPath: () => "/api/rpc",
}));

import { RoutaRpcClient } from "../rpc-client";

describe("RoutaRpcClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves sessionMayContinue on JSON-RPC errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Session timed out",
        sessionMayContinue: true,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new RoutaRpcClient("");

    await expect(client.call("agents.list")).rejects.toMatchObject({
      code: -32000,
      message: "Session timed out",
      sessionMayContinue: true,
    });
  });
});
