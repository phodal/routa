"use client";

import { useCallback, useRef } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export function useSessionMcpTool(workspaceId: string) {
  const mcpSessionRef = useRef<string | null>(null);

  const initMcpSession = useCallback(async (): Promise<string | null> => {
    const initResponse = await desktopAwareFetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Routa-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "routa-ui", version: "0.1.0" },
        },
      }),
    });
    const mcpSessionId = initResponse.headers.get("mcp-session-id");
    if (mcpSessionId) {
      mcpSessionRef.current = mcpSessionId;
    }
    return mcpSessionId;
  }, [workspaceId]);

  const callMcpTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    if (!mcpSessionRef.current) {
      await initMcpSession();
    }

    const doCall = async () => {
      const response = await desktopAwareFetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Routa-Workspace-Id": workspaceId,
          ...(mcpSessionRef.current ? { "Mcp-Session-Id": mcpSessionRef.current } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        }),
      });

      const newSessionId = response.headers.get("mcp-session-id");
      if (newSessionId && newSessionId !== mcpSessionRef.current) {
        mcpSessionRef.current = newSessionId;
      }

      return response.json();
    };

    let data = await doCall();
    const isStaleSession =
      (data.error?.code === -32000 && data.error?.message?.includes("not initialized")) ||
      (data.error?.code === -32602 && data.error?.message?.includes("not found"));
    if (isStaleSession) {
      mcpSessionRef.current = null;
      await initMcpSession();
      data = await doCall();
    }

    if (data.error) {
      throw new Error(data.error.message || "MCP tool call failed");
    }
    return data.result;
  }, [initMcpSession, workspaceId]);

  return { callMcpTool };
}
