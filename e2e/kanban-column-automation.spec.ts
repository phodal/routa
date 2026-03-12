import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const PRIMARY_REPO_PATH = process.env.ROUTA_E2E_REPO_PATH || process.cwd();

async function fillIssueObjective(page: Page, text: string) {
  const editor = page.locator(".ProseMirror").last();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
}

test.describe("Kanban column automation", () => {
  test.use({ baseURL: BASE_URL });
  test.setTimeout(180_000);

  test("manual issue modal works and todo column automation creates a session", async ({
    page,
    request,
  }) => {
    const testId = Date.now().toString();
    const title = `Kanban Automation ${testId}`;

    const workspaceResponse = await request.post("/api/workspaces", {
      data: { title: `Kanban Automation Workspace ${testId}` },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspaceId = (await workspaceResponse.json()).workspace.id as string;

    try {
      const codebaseResponse = await request.post(`/api/workspaces/${workspaceId}/codebases`, {
        data: {
          repoPath: PRIMARY_REPO_PATH,
          branch: "main",
          label: "routa-main",
        },
      });
      expect(codebaseResponse.ok()).toBeTruthy();

      const boardResponse = await request.get(`/api/kanban/boards?workspaceId=${workspaceId}`);
      expect(boardResponse.ok()).toBeTruthy();
      const boardData = await boardResponse.json();
      const board = (boardData.boards as Array<{
        id: string;
        columns: Array<Record<string, unknown> & { id: string }>;
      }>)[0];

      const columns = board.columns.map((column) =>
        column.id === "todo"
          ? {
              ...column,
              automation: {
                enabled: true,
                providerId: "codex",
                role: "DEVELOPER",
              },
            }
          : column,
      );

      const patchBoardResponse = await request.patch(`/api/kanban/boards/${board.id}`, {
        data: { columns },
      });
      expect(patchBoardResponse.ok()).toBeTruthy();

      await page.goto(`/workspace/${workspaceId}/kanban`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: /Create issue|Manual/ }).click();
      await expect(page.getByPlaceholder("Issue title")).toBeVisible();

      await page.getByPlaceholder("Issue title").fill(title);
      await fillIssueObjective(page, "Verify Todo column automation starts an ACP session.");
      await page.getByRole("button", { name: "Create", exact: true }).click();

      const card = page.getByTestId("kanban-card").filter({ hasText: title }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });

      const taskListResponse = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
      expect(taskListResponse.ok()).toBeTruthy();
      const taskListData = await taskListResponse.json();
      const createdTask = (taskListData.tasks as Array<{
        id: string;
        title: string;
      }>).find((task) => task.title === title);

      expect(createdTask).toBeTruthy();

      const moveTaskResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
        data: { columnId: "todo", position: 0 },
      });
      expect(moveTaskResponse.ok()).toBeTruthy();

      await expect
        .poll(
          async () => {
            const taskResponse = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
            if (!taskResponse.ok()) return null;

            const taskData = await taskResponse.json();
            const createdTask = (taskData.tasks as Array<{
              title: string;
              columnId?: string;
              triggerSessionId?: string;
              assignedProvider?: string;
            }>).find((task) => task.title === title);

            if (!createdTask || createdTask.columnId !== "todo") return null;
            return createdTask.triggerSessionId ?? null;
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .not.toBeNull();

      await page.reload();
      await page.waitForLoadState("networkidle");

      const automatedCard = page
        .getByTestId("kanban-column")
        .filter({ hasText: "Todo" })
        .first()
        .getByTestId("kanban-card")
        .filter({ hasText: title })
        .first();
      await expect(automatedCard.getByRole("button", { name: "View session" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(automatedCard).toContainText("Codex");
    } finally {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
  });
});
