import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  parseContext: vi.fn(),
  resolveRepoRoot: vi.fn(),
  isContextError: vi.fn(),
}));

const retrospectiveMemoryMocks = vi.hoisted(() => ({
  loadMatchingFeatureRetrospectiveMemories: vi.fn(),
}));

vi.mock("../../shared", () => sharedMocks);
vi.mock("@/core/harness/retrospective-memory", () => retrospectiveMemoryMocks);

import { GET } from "../route";

describe("/api/feature-explorer/retrospectives GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMocks.parseContext.mockReturnValue({
      workspaceId: "default",
      repoPath: "/repo/default",
    });
    sharedMocks.resolveRepoRoot.mockResolvedValue("/repo/default");
    sharedMocks.isContextError.mockReturnValue(false);
  });

  it("returns matched retrospective memories for the selected features and files", async () => {
    retrospectiveMemoryMocks.loadMatchingFeatureRetrospectiveMemories.mockReturnValue({
      storageRoot: "/tmp/routa-retrospectives",
      matchedMemories: [
        {
          scope: "feature",
          targetId: "feature-explorer",
          updatedAt: "2026-04-22T01:00:00.000Z",
          summary: "Start with the target file and keep the task read-only.",
          featureId: "feature-explorer",
          featureName: "Feature Explorer",
        },
      ],
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/feature-explorer/retrospectives?workspaceId=default&repoPath=%2Frepo%2Fdefault&featureId=feature-explorer&featureId=workspace-overview&filePath=src%2Fapp%2Fpage.tsx&filePath=src%2Fapp%2Flayout.tsx",
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sharedMocks.parseContext).toHaveBeenCalled();
    expect(sharedMocks.resolveRepoRoot).toHaveBeenCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
    });
    expect(retrospectiveMemoryMocks.loadMatchingFeatureRetrospectiveMemories).toHaveBeenCalledWith(
      "/repo/default",
      {
        featureIds: ["feature-explorer", "workspace-overview"],
        filePaths: ["src/app/page.tsx", "src/app/layout.tsx"],
      },
    );
    expect(data).toEqual({
      storageRoot: "/tmp/routa-retrospectives",
      matchedMemories: [
        {
          scope: "feature",
          targetId: "feature-explorer",
          updatedAt: "2026-04-22T01:00:00.000Z",
          summary: "Start with the target file and keep the task read-only.",
          featureId: "feature-explorer",
          featureName: "Feature Explorer",
        },
      ],
    });
  });

  it("returns a context error as a 400", async () => {
    sharedMocks.parseContext.mockImplementation(() => {
      throw new Error("workspaceId is required");
    });
    sharedMocks.isContextError.mockImplementation((message: string) => message === "workspaceId is required");

    const response = await GET(new NextRequest("http://localhost/api/feature-explorer/retrospectives"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(retrospectiveMemoryMocks.loadMatchingFeatureRetrospectiveMemories).not.toHaveBeenCalled();
    expect(data).toEqual({ error: "workspaceId is required" });
  });
});
