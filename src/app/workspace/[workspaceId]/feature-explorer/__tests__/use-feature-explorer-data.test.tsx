import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

import { useFeatureExplorerData } from "../use-feature-explorer-data";

type HookProps = {
  workspaceId: string;
  repoPath?: string;
  refreshKey?: string;
};

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useFeatureExplorerData", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/feature-explorer/feature-a?")) {
        return okJson({
          id: "feature-a",
          name: "Feature A",
          group: "execution",
          summary: "Summary",
          status: "active",
          pages: [],
          apis: [],
          sourceFiles: ["src/app/page.tsx"],
          relatedFeatures: [],
          domainObjects: [],
          sessionCount: 0,
          changedFiles: 1,
          updatedAt: "-",
          fileTree: [],
          fileStats: {},
        });
      }

      if (url.startsWith("/feature-explorer?")) {
        return okJson({
          capabilityGroups: [{ id: "execution", name: "Execution", description: "" }],
          features: [
            {
              id: "feature-a",
              name: "Feature A",
              group: "execution",
              summary: "Summary",
              status: "active",
              sessionCount: 0,
              changedFiles: 1,
              updatedAt: "-",
              sourceFileCount: 1,
              pageCount: 0,
              apiCount: 0,
            },
          ],
        });
      }

      if (url.startsWith("/spec/surface-index?")) {
        return okJson({
          generatedAt: "2026-04-17T00:00:00.000Z",
          pages: [
            {
              route: "/workspace/:workspaceId/feature-explorer",
              title: "Feature Explorer",
              description: "Explore feature surfaces.",
              sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
            },
          ],
          apis: [],
          contractApis: [],
          nextjsApis: [],
          rustApis: [],
          metadata: {
            schemaVersion: 1,
            capabilityGroups: [],
            features: [
              {
                id: "feature-a",
                name: "Feature A",
                pages: ["/workspace/:workspaceId/feature-explorer"],
              },
            ],
          },
          repoRoot: "/tmp/local-project",
          warnings: [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("adds repoPath to feature explorer requests when a local repo override is selected", async () => {
    const { result, rerender } = renderHook<ReturnType<typeof useFeatureExplorerData>, HookProps>(
      (props: HookProps) => useFeatureExplorerData(props),
      {
        initialProps: {
          workspaceId: "default",
          repoPath: undefined,
          refreshKey: undefined,
        } satisfies HookProps,
      },
    );

    await waitFor(() => {
      expect(result.current.initialFeatureId).toBe("feature-a");
    });

    expect(desktopAwareFetch).toHaveBeenCalledWith("/feature-explorer?workspaceId=default");
    expect(desktopAwareFetch).toHaveBeenCalledWith("/spec/surface-index?workspaceId=default");
    expect(desktopAwareFetch).toHaveBeenCalledWith("/feature-explorer/feature-a?workspaceId=default");

    rerender({
      workspaceId: "default",
      repoPath: "/tmp/local-project",
      refreshKey: "/tmp/local-project:main",
    });

    await waitFor(() => {
      expect(desktopAwareFetch).toHaveBeenCalledWith(
        "/feature-explorer?workspaceId=default&repoPath=%2Ftmp%2Flocal-project",
      );
    });

    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/spec/surface-index?workspaceId=default&repoPath=%2Ftmp%2Flocal-project",
    );
    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/feature-explorer/feature-a?workspaceId=default&repoPath=%2Ftmp%2Flocal-project",
    );
  });

  it("keeps the page usable when no generated feature tree exists", async () => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/feature-explorer?")) {
        return okJson({
          capabilityGroups: [],
          features: [],
        });
      }

      if (url.startsWith("/spec/surface-index?")) {
        return okJson({
          generatedAt: "",
          pages: [],
          apis: [],
          contractApis: [],
          nextjsApis: [],
          rustApis: [],
          implementationApis: [],
          metadata: null,
          repoRoot: "/tmp/local-project",
          warnings: ["FEATURE_TREE.md not found; generate the feature tree to populate features."],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { result } = renderHook<ReturnType<typeof useFeatureExplorerData>, HookProps>(
      (props: HookProps) => useFeatureExplorerData(props),
      {
        initialProps: {
          workspaceId: "default",
        } satisfies HookProps,
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.features).toEqual([]);
    expect(result.current.initialFeatureId).toBe("");
    expect(result.current.surfaceIndex.warnings[0]).toContain("FEATURE_TREE.md");
    expect(desktopAwareFetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/feature-explorer\/[^?]+\?/),
    );
  });
});
