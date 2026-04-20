import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileRow } from "../kanban-file-changes-panel";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo } from "../../types";

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [{ id: "backlog", name: "Backlog", position: 0, stage: "backlog" }],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("KanbanTab file changes panel", () => {
  it("uses a dedicated file-name column so status badges do not clip the first character", () => {
    const { container } = render(
      <FileRow file={{ path: "package-lock.json", status: "modified", additions: 12, deletions: 3 }} />,
    );

    expect(screen.getByText("package-lock.json")).toBeTruthy();
    expect(screen.getByTitle("package-lock.json")).toBeTruthy();
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("grid-cols-[16px_minmax(0,1fr)_auto]");
  });

  it("splits nested paths into filename and directory rows for readability", () => {
    render(
      <FileRow file={{ path: "src/client/components/__tests__/tiptap-input.test.tsx", status: "untracked", additions: 8, deletions: 0 }} />,
    );

    expect(screen.getByText("tiptap-input.test.tsx")).toBeTruthy();
    expect(screen.getByTitle("src/client/components/__tests__")).toBeTruthy();
    expect(screen.getByText("+8")).toBeTruthy();
    expect(screen.getByText("-0")).toBeTruthy();
  });

  it("shows renamed source metadata as a secondary row", () => {
    render(
      <FileRow
        file={{
          path: "src/app/workspace/[workspaceId]/kanban/kanban-file-changes-panel.tsx",
          previousPath: "src/app/workspace/[workspaceId]/kanban/file-drawer.tsx",
          status: "renamed",
        }}
      />,
    );

    expect(screen.getByText("kanban-file-changes-panel.tsx")).toBeTruthy();
    expect(screen.getByText("file-drawer.tsx")).toBeTruthy();
    expect(screen.getAllByTitle("src/app/workspace/[workspaceId]/kanban").length).toBeGreaterThanOrEqual(1);
  });

  it("renders repo sync progress inline with the repos section", () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo",
          branch: "main",
          label: "routa-js",
          isDefault: true,
          sourceType: "github",
          sourceUrl: "https://github.com/example/routa-js",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        onRefresh={vi.fn()}
        repoSync={{
          status: "done",
          total: 1,
          completed: 1,
          currentRepoLabel: null,
          message: "Repository sync complete. 1 repo updated.",
          error: null,
        }}
      />,
    );

    const syncIndicator = screen.getByTestId("kanban-repo-sync-progress");
    expect(syncIndicator.textContent).toContain("1 repo updated");
  });

  it("opens the file changes drawer from the repo toolbar and allows collapsing it", () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo",
          branch: "main",
          label: "routa-js",
          isDefault: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        repoChanges={[{
          codebaseId: "codebase-1",
          repoPath: "/tmp/repo",
          label: "routa-js",
          branch: "main",
          status: { clean: false, ahead: 1, behind: 0, modified: 1, untracked: 1 },
          files: [
            { path: "src/app.tsx", status: "modified" },
            { path: "README.md", status: "untracked" },
          ],
        }]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("kanban-file-changes-open"));

    expect(screen.getByTestId("kanban-file-changes-panel")).toBeTruthy();
    expect(screen.getByText("File Changes")).toBeTruthy();
    expect(screen.getByText("app.tsx")).toBeTruthy();
    expect(screen.getByTitle("src")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.getByTestId("kanban-file-changes-open")).toBeTruthy();
  });
});
