import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTaskChangesTab } from "../kanban-task-changes-tab";

const desktopAwareFetch = vi.fn();

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: (...args: unknown[]) => desktopAwareFetch(...args),
}));

describe("KanbanTaskChangesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  it("renders and triggers the PR specialist action for GitHub repositories", async () => {
    desktopAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        changes: {
          codebaseId: "codebase-1",
          repoPath: "/repo",
          label: "platform",
          branch: "feature/pr",
          status: { clean: true, ahead: 1, behind: 0, modified: 0, untracked: 0 },
          files: [{ path: "src/app.tsx", status: "modified" }],
          commits: [],
          source: "repo",
          remoteUrl: "git@github.com:acme/platform.git",
        },
      }),
    });

    const onRunPullRequest = vi.fn().mockResolvedValue("session-pr-1");
    const onSelectSession = vi.fn();

    render(
      <KanbanTaskChangesTab
        task={{
          id: "task-1",
          title: "Publish PR",
          status: "COMPLETED",
          comments: [],
          labels: [],
          dependencies: [],
          codebaseIds: ["codebase-1"],
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/repo",
          isDefault: true,
          sourceType: "github",
          sourceUrl: "https://github.com/acme/platform",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }]}
        taskId="task-1"
        workspaceId="workspace-1"
        onRefresh={vi.fn()}
        onRunPullRequest={onRunPullRequest}
        onSelectSession={onSelectSession}
      />
    );

    expect(await screen.findByText(/PR specialist/i)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open pr session/i }));

    await waitFor(() => {
      expect(onRunPullRequest).toHaveBeenCalledWith("task-1");
      expect(onSelectSession).toHaveBeenCalledWith("session-pr-1");
    });
  });

  it("keeps branch status visible even when the worktree is clean", async () => {
    desktopAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        changes: {
          codebaseId: "codebase-1",
          repoPath: "/repo",
          label: "platform",
          branch: "feature/clean-branch",
          status: { clean: true, ahead: 1, behind: 0, modified: 0, untracked: 0 },
          files: [],
          commits: [],
          source: "repo",
        },
      }),
    });

    render(
      <KanbanTaskChangesTab
        task={{
          id: "task-clean",
          title: "Show branch state",
          status: "IN_PROGRESS",
          comments: [],
          labels: [],
          dependencies: [],
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        codebases={[]}
        taskId="task-clean"
        workspaceId="workspace-1"
        onRefresh={vi.fn()}
      />
    );

    expect((await screen.findByTestId("kanban-task-change-branch")).textContent).toContain("@feature/clean-branch");
    expect(screen.getByTestId("kanban-task-change-ahead").textContent).toContain("1 ahead");
    expect(screen.getByTestId("kanban-task-change-summary").textContent).toContain("Clean");
    expect(screen.getByText("No local changes in this task worktree.")).toBeTruthy();
  });

  it("renders committed diff as a single scrollable list of expandable file sections", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks/task-commit/changes") {
        return {
          ok: true,
          json: async () => ({
            changes: {
              codebaseId: "codebase-1",
              repoPath: "/repo",
              label: "platform",
              branch: "feature/diff",
              status: { clean: true, ahead: 1, behind: 0, modified: 0, untracked: 0 },
              files: [],
              commits: [{
                sha: "abc1234567890",
                shortSha: "abc1234",
                summary: "Update editor",
                authorName: "Codex",
                authoredAt: "2026-04-08T00:00:00.000Z",
                additions: 2,
                deletions: 2,
              }],
              source: "repo",
            },
          }),
        } as Response;
      }
      if (url === "/api/tasks/task-commit/changes/commit?sha=abc1234567890&context=full") {
        return {
          ok: true,
          json: async () => ({
            diff: {
              sha: "abc1234567890",
              shortSha: "abc1234",
              summary: "Update editor",
              authorName: "Codex",
              authoredAt: "2026-04-08T00:00:00.000Z",
              additions: 2,
              deletions: 2,
              patch: [
                "diff --git a/package.json b/package.json",
                "index 1111111..2222222 100644",
                "--- a/package.json",
                "+++ b/package.json",
                "@@ -1,22 +1,22 @@",
                '   "context0": true,',
                '   "context1": true,',
                '   "context2": true,',
                '   "context3": true,',
                '   "context4": true,',
                '   "context5": true,',
                '   "context6": true,',
                '   "context7": true,',
                '   "context8": true,',
                '   "context9": true,',
                '   "context10": true,',
                '   "context11": true,',
                '   "context12": true,',
                '   "context13": true,',
                '   "context14": true,',
                '   "context15": true,',
                '   "context16": true,',
                '   "context17": true,',
                '   "context18": true,',
                '   "context19": true,',
                '-  "version": "1.0.0",',
                '+  "version": "1.1.0",',
                "diff --git a/src/editor.ts b/src/editor.ts",
                "index 3333333..4444444 100644",
                "--- a/src/editor.ts",
                "+++ b/src/editor.ts",
                "@@ -1 +1 @@",
                "-export const editor = 'old';",
                "+export const editor = 'new';",
              ].join("\n"),
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const { container } = render(
      <KanbanTaskChangesTab
        task={{
          id: "task-commit",
          title: "Review commits",
          status: "COMPLETED",
          comments: [],
          labels: [],
          dependencies: [],
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        codebases={[]}
        taskId="task-commit"
        workspaceId="workspace-1"
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByTestId("kanban-commit-row-abc1234567890"));

    const openPackageDiffShadowRoot = async () => {
      const fileSection = await screen.findByTestId("kanban-commit-file-section-package.json");
      const diffContainer = fileSection.querySelector("diffs-container");
      const shadowRoot = diffContainer?.shadowRoot;
      if (!shadowRoot) {
        throw new Error("package.json diff shadow root is not mounted");
      }
      return shadowRoot;
    };

    await waitFor(async () => {
      expect((await openPackageDiffShadowRoot()).textContent).toContain('"version": "1.1.0"');
    });
    expect(screen.getByTestId("kanban-commit-files-changed").textContent).toContain("2 Files Changed");
    expect(screen.getByTestId("kanban-commit-diff-scroll-area")).toBeTruthy();
    expect(screen.getByTestId("kanban-commit-file-section-package.json")).toBeTruthy();
    expect(screen.getByTestId("kanban-commit-file-section-src/editor.ts")).toBeTruthy();
    expect((await openPackageDiffShadowRoot()).textContent).not.toContain("context10");

    const hiddenLinesButton = (await openPackageDiffShadowRoot()).querySelector("[data-expand-button]");
    expect(hiddenLinesButton).toBeTruthy();
    expect((await openPackageDiffShadowRoot()).textContent).toContain("hidden lines");
    hiddenLinesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    await waitFor(async () => {
      expect((await openPackageDiffShadowRoot()).textContent).toContain("context10");
    });

    const packageSection = screen.getByTestId("kanban-commit-file-section-package.json");
    fireEvent.click(packageSection.querySelector("summary")!);
    expect((packageSection as HTMLDetailsElement).open).toBe(false);
    await waitFor(() => {
      expect(packageSection.querySelector("diffs-container")).toBeNull();
    });
    fireEvent.click(packageSection.querySelector("summary")!);
    await waitFor(async () => {
      expect((await openPackageDiffShadowRoot()).textContent).toContain('"version": "1.1.0"');
    });
    expect((await openPackageDiffShadowRoot()).textContent).not.toContain("context10");

    await waitFor(() => {
      const editorSection = container.querySelector("[data-testid='kanban-commit-file-section-src/editor.ts']");
      const editorDiffText = editorSection?.querySelector("diffs-container")?.shadowRoot?.textContent ?? "";
      expect(editorDiffText).toContain("export const editor = 'new';");
    });

    fireEvent.keyDown(screen.getByTestId("kanban-commit-files-changed"), { key: "f", metaKey: true });
    const searchInput = await screen.findByTestId("kanban-commit-diff-search-input");
    fireEvent.change(searchInput, { target: { value: "VERSION" } });
    await waitFor(() => {
      expect(screen.getByTestId("kanban-commit-diff-search-count").textContent).toMatch(/1\/\d+/);
    });
    fireEvent.click(screen.getByTestId("kanban-commit-diff-search-case"));
    await waitFor(() => {
      expect(screen.getByTestId("kanban-commit-diff-search-count").textContent).toBe("0/0");
    });
    fireEvent.click(screen.getByTestId("kanban-commit-diff-search-case"));
    fireEvent.click(screen.getByTestId("kanban-commit-diff-search-regex"));
    fireEvent.change(searchInput, { target: { value: "[" } });
    await waitFor(() => {
      expect(screen.getByTestId("kanban-commit-diff-search-count").textContent).toBe("!");
    });

    const editorSection = screen.getByTestId("kanban-commit-file-section-src/editor.ts");
    fireEvent.click(editorSection.querySelector("summary")!);
    expect((editorSection as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(screen.getByTestId("kanban-commit-row-abc1234567890"));
    expect(screen.queryByTestId("kanban-commit-files-changed")).toBeNull();
  });
});
