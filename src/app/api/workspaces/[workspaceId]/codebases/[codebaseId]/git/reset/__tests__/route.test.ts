import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  workspaceStore,
  codebaseStore,
  resetBranch,
  hasLocalBranch,
  getCurrentBranchName,
  checkoutExistingBranch,
  isGitRepository,
} = vi.hoisted(() => ({
  workspaceStore: {
    get: vi.fn(),
  },
  codebaseStore: {
    get: vi.fn(),
    update: vi.fn(),
  },
  resetBranch: vi.fn(),
  hasLocalBranch: vi.fn(),
  getCurrentBranchName: vi.fn(),
  checkoutExistingBranch: vi.fn(),
  isGitRepository: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({ workspaceStore, codebaseStore }),
}));

vi.mock("@/core/git", () => ({
  isGitRepository,
}));

vi.mock("@/core/git/git-operations", () => ({
  resetBranch,
  hasLocalBranch,
  getCurrentBranchName,
  checkoutExistingBranch,
}));

import { POST } from "../route";

describe("POST /api/workspaces/[workspaceId]/codebases/[codebaseId]/git/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceStore.get.mockResolvedValue({ id: "ws-1" });
    codebaseStore.get.mockResolvedValue({
      id: "cb-1",
      workspaceId: "ws-1",
      repoPath: "/tmp/repo",
      branch: "feature/test",
    });
    codebaseStore.update.mockResolvedValue(undefined);
    resetBranch.mockResolvedValue(undefined);
    hasLocalBranch.mockResolvedValue(true);
    getCurrentBranchName.mockResolvedValue("feature/test");
    checkoutExistingBranch.mockResolvedValue(undefined);
    isGitRepository.mockReturnValue(true);
  });

  it("soft resets to a target branch, checks it out, and syncs branch metadata", async () => {
    const request = new NextRequest("http://localhost/api/workspaces/ws-1/codebases/cb-1/git/reset", {
      method: "POST",
      body: JSON.stringify({ to: "main", mode: "soft", confirm: false }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, branch: "main" });
    expect(resetBranch).toHaveBeenCalledWith("/tmp/repo", "main", "soft");
    expect(hasLocalBranch).toHaveBeenCalledWith("/tmp/repo", "main");
    expect(getCurrentBranchName).toHaveBeenCalledWith("/tmp/repo");
    expect(checkoutExistingBranch).toHaveBeenCalledWith("/tmp/repo", "main");
    expect(codebaseStore.update).toHaveBeenCalledWith("cb-1", { branch: "main" });
  });

  it("does not checkout when target is not a local branch", async () => {
    hasLocalBranch.mockResolvedValue(false);

    const request = new NextRequest("http://localhost/api/workspaces/ws-1/codebases/cb-1/git/reset", {
      method: "POST",
      body: JSON.stringify({ to: "abc1234", mode: "soft", confirm: false }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(checkoutExistingBranch).not.toHaveBeenCalled();
    expect(codebaseStore.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the codebase belongs to another workspace", async () => {
    codebaseStore.get.mockResolvedValue({
      id: "cb-1",
      workspaceId: "ws-2",
      repoPath: "/tmp/repo",
    });

    const request = new NextRequest("http://localhost/api/workspaces/ws-1/codebases/cb-1/git/reset", {
      method: "POST",
      body: JSON.stringify({ to: "main", mode: "soft", confirm: false }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Codebase not found" });
    expect(resetBranch).not.toHaveBeenCalled();
  });
});
