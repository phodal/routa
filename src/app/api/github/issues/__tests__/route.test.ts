import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGitHubIssues = vi.fn();
const resolveGitHubRepo = vi.fn();

const codebaseStore = {
  listByWorkspace: vi.fn(),
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({ codebaseStore }),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  listGitHubIssues: (repo: string, options?: unknown) => listGitHubIssues(repo, options),
  resolveGitHubRepo: (sourceUrl?: string, repoPath?: string) => resolveGitHubRepo(sourceUrl, repoPath),
}));

import { GET } from "../route";

describe("GET /api/github/issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codebaseStore.listByWorkspace.mockResolvedValue([
      {
        id: "codebase-1",
        workspaceId: "workspace-1",
        repoPath: "/repos/acme/platform",
        label: "platform",
        isDefault: true,
        sourceUrl: "https://github.com/acme/platform",
      },
    ]);
    resolveGitHubRepo.mockReturnValue("acme/platform");
    listGitHubIssues.mockResolvedValue([
      {
        id: "1001",
        number: 12,
        title: "Imported bug",
        url: "https://github.com/acme/platform/issues/12",
        state: "open",
        labels: ["bug"],
        assignees: ["phodal"],
      },
    ]);
  });

  it("requires workspaceId", async () => {
    const response = await GET(new NextRequest("http://localhost/api/github/issues"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "workspaceId is required" });
  });

  it("lists issues for the selected workspace codebase", async () => {
    const response = await GET(new NextRequest("http://localhost/api/github/issues?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(codebaseStore.listByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(resolveGitHubRepo).toHaveBeenCalledWith("https://github.com/acme/platform", "/repos/acme/platform");
    expect(listGitHubIssues).toHaveBeenCalledWith("acme/platform", { state: "open" });
    expect(data).toMatchObject({
      repo: "acme/platform",
      codebase: {
        id: "codebase-1",
        label: "platform",
      },
      issues: [
        {
          number: 12,
          title: "Imported bug",
        },
      ],
    });
  });

  it("rejects non-GitHub codebases", async () => {
    resolveGitHubRepo.mockReturnValue(undefined);

    const response = await GET(new NextRequest("http://localhost/api/github/issues?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("not linked to a GitHub repository");
    expect(listGitHubIssues).not.toHaveBeenCalled();
  });
});
