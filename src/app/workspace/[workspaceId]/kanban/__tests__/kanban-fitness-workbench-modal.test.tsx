/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanFitnessWorkbenchModal } from "../kanban-fitness-workbench-modal";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { RuntimeFitnessStatusResponse } from "@/core/fitness/runtime-status-types";

const { desktopAwareFetch, createSession, promptSession, connect } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  createSession: vi.fn(async () => null),
  promptSession: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    sessionId: null,
    updates: [],
    providers: [{ id: "opencode", status: "available" }],
    selectedProvider: "opencode",
    loading: false,
    error: null,
    authError: null,
    dockerConfigError: null,
    connect,
    createSession,
    resumeSession: vi.fn(async () => null),
    forkSession: vi.fn(async () => null),
    selectSession: vi.fn(),
    setProvider: vi.fn(),
    setMode: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
    promptSession,
    respondToUserInput: vi.fn(async () => {}),
    respondToUserInputForSession: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    disconnect: vi.fn(),
    clearAuthError: vi.fn(),
    clearDockerConfigError: vi.fn(),
    listProviderModels: vi.fn(async () => []),
    writeTerminal: vi.fn(async () => {}),
    resizeTerminal: vi.fn(async () => {}),
  }),
}));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createCodebase(): CodebaseData {
  return {
    id: "codebase-1",
    workspaceId: "workspace-1",
    repoPath: "/tmp/repo",
    branch: "main",
    label: "routa-js",
    isDefault: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function createRuntimeFitness(): RuntimeFitnessStatusResponse {
  return {
    generatedAt: "2025-01-01T00:00:00.000Z",
    repoRoot: "/tmp/repo",
    hasRunning: false,
    latest: {
      mode: "fast",
      currentStatus: "failed",
      currentObservedAt: "2025-01-01T00:00:00.000Z",
      finalScore: 71,
      hardGateBlocked: true,
      scoreBlocked: false,
      durationMs: 1234,
      dimensionCount: 0,
      metricCount: 0,
      artifactPath: null,
      lastCompleted: {
        status: "failed",
        observedAt: "2025-01-01T00:00:00.000Z",
        finalScore: 71,
        hardGateBlocked: true,
        scoreBlocked: false,
        durationMs: 1234,
        dimensionCount: 0,
        metricCount: 0,
        artifactPath: null,
      },
    },
    modes: [
      {
        mode: "fast",
        currentStatus: "failed",
        currentObservedAt: "2025-01-01T00:00:00.000Z",
        finalScore: 71,
        hardGateBlocked: true,
        scoreBlocked: false,
        durationMs: 1234,
        dimensionCount: 0,
        metricCount: 0,
        artifactPath: null,
        lastCompleted: {
          status: "failed",
          observedAt: "2025-01-01T00:00:00.000Z",
          finalScore: 71,
          hardGateBlocked: true,
          scoreBlocked: false,
          durationMs: 1234,
          dimensionCount: 0,
          metricCount: 0,
          artifactPath: null,
        },
      },
    ],
  };
}

describe("KanbanFitnessWorkbenchModal", () => {
  beforeEach(() => {
    resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
    createSession.mockReset();
    promptSession.mockReset();
    connect.mockReset();
    createSession.mockImplementation(async () => null);
    promptSession.mockImplementation(async () => {});
    connect.mockImplementation(async () => {});

    desktopAwareFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/fitness/specs")) {
        return Promise.resolve(jsonResponse({ files: [] }));
      }
      if (url.includes("/api/fitness/plan")) {
        return Promise.resolve(jsonResponse({
          tier: "normal",
          scope: "local",
          dimensionCount: 0,
          metricCount: 0,
          hardGateCount: 0,
          dimensions: [],
        }));
      }
      if (url.includes("/api/fitness/runtime")) {
        return Promise.resolve(jsonResponse(createRuntimeFitness()));
      }
      if (url.includes("/api/fitness/run")) {
        return new Promise<Response>(() => {});
      }
      if (url.includes("/api/sessions/")) {
        return Promise.resolve(jsonResponse({ history: [] }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not restart the entrix context load when parent props rerender with equivalent values", async () => {
    const onSessionIdChange = vi.fn();
    const { rerender } = render(
      <KanbanFitnessWorkbenchModal
        open
        workspaceId="workspace-1"
        codebase={createCodebase()}
        runtimeFitness={createRuntimeFitness()}
        sessionId={null}
        onSessionIdChange={onSessionIdChange}
        onClose={vi.fn()}
      />,
    );

    let initialEntrixCallCount = 0;
    await waitFor(() => {
      initialEntrixCallCount = desktopAwareFetch.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.includes("/api/fitness/run");
      }).length;
      expect(initialEntrixCallCount).toBeGreaterThan(0);
    });

    rerender(
      <KanbanFitnessWorkbenchModal
        open
        workspaceId="workspace-1"
        codebase={createCodebase()}
        runtimeFitness={createRuntimeFitness()}
        sessionId={null}
        onSessionIdChange={onSessionIdChange}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      const entrixCalls = desktopAwareFetch.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.includes("/api/fitness/run");
      });
      expect(entrixCalls).toHaveLength(initialEntrixCallCount);
    });
  });
});
