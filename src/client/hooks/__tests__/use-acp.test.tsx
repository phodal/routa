import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpProviderInfo } from "@/client/acp-client";

const {
  initializeMock,
  listProvidersMock,
  loadRegistryProvidersMock,
  onUpdateMock,
  onConnectionIssueMock,
  disconnectMock,
} = vi.hoisted(() => ({
  initializeMock: vi.fn(async () => {}),
  listProvidersMock: vi.fn<(checkLocal?: boolean, checkRegistry?: boolean) => Promise<{
    id: string;
    name: string;
    description: string;
    command: string;
    status?: "available" | "unavailable" | "checking";
    source?: "static" | "registry";
    unavailableReason?: string;
  }[]>>(async () => []),
  loadRegistryProvidersMock: vi.fn(async () => []),
  onUpdateMock: vi.fn(),
  onConnectionIssueMock: vi.fn(),
  disconnectMock: vi.fn(),
}));

vi.mock("../../acp-client", () => ({
  BrowserAcpClient: class MockBrowserAcpClient {
    initialize = initializeMock;
    listProviders = listProvidersMock;
    loadRegistryProviders = loadRegistryProvidersMock;
    onUpdate = onUpdateMock;
    onConnectionIssue = onConnectionIssueMock;
    disconnect = disconnectMock;
  },
}));

import { loadSelectedAcpProvider, saveSelectedAcpProvider, useAcp } from "../use-acp";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("useAcp selected provider persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    const providers: AcpProviderInfo[] = [
      { id: "opencode", name: "OpenCode", command: "opencode", description: "OpenCode provider", status: "available", source: "static" },
      { id: "codex", name: "Codex", command: "codex-acp", description: "Codex provider", status: "available", source: "static" },
    ];
    listProvidersMock.mockImplementation(async (checkLocal?: boolean, checkRegistry?: boolean) => {
      if (!checkLocal && !checkRegistry) {
        return providers;
      }
      return providers;
    });
  });

  it("round-trips the selected provider through localStorage", () => {
    expect(loadSelectedAcpProvider()).toBe("opencode");

    saveSelectedAcpProvider("codex");

    expect(loadSelectedAcpProvider()).toBe("codex");
    expect(window.localStorage.getItem("routa.acp.selectedProvider")).toBe("codex");
  });

  it("hydrates selectedProvider from storage on mount", () => {
    window.localStorage.setItem("routa.acp.selectedProvider", "codex");

    const { result } = renderHook(() => useAcp());

    expect(result.current.selectedProvider).toBe("codex");
  });

  it("preserves the stored provider after connect when it is available", async () => {
    window.localStorage.setItem("routa.acp.selectedProvider", "codex");

    const { result } = renderHook(() => useAcp());

    await act(async () => {
      await result.current.connect();
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
      expect(result.current.selectedProvider).toBe("codex");
    });
  });

  it("falls back to the first available provider when the stored provider is unavailable", async () => {
    window.localStorage.setItem("routa.acp.selectedProvider", "claude");
    listProvidersMock.mockResolvedValue([
      { id: "claude", name: "Claude", command: "claude", description: "Claude provider", status: "unavailable", source: "static" },
      { id: "opencode", name: "OpenCode", command: "opencode", description: "OpenCode provider", status: "available", source: "static" },
      { id: "codex", name: "Codex", command: "codex-acp", description: "Codex provider", status: "unavailable", source: "static" },
    ]);

    const { result } = renderHook(() => useAcp());

    await act(async () => {
      await result.current.connect();
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
      expect(result.current.selectedProvider).toBe("opencode");
    });

    expect(window.localStorage.getItem("routa.acp.selectedProvider")).toBe("opencode");
  });

  it("ignores duplicate connect calls while the client is already connected", async () => {
    const { result } = renderHook(() => useAcp());

    await act(async () => {
      await result.current.connect();
      await result.current.connect();
    });

    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(onUpdateMock).toHaveBeenCalledTimes(1);
    expect(onConnectionIssueMock).toHaveBeenCalledTimes(1);
  });
});
