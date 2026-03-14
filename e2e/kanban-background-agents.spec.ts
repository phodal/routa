import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const BASE_URL = "http://127.0.0.1:3000";

test.describe("Kanban background agent visualization", () => {
  test.use({ baseURL: BASE_URL });

  test("shows workspace background agents and allows creating one", async ({ page, request }) => {
    const testId = randomUUID();
    const workspaceTitle = `Kanban BG Agents ${testId}`;
    const createdWorkspace = await request.post("/api/workspaces", {
      data: { title: workspaceTitle },
    });
    expect(createdWorkspace.ok()).toBeTruthy();
    const workspaceId = (await createdWorkspace.json()).workspace.id as string;

    const agents = [
      {
        id: `bg-agent-${testId}`,
        name: "Review Bot",
        role: "DEVELOPER",
        status: "ACTIVE",
      },
    ];

    const bgTasks = [
      {
        id: `task-${testId}-1`,
        title: "Review the active pull request",
        prompt: "Review the active pull request and summarize risks",
        agentId: agents[0].id,
        status: "RUNNING",
        triggerSource: "manual",
        attempts: 1,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
        currentActivity: "Scanning changed files",
      },
      {
        id: `task-${testId}-2`,
        title: "Sync labels from workflow",
        prompt: "Sync labels from the latest workflow run",
        agentId: "workflow-bot",
        status: "PENDING",
        triggerSource: "workflow",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      await page.route("**/api/providers**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            providers: [
              {
                id: "codex",
                name: "Codex",
                description: "OpenAI Codex",
                command: "codex",
                status: "available",
              },
            ],
          }),
        });
      });

      await page.route("**/api/acp?sessionId=*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: ": connected\n\n",
        });
      });

      await page.route("**/api/acp", async (route) => {
        const requestBody = route.request().postDataJSON() as { method?: string };
        if (requestBody.method === "initialize") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                protocolVersion: 1,
                agentCapabilities: { loadSession: false },
                agentInfo: { name: "stub-acp", version: "0.1.0" },
              },
            }),
          });
          return;
        }
        await route.fallback();
      });

      await page.route("**/api/agents**", async (route) => {
        const requestUrl = route.request().url();
        if (route.request().method() === "GET" && requestUrl.includes(`workspaceId=${workspaceId}`)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(agents),
          });
          return;
        }

        if (route.request().method() === "POST") {
          const payload = route.request().postDataJSON() as {
            name?: string;
            role?: string;
          };
          agents.push({
            id: `created-agent-${agents.length + 1}`,
            name: payload.name ?? "New Agent",
            role: payload.role ?? "DEVELOPER",
            status: "PENDING",
          });
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
          });
          return;
        }

        await route.fallback();
      });

      await page.route(`**/api/background-tasks?workspaceId=${workspaceId}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ tasks: bgTasks }),
        });
      });

      await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });

      const panel = page.getByTestId("kanban-bg-agent-panel");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText("Background Agents");
      await expect(panel).toContainText("Review Bot");
      await expect(panel).toContainText("workflow-bot");

      await page.getByTestId("kanban-bg-agent-add-btn").click();
      await page.getByTestId("kanban-bg-agent-name-input").fill("Docs Bot");
      await page.getByTestId("kanban-bg-agent-submit-btn").click();

      await expect(page.getByTestId("kanban-bg-agent-name-input")).not.toBeVisible();
      await expect(panel).toContainText("Docs Bot");
    } finally {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
  });
});
