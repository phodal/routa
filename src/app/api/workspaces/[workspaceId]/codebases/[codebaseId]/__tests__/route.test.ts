import { beforeEach, describe, expect, it, vi } from "vitest";

const codebaseStore = {
  get: vi.fn(),
  remove: vi.fn(),
};

const worktreeStore = {};
const removeAllForCodebase = vi.fn();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({ codebaseStore, worktreeStore }),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: class {
    removeAllForCodebase = removeAllForCodebase;
  },
}));

import { NextRequest } from "next/server";
import { DELETE } from "../route";

describe("DELETE /api/workspaces/[workspaceId]/codebases/[codebaseId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codebaseStore.remove.mockResolvedValue(undefined);
    removeAllForCodebase.mockResolvedValue(undefined);
  });

  it("deletes a codebase when it belongs to the requested workspace", async () => {
    codebaseStore.get.mockResolvedValue({
      id: "cb-1",
      workspaceId: "ws-1",
    });

    const response = await DELETE(new NextRequest("http://localhost/api/workspaces/ws-1/codebases/cb-1"), {
      params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }),
    });

    expect(response.status).toBe(200);
    expect(removeAllForCodebase).toHaveBeenCalledWith("cb-1");
    expect(codebaseStore.remove).toHaveBeenCalledWith("cb-1");
  });

  it("returns 404 when the codebase belongs to another workspace", async () => {
    codebaseStore.get.mockResolvedValue({
      id: "cb-1",
      workspaceId: "ws-2",
    });

    const response = await DELETE(new NextRequest("http://localhost/api/workspaces/ws-1/codebases/cb-1"), {
      params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: "Codebase not found" });
    expect(removeAllForCodebase).not.toHaveBeenCalled();
    expect(codebaseStore.remove).not.toHaveBeenCalled();
  });
});