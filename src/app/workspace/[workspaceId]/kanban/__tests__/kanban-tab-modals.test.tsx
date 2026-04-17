import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { TaskInfo, WorktreeInfo } from "../../types";
import { KanbanCodebaseModal } from "../kanban-tab-modals";

const codebase: CodebaseData = {
  id: "codebase-1",
  workspaceId: "workspace-1",
  repoPath: "/tmp/repos/demo",
  branch: "main",
  label: "demo",
  isDefault: true,
  sourceType: "github",
  sourceUrl: "https://github.com/acme/demo",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const secondCodebase: CodebaseData = {
  id: "codebase-2",
  workspaceId: "workspace-1",
  repoPath: "/tmp/repos/design-system",
  branch: "develop",
  label: "design-system",
  isDefault: false,
  sourceType: "local",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: "board-1",
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createWorktree(id: string, branch: string, createdAt: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id,
    codebaseId: "codebase-1",
    workspaceId: "workspace-1",
    worktreePath: `/tmp/worktrees/${branch}`,
    branch,
    baseBranch: "main",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("KanbanCodebaseModal", () => {
  it("renders worktree timestamps and supports bulk delete selection", () => {
    const handleDeleteCodebaseWorktrees = vi.fn();

    render(
      <KanbanCodebaseModal
        open
        selectedCodebase={codebase}
        editingCodebase={false}
        codebases={[codebase]}
        addRepoSelection={null}
        setAddRepoSelection={vi.fn()}
        addSaving={false}
        addError={null}
        onAddRepository={vi.fn()}
        editRepoSelection={null}
        onRepoSelectionChange={vi.fn()}
        editError={null}
        recloneError={null}
        editSaving={false}
        replacingAll={false}
        setShowReplaceAllConfirm={vi.fn()}
        handleCancelEditCodebase={vi.fn()}
        codebaseWorktrees={[
          createWorktree("wt-older", "feature/older", "2025-01-01T00:00:00.000Z"),
          createWorktree("wt-newer", "feature/newer", "2025-01-02T00:00:00.000Z", { label: "newer-label" }),
        ]}
        worktreeActionError={null}
        localTasks={[createTask("task-1", "Story One", { worktreeId: "wt-newer" })]}
        handleDeleteCodebaseWorktrees={handleDeleteCodebaseWorktrees}
        deletingWorktreeIds={[]}
        liveBranchInfo={null}
        branchActionError={null}
        repoHealth={{ missingRepoTasks: 0, cwdMismatchTasks: 0 }}
        onSelectCodebase={vi.fn()}
        handleDeleteIssueBranch={vi.fn()}
        handleDeleteIssueBranches={vi.fn()}
        deletingBranchNames={[]}
        handleReclone={vi.fn()}
        recloning={false}
        recloneSuccess={null}
        onStartEditCodebase={vi.fn()}
        onRequestRemoveCodebase={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const createdTimes = screen.getAllByText(/Created|创建于/);
    expect(createdTimes.length).toBe(2);
    expect(screen.getByText(/newer-label/)).toBeTruthy();

    const timeElements = screen.getAllByText((_, element) => element?.tagName.toLowerCase() === "time");
    expect(timeElements.some((element) => element.getAttribute("datetime") === "2025-01-02T00:00:00.000Z")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Select All|全选/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remove selected|批量移除/ }));

    expect(handleDeleteCodebaseWorktrees).toHaveBeenCalledTimes(1);
    expect(handleDeleteCodebaseWorktrees.mock.calls[0][0]).toHaveLength(2);
    expect(handleDeleteCodebaseWorktrees.mock.calls[0][0].map((item: WorktreeInfo) => item.id)).toEqual([
      "wt-newer",
      "wt-older",
    ]);
  });

  it("renders repo branches and highlights issue branches with worktrees", () => {
    const handleDeleteIssueBranch = vi.fn();
    const handleDeleteIssueBranches = vi.fn();

    render(
      <KanbanCodebaseModal
        open
        selectedCodebase={codebase}
        editingCodebase={false}
        codebases={[codebase]}
        addRepoSelection={null}
        setAddRepoSelection={vi.fn()}
        addSaving={false}
        addError={null}
        onAddRepository={vi.fn()}
        editRepoSelection={null}
        onRepoSelectionChange={vi.fn()}
        editError={null}
        recloneError={null}
        editSaving={false}
        replacingAll={false}
        setShowReplaceAllConfirm={vi.fn()}
        handleCancelEditCodebase={vi.fn()}
        codebaseWorktrees={[
          createWorktree("wt-1", "issue/bf7f4dea", "2025-01-01T00:00:00.000Z"),
        ]}
        worktreeActionError={null}
        localTasks={[]}
        handleDeleteCodebaseWorktrees={vi.fn()}
        deletingWorktreeIds={[]}
        liveBranchInfo={{
          current: "main",
          branches: ["main", "issue/bf7f4dea", "issue/3487c6ee-js-hello-world", "feature/polish"],
        }}
        branchActionError={null}
        repoHealth={{ missingRepoTasks: 0, cwdMismatchTasks: 0 }}
        onSelectCodebase={vi.fn()}
        handleDeleteIssueBranch={handleDeleteIssueBranch}
        handleDeleteIssueBranches={handleDeleteIssueBranches}
        deletingBranchNames={[]}
        handleReclone={vi.fn()}
        recloning={false}
        recloneSuccess={null}
        onStartEditCodebase={vi.fn()}
        onRequestRemoveCodebase={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Branches|分支列表/)).toBeTruthy();
    expect(screen.getByText(/Issue branches \(2\)|Issue 分支（2）/)).toBeTruthy();
    expect(screen.getAllByText("issue/bf7f4dea").length).toBeGreaterThan(0);
    expect(screen.getByText("issue/3487c6ee-js-hello-world")).toBeTruthy();
    expect(screen.getByText("feature/polish")).toBeTruthy();
    expect(screen.getAllByText(/current|当前/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/worktree|工作树/).length).toBeGreaterThan(0);

    const branchDeleteButtons = screen.getAllByRole("button", { name: /Remove branch|删除分支/ });
    expect(branchDeleteButtons).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Clear issue/i })).toBeTruthy();

    fireEvent.click(branchDeleteButtons[0]!);
    expect(handleDeleteIssueBranch).toHaveBeenCalledWith("issue/3487c6ee-js-hello-world");

    fireEvent.click(screen.getByRole("button", { name: /Clear issue|清理 issue/ }));
    expect(handleDeleteIssueBranches).toHaveBeenCalledWith(["issue/3487c6ee-js-hello-world"]);
  });

  it("renders a repository rail for multiple codebases and allows switching", () => {
    const onSelectCodebase = vi.fn();

    render(
      <KanbanCodebaseModal
        open
        selectedCodebase={codebase}
        editingCodebase={false}
        codebases={[codebase, secondCodebase]}
        addRepoSelection={null}
        setAddRepoSelection={vi.fn()}
        addSaving={false}
        addError={null}
        onAddRepository={vi.fn()}
        editRepoSelection={null}
        onRepoSelectionChange={vi.fn()}
        editError={null}
        recloneError={null}
        editSaving={false}
        replacingAll={false}
        setShowReplaceAllConfirm={vi.fn()}
        handleCancelEditCodebase={vi.fn()}
        codebaseWorktrees={[]}
        worktreeActionError={null}
        localTasks={[]}
        handleDeleteCodebaseWorktrees={vi.fn()}
        deletingWorktreeIds={[]}
        liveBranchInfo={null}
        branchActionError={null}
        repoHealth={{ missingRepoTasks: 2, cwdMismatchTasks: 1 }}
        onSelectCodebase={onSelectCodebase}
        handleDeleteIssueBranch={vi.fn()}
        handleDeleteIssueBranches={vi.fn()}
        deletingBranchNames={[]}
        handleReclone={vi.fn()}
        recloning={false}
        recloneSuccess={null}
        onStartEditCodebase={vi.fn()}
        onRequestRemoveCodebase={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Repository Control Center|仓库控制中心/)).toBeTruthy();
    expect(screen.getByText(/Current repository demo|当前仓库 demo/)).toBeTruthy();
    expect(screen.getAllByText("design-system").length).toBeGreaterThan(0);
    expect(screen.getByText(/Health issues 3|健康问题 3/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /design-system/ }));
    expect(onSelectCodebase).toHaveBeenCalledWith(secondCodebase);
  });
});
