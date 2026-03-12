import { test, expect } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const PRIMARY_REPO_PATH = process.env.ROUTA_E2E_REPO_PATH || process.cwd();

async function fillIssueObjective(page: import("@playwright/test").Page, text: string) {
  const editor = page.locator(".ProseMirror").last();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
}

test.use({
  baseURL: BASE_URL,
  video: "on",
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
});

test.describe("Kanban workspace repository association", () => {
  test.setTimeout(180_000);

  test("covers workspace repos, issue repo links, worktree lifecycle, and workspace root isolation", async ({
    page,
    request,
  }) => {
    const testId = Date.now().toString();
    const title = `Kanban Repo Flow ${testId}`;
    const worktreeRoot = `/tmp/routa-kanban-${testId}`;

    const workspaceResponse = await request.post("/api/workspaces", {
      data: { title: `Kanban Repo Workspace ${testId}` },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspaceData = await workspaceResponse.json();
    const workspaceId = workspaceData.workspace.id as string;

    const patchWorkspaceResponse = await request.patch(`/api/workspaces/${workspaceId}`, {
      data: { metadata: { worktreeRoot } },
    });
    expect(patchWorkspaceResponse.ok()).toBeTruthy();

    const primaryCodebaseResponse = await request.post(`/api/workspaces/${workspaceId}/codebases`, {
      data: {
        repoPath: PRIMARY_REPO_PATH,
        branch: "main",
        label: "routa-main",
      },
    });
    expect(primaryCodebaseResponse.ok()).toBeTruthy();
    const primaryCodebase = (await primaryCodebaseResponse.json()).codebase as { id: string };

    const secondaryCodebaseResponse = await request.post(`/api/workspaces/${workspaceId}/codebases`, {
      data: {
        repoPath: `/tmp/routa-secondary-${testId}`,
        branch: "main",
        label: "secondary-context",
      },
    });
    expect(secondaryCodebaseResponse.ok()).toBeTruthy();
    const secondaryCodebase = (await secondaryCodebaseResponse.json()).codebase as { id: string };

    const boardResponse = await request.get(`/api/kanban/boards?workspaceId=${workspaceId}`);
    expect(boardResponse.ok()).toBeTruthy();

    await page.goto(`/workspace/${workspaceId}`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: "Settings" }).click();
    const worktreeRootInput = page.getByTestId("worktree-root-input");
    await expect(worktreeRootInput).toBeVisible();
    await expect(worktreeRootInput).toHaveValue(worktreeRoot);
    await page.screenshot({ path: "test-results/kanban-workspace-root-settings.png", fullPage: true });

    await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });

    const codebaseBadges = page.getByTestId("codebase-badge");
    await expect(codebaseBadges).toHaveCount(2);
    await expect(codebaseBadges.first()).toContainText("routa-main");

    await codebaseBadges.first().click();
    const codebaseModal = page.getByTestId("codebase-detail-modal");
    await expect(codebaseModal).toBeVisible();
    await expect(codebaseModal).toContainText(PRIMARY_REPO_PATH);
    await page.screenshot({ path: "test-results/kanban-codebase-detail.png" });
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Create issue|Manual/ }).click();
    await expect(page.getByTestId("repo-selector")).toBeVisible();
    await page.getByPlaceholder("Issue title").fill(title);
    await fillIssueObjective(page, "Validate kanban repository association workflow");
    await page.screenshot({ path: "test-results/kanban-create-issue-modal.png" });
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const card = page.getByTestId("kanban-card").filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("repo-badge").first()).toContainText("routa-main");
    await page.screenshot({ path: "test-results/kanban-card-with-repo-badge.png" });

    await card.getByRole("button", { name: "View detail" }).click();
    await page.getByRole("button", { name: "▼" }).click();
    await expect(page.getByTestId("detail-repo-toggle")).toHaveCount(2);
    await page.getByTestId("detail-repo-toggle").filter({ hasText: "secondary-context" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/kanban-detail-repo-edit.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);

    const taskResponse = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
    expect(taskResponse.ok()).toBeTruthy();
    const tasksData = await taskResponse.json();
    const createdTask = (tasksData.tasks as Array<{ id: string; title: string; codebaseIds?: string[]; worktreeId?: string }>).find(
      (task) => task.title === title
    );

    expect(createdTask).toBeTruthy();
    const repoLinkResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
      data: { codebaseIds: [primaryCodebase.id, secondaryCodebase.id] },
    });
    expect(repoLinkResponse.ok()).toBeTruthy();

    const triggerResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
      data: {
        assignedProvider: "opencode",
        assignedRole: "DEVELOPER",
        columnId: "dev",
        position: 0,
      },
    });
    expect(triggerResponse.ok()).toBeTruthy();

    let worktreeId: string | null = null;
    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
          if (!response.ok()) return null;
          const data = await response.json();
          const task = (data.tasks as Array<{
            title: string;
            worktreeId?: string;
          }>).find((item) => item.title === title);
          worktreeId = task?.worktreeId ?? null;
          return worktreeId;
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .not.toBeNull();

    const worktreeResponse = await request.get(`/api/worktrees/${worktreeId!}`);
    expect(worktreeResponse.ok()).toBeTruthy();
    const worktreeData = await worktreeResponse.json();
    expect(worktreeData.worktree.worktreePath).toContain(worktreeRoot);
    expect(worktreeData.worktree.worktreePath).toContain("routa-main");

    await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });
    const movedCard = page.getByTestId("kanban-card").filter({ hasText: title }).first();
    await expect(movedCard.getByTestId("worktree-badge")).toBeVisible({ timeout: 20_000 });
    await movedCard.getByRole("button", { name: "View detail" }).click();
    await page.getByRole("button", { name: "▼" }).click();
    const worktreeDetail = page.getByTestId("worktree-detail");
    await expect(worktreeDetail).toBeVisible();
    await expect(worktreeDetail).toContainText(worktreeRoot);
    await page.screenshot({ path: "test-results/kanban-worktree-detail.png" });
    await page.keyboard.press("Escape");

    const deleteWorktreeResponse = await request.delete(`/api/worktrees/${worktreeId!}`);
    expect(deleteWorktreeResponse.ok()).toBeTruthy();
    const clearTaskWorktreeResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
      data: { worktreeId: null, columnId: "done", position: 0 },
    });
    expect(clearTaskWorktreeResponse.ok()).toBeTruthy();

    await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });
    const doneCard = page.getByTestId("kanban-card").filter({ hasText: title }).first();
    await doneCard.getByRole("button", { name: "View detail" }).click();
    await page.getByRole("button", { name: "▼" }).click();
    await expect(page.getByTestId("worktree-detail")).toHaveCount(0);
    await page.screenshot({ path: "test-results/kanban-done-cleanup.png" });

    const finalTaskResponse = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
    expect(finalTaskResponse.ok()).toBeTruthy();
    const finalTasksData = await finalTaskResponse.json();
    const finalTask = (finalTasksData.tasks as Array<{
      title: string;
      codebaseIds?: string[];
      worktreeId?: string;
    }>).find((task) => task.title === title);

    expect(finalTask?.codebaseIds).toContain(primaryCodebase.id);
    expect(finalTask?.codebaseIds).toContain(secondaryCodebase.id);
  });
});
