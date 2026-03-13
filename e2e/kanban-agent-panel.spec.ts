import { test, expect } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const PRIMARY_REPO_PATH = process.env.ROUTA_E2E_REPO_PATH || process.cwd();

test.describe("Kanban ACP agent panel", () => {
  test.use({ baseURL: BASE_URL });

  test("opens the right-side chat panel and creates a full-tool ACP session", async ({
    page,
    request,
  }) => {
    const testId = Date.now().toString();
    const workspaceTitle = `Kanban Agent Panel ${testId}`;
    const stubSessionId = `stub-session-${testId}`;
    const createdSessions: Array<{ provider?: string; toolMode?: string }> = [];

    const workspaceResponse = await request.post("/api/workspaces", {
      data: { title: workspaceTitle },
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
              {
                id: "opencode",
                name: "OpenCode",
                description: "OpenCode",
                command: "opencode",
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
        const requestBody = route.request().postDataJSON() as {
          method?: string;
          params?: Record<string, unknown>;
        };

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

        if (requestBody.method === "session/new") {
          createdSessions.push({
            provider: requestBody.params?.provider as string | undefined,
            toolMode: requestBody.params?.toolMode as string | undefined,
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                sessionId: stubSessionId,
                provider: requestBody.params?.provider ?? "codex",
                role: requestBody.params?.role ?? "DEVELOPER",
                acpStatus: "ready",
              },
            }),
          });
          return;
        }

        if (requestBody.method === "session/prompt") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                stopReason: "end_turn",
              },
            }),
          });
          return;
        }

        await route.fallback();
      });

      await page.route(`**/api/sessions/${stubSessionId}/history`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            history: [
              {
                sessionId: stubSessionId,
                update: {
                  sessionUpdate: "agent_message",
                  content: {
                    type: "text",
                    text: "Created two backlog cards for the Kanban request.",
                  },
                },
              },
            ],
          }),
        });
      });

      await page.goto(`/workspace/${workspaceId}/kanban`, { waitUntil: "domcontentloaded" });

      const providerSelect = page.getByTestId("kanban-agent-provider");
      await expect(providerSelect).toBeVisible({ timeout: 15_000 });
      await providerSelect.selectOption("codex");

      const input = page.getByPlaceholder("Describe work to plan in Kanban...");
      await input.fill("Split the Kanban ACP provider agent work into two backlog cards.");
      await page.getByRole("button", { name: "Send" }).click();

      const panel = page.getByTestId("kanban-agent-panel");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText("Kanban ACP Agent");
      await expect(panel).toContainText("codex");
      await page.screenshot({
        path: "test-results/kanban-agent-panel.png",
        fullPage: true,
      });

      expect(createdSessions).toHaveLength(1);
      expect(createdSessions[0]).toMatchObject({
        provider: "codex",
        toolMode: "full",
      });
    } finally {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
  });
});
