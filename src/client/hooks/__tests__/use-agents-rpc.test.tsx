import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rpcCallMock,
  logRuntimeMock,
  toErrorMessageMock,
} = vi.hoisted(() => ({
  rpcCallMock: vi.fn(),
  logRuntimeMock: vi.fn(),
  toErrorMessageMock: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
}));

vi.mock("../../rpc-client", () => ({
  rpc: {
    call: rpcCallMock,
  },
}));

vi.mock("../../utils/diagnostics", () => ({
  logRuntime: logRuntimeMock,
  toErrorMessage: toErrorMessageMock,
}));

import { useAgentsRpc } from "../use-agents-rpc";

describe("useAgentsRpc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads agents on mount", async () => {
    rpcCallMock.mockResolvedValueOnce({
      agents: [
        { id: "agent-1", name: "Routa", role: "ROUTA", modelTier: "SMART", workspaceId: "ws-1", status: "ACTIVE", createdAt: "", updatedAt: "", metadata: {} },
      ],
    });

    const { result } = renderHook(() => useAgentsRpc("ws-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.agents).toHaveLength(1);
    });

    expect(rpcCallMock).toHaveBeenCalledWith("agents.list", { workspaceId: "ws-1" });
  });

  it("creates, updates, and deletes agents while refreshing the list", async () => {
    rpcCallMock
      .mockResolvedValueOnce({ agents: [] })
      .mockResolvedValueOnce({
        agentId: "agent-2",
        agent: { id: "agent-2", name: "Crafter", role: "CRAFTER", modelTier: "BALANCED", workspaceId: "ws-1", status: "PENDING", createdAt: "", updatedAt: "", metadata: {} },
      })
      .mockResolvedValueOnce({
        agents: [
          { id: "agent-2", name: "Crafter", role: "CRAFTER", modelTier: "BALANCED", workspaceId: "ws-1", status: "PENDING", createdAt: "", updatedAt: "", metadata: {} },
        ],
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        agents: [
          { id: "agent-2", name: "Crafter", role: "CRAFTER", modelTier: "BALANCED", workspaceId: "ws-1", status: "ACTIVE", createdAt: "", updatedAt: "", metadata: {} },
        ],
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ agents: [] });

    const { result } = renderHook(() => useAgentsRpc("ws-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      const created = await result.current.createAgent({ name: "Crafter", role: "CRAFTER" });
      expect(created?.id).toBe("agent-2");
    });

    expect(result.current.agents).toHaveLength(1);

    await act(async () => {
      await result.current.updateAgentStatus("agent-2", "ACTIVE");
    });

    expect(result.current.agents[0]?.status).toBe("ACTIVE");

    await act(async () => {
      await result.current.deleteAgent("agent-2");
    });

    expect(result.current.agents).toEqual([]);
  });

  it("surfaces rpc errors for fetch and create", async () => {
    rpcCallMock.mockRejectedValueOnce(new Error("list failed"));

    const { result } = renderHook(() => useAgentsRpc("ws-1"));

    await waitFor(() => {
      expect(result.current.error).toBe("list failed");
    });

    rpcCallMock.mockRejectedValueOnce(new Error("create failed"));

    await act(async () => {
      const created = await result.current.createAgent({ name: "Broken", role: "ROUTA" });
      expect(created).toBeNull();
    });

    expect(result.current.error).toBe("create failed");
  });
});
