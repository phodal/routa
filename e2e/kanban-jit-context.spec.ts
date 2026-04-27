import { expect, test } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const PRIMARY_REPO_PATH = process.env.ROUTA_E2E_REPO_PATH || process.cwd();

async function fillIssueObjective(page: import("@playwright/test").Page, text: string) {
  const editor = page.locator(".ProseMirror").last();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
}

test.use({
  baseURL: BASE_URL,
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
  video: "on",
});

test.describe("Kanban JIT Context", () => {
  test.setTimeout(180_000);

  test("creates a card against the local repo and opens JIT Context", async ({ page, request }) => {
    const testId = Date.now().toString();
    const workspaceTitle = `JIT Context Workspace ${testId}`;
    const taskTitle = "为 Kanban 建立可持久化的流动事件模型";

    const workspaceResponse = await request.post("/api/workspaces", {
      data: { title: workspaceTitle },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspaceId = ((await workspaceResponse.json()) as { workspace: { id: string } }).workspace.id;

    try {
      const codebaseResponse = await request.post(`/api/workspaces/${workspaceId}/codebases`, {
        data: {
          repoPath: PRIMARY_REPO_PATH,
          branch: "main",
          label: "routa-main",
        },
      });
      expect(codebaseResponse.ok()).toBeTruthy();

      await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });

      await page.getByRole("button", { name: /Create issue|Manual/ }).click();
      await page.getByPlaceholder(/Task title|Issue title/).fill(taskTitle);
      await fillIssueObjective(page, "验证 JIT Context 能基于本地 routa-js 仓库恢复相关 feature 和文件。");
      const createButton = page.getByRole("button", { name: "Create", exact: true });
      await expect(createButton).toBeEnabled();
      await createButton.click();

      const card = page.getByTestId("kanban-card").filter({ hasText: taskTitle }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });

      const tasksResponse = await request.get(`/api/tasks?workspaceId=${workspaceId}`);
      expect(tasksResponse.ok()).toBeTruthy();
      const tasksData = (await tasksResponse.json()) as {
        tasks: Array<{ id: string; title: string }>;
      };
      const createdTask = tasksData.tasks.find((task) => task.title === taskTitle);
      expect(createdTask).toBeTruthy();

      const patchResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
        data: {
          contextSearchSpec: {
            query: taskTitle,
            featureCandidates: ["kanban-workflow"],
            routeCandidates: ["/workspace/:workspaceId/kanban"],
            moduleHints: ["kanban"],
          },
        },
      });
      expect(patchResponse.ok()).toBeTruthy();

      await page.goto(`/workspace/${workspaceId}/kanban?taskId=${createdTask!.id}`, {
        waitUntil: "domcontentloaded",
      });

      const jitTab = page.getByTestId("kanban-detail-tab-jitContext");
      await expect(jitTab).toBeVisible({ timeout: 15_000 });
      await jitTab.click();

      const jitPanel = page.getByTestId("kanban-detail-panel-jitContext");
      await expect(jitPanel).toBeVisible();
      await expect(jitPanel.getByRole("button", { name: /Show JIT Context/i })).toBeVisible();
      await jitPanel.getByRole("button", { name: /Show JIT Context/i }).click();

      await expect(jitPanel).toContainText(/Match confidence/i, { timeout: 60_000 });
      await expect(jitPanel).toContainText(/Kanban Workflow|kanban-workflow/i, { timeout: 60_000 });
      await expect(jitPanel).toContainText(/Matched files/i);

      await page.screenshot({
        path: "test-results/kanban-jit-context-created-card.png",
        fullPage: true,
      });
    } finally {
      await request.delete(`/api/workspaces/${workspaceId}`).catch(() => undefined);
    }
  });
});
