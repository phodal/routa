import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHarnessSettingsData } from "../use-harness-settings-data";

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useHarnessSettingsData", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.startsWith("/api/fitness/specs?")) {
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          fitnessDir: "/repo/docs/fitness",
          files: [],
        });
      }

      if (url.startsWith("/api/fitness/plan?")) {
        return okJson({
          metricCount: 31,
          hardGateCount: 13,
          dimensions: [],
        });
      }

      if (url.startsWith("/api/harness/hooks?")) {
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          hooksDir: "/repo/.husky",
          configFile: null,
          reviewTriggerFile: null,
          releaseTriggerFile: null,
          hookFiles: [],
          profiles: [],
          warnings: [],
        });
      }

      if (url.startsWith("/api/harness/instructions?")) {
        const includeAudit = new URL(`http://localhost${url}`).searchParams.get("includeAudit");
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          fileName: "AGENTS.md",
          relativePath: "AGENTS.md",
          source: "# AGENTS",
          fallbackUsed: true,
          audit: includeAudit === "1"
            ? {
              status: "heuristic",
              provider: "codex",
              generatedAt: "2026-03-31T00:00:01.000Z",
              durationMs: 200,
              totalScore: 12,
              overall: "有条件通过",
              oneSentence: "heuristic",
              principles: {
                routing: 3,
                protection: 3,
                reflection: 3,
                verification: 3,
              },
            }
            : null,
        });
      }

      if (url.startsWith("/api/harness/github-actions?")) {
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          workflowsDir: "/repo/.github/workflows",
          flows: [],
          warnings: [],
        });
      }

      if (url.startsWith("/api/harness/agent-hooks?")) {
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          configFile: null,
          hooks: [],
          warnings: [],
        });
      }

      if (url.startsWith("/api/harness/spec-sources?")) {
        return okJson({
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          sources: [],
          warnings: [],
        });
      }

      throw new Error(`Unhandled fetch url: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-runs instructions with audit enabled without reloading hook runtime", async () => {
    const { result } = renderHook(() => useHarnessSettingsData({
      workspaceId: "default",
      repoPath: "/repo",
      selectedTier: "normal",
    }));

    await waitFor(() => {
      expect(result.current.instructionsState.loading).toBe(false);
      expect(result.current.instructionsState.data?.audit).toBeNull();
    });

    const initialHookCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/harness/hooks?")).length;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/harness/instructions?") && String(url).includes("includeAudit=0"))).toBe(true);

    act(() => {
      result.current.reloadInstructions();
    });

    await waitFor(() => {
      expect(result.current.instructionsState.data?.audit?.status).toBe("heuristic");
    });

    const hookCallsAfterRerun = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/harness/hooks?")).length;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/harness/instructions?") && String(url).includes("includeAudit=1"))).toBe(true);
    expect(hookCallsAfterRerun).toBe(initialHookCalls);
  });
});
