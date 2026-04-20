import { beforeEach, describe, expect, it, vi } from "vitest";

const codebaseStore = {
  listByWorkspace: vi.fn(),
};

const getRepoChanges = vi.fn();
const isGitRepository = vi.fn();
const isBareGitRepository = vi.fn();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({ codebaseStore }),
}));

vi.mock("@/core/git", () => ({
  getRepoChanges: (...args: unknown[]) => getRepoChanges(...args),
  isGitRepository: (...args: unknown[]) => isGitRepository(...args),
  isBareGitRepository: (...args: unknown[]) => isBareGitRepository(...args),
}));

import { GET } from "../route";

describe("GET /api/workspaces/[workspaceId]/codebases/changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codebaseStore.listByWorkspace.mockResolvedValue([
      {
        id: "codebase-1",
        workspaceId: "workspace-1",
        repoPath: "/repos/acme/platform",
        label: "platform",
        branch: "main",
      },
    ]);
    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(false);
    getRepoChanges.mockReturnValue({
      branch: "main",
      status: {
        clean: false,
        ahead: 1,
        behind: 0,
        modified: 2,
        untracked: 1,
      },
      files: [{ path: "src/app.ts", status: "modified", additions: 4, deletions: 1 }],
    });
  });

  it("returns repo changes for worktree-backed codebases", async () => {
    const response = await GET(new Request("http://localhost/api/workspaces/workspace-1/codebases/changes"), {
      params: Promise.resolve({ workspaceId: "workspace-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(isGitRepository).toHaveBeenCalledWith("/repos/acme/platform");
    expect(isBareGitRepository).toHaveBeenCalledWith("/repos/acme/platform");
    expect(getRepoChanges).toHaveBeenCalledWith("/repos/acme/platform");
    expect(data.repos[0]).toMatchObject({
      codebaseId: "codebase-1",
      branch: "main",
      status: {
        clean: false,
        modified: 2,
        untracked: 1,
      },
      files: [{ path: "src/app.ts", status: "modified" }],
    });
  });

  it("reports bare repos instead of pretending they are clean worktrees", async () => {
    isBareGitRepository.mockReturnValue(true);

    const response = await GET(new Request("http://localhost/api/workspaces/workspace-1/codebases/changes"), {
      params: Promise.resolve({ workspaceId: "workspace-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getRepoChanges).not.toHaveBeenCalled();
    expect(data.repos[0]).toMatchObject({
      codebaseId: "codebase-1",
      branch: "main",
      files: [],
      error: expect.stringContaining("bare git repository"),
    });
  });
});
