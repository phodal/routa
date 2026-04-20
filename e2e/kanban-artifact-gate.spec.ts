import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pQhNfQAAAAASUVORK5CYII=";
const TEST_RESULTS_TEXT = [
  "PASS e2e/review-visual.spec.ts",
  "  ✓ review lane visual gate captures screenshots (842ms)",
  "",
  "1 passed (1.2s)",
].join("\n");

function parseToolPayload(result: { content?: Array<{ text?: string }> | undefined }) {
  return JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

test.describe("Kanban artifact gates", () => {
  test.use({ baseURL: BASE_URL });
  test.setTimeout(120_000);

  test("agent MCP artifact tools unlock Review gate and refresh the card UI", async ({
    page,
    request,
  }) => {
    const testId = Date.now().toString();
    const title = `Artifact Gate ${testId}`;

    const workspaceResponse = await request.post("/api/workspaces", {
      data: { title: `Artifact Gate Workspace ${testId}` },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspaceId = (await workspaceResponse.json()).workspace.id as string;

    try {
      const boardResponse = await request.get(`/api/kanban/boards?workspaceId=${workspaceId}`);
      expect(boardResponse.ok()).toBeTruthy();
      const boardData = await boardResponse.json();
      const board = (boardData.boards as Array<{
        id: string;
        columns: Array<Record<string, unknown> & { id: string }>;
      }>)[0];

      const patchBoardResponse = await request.patch(`/api/kanban/boards/${board.id}`, {
        data: {
          columns: board.columns.map((column) =>
            column.id === "review"
              ? {
                  ...column,
                  automation: {
                    enabled: false,
                    providerId: "codex",
                    role: "GATE",
                    requiredArtifacts: ["screenshot", "test_results"],
                  },
                }
              : {
                  ...column,
                  automation: {
                    enabled: false,
                  },
                }
          ),
        },
      });
      expect(patchBoardResponse.ok()).toBeTruthy();

      const createTaskResponse = await request.post("/api/tasks", {
        data: {
          workspaceId,
          title,
          objective: "Verify MCP artifact tools can attach evidence and satisfy the Review gate.",
          columnId: "dev",
        },
      });
      expect(createTaskResponse.ok()).toBeTruthy();
      const taskId = (await createTaskResponse.json()).task.id as string;

      await page.goto(`/workspace/${workspaceId}/kanban`);
      await expect(page.getByTestId("kanban-page-shell")).toBeVisible({ timeout: 20_000 });

      const columns = page.getByTestId("kanban-column");
      const devColumn = columns.nth(2);
      const reviewColumn = columns.nth(3);
      const devCard = devColumn.getByTestId("kanban-card").filter({ hasText: title }).first();
      const reviewCard = reviewColumn.getByTestId("kanban-card").filter({ hasText: title }).first();

      await expect(devCard).toBeVisible({ timeout: 20_000 });
      await expect(reviewCard).toHaveCount(0);
      await expect(devCard.getByTestId("kanban-card-artifact-gate")).toContainText("Needs Screenshot");
      await expect(devCard.getByTestId("kanban-card-artifact-gate")).toContainText("+1");

      await devCard.click();
      await expect(page.getByText("Evidence Bundle").first()).toBeVisible();
      await expect(page.getByText("Evidence incomplete")).toBeVisible();

      const provideArtifactResponse = await request.post("/api/mcp/tools", {
        data: {
          workspaceId,
          mode: "essential",
          name: "provide_artifact",
          args: {
            workspaceId,
            agentId: "agent-artifact-e2e",
            type: "screenshot",
            taskId,
            content: TINY_PNG_BASE64,
            context: "Review proof",
            metadata: {
              filename: "review-proof.png",
              mediaType: "image/png",
            },
          },
        },
      });
      expect(provideArtifactResponse.ok()).toBeTruthy();
      const provideArtifactResult = await provideArtifactResponse.json();
      expect(provideArtifactResult.isError).toBe(false);
      expect(parseToolPayload(provideArtifactResult)).toMatchObject({
        artifactId: expect.any(String),
        status: "provided",
      });

      await page.getByRole("button", { name: "Evidence Bundle" }).click();
      await expect(page.getByText("review-proof.png")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("by agent-artifact-e2e")).toBeVisible();
      await expect(devCard.getByTestId("kanban-card-artifact-gate")).toContainText("Needs Test Results");
      await expect(devCard.getByTestId("kanban-card-artifact-count")).toHaveText("1 artifact");

      const provideTestResultsResponse = await request.post("/api/mcp/tools", {
        data: {
          workspaceId,
          mode: "essential",
          name: "provide_artifact",
          args: {
            workspaceId,
            agentId: "agent-artifact-e2e",
            type: "test_results",
            taskId,
            content: TEST_RESULTS_TEXT,
            context: "Playwright review lane verification",
            metadata: {
              filename: "review-test-results.txt",
              mediaType: "text/plain",
            },
          },
        },
      });
      expect(provideTestResultsResponse.ok()).toBeTruthy();
      const provideTestResultsResult = await provideTestResultsResponse.json();
      expect(provideTestResultsResult.isError).toBe(false);
      expect(parseToolPayload(provideTestResultsResult)).toMatchObject({
        artifactId: expect.any(String),
        status: "provided",
      });

      const listArtifactsResponse = await request.post("/api/mcp/tools", {
        data: {
          workspaceId,
          mode: "essential",
          name: "list_artifacts",
          args: {
            workspaceId,
            taskId,
          },
        },
      });
      expect(listArtifactsResponse.ok()).toBeTruthy();
      const listArtifactsResult = await listArtifactsResponse.json();
      expect(listArtifactsResult.isError).toBe(false);
      expect(parseToolPayload(listArtifactsResult)).toMatchObject({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            taskId,
            type: "screenshot",
            providedByAgentId: "agent-artifact-e2e",
          }),
          expect.objectContaining({
            taskId,
            type: "test_results",
            providedByAgentId: "agent-artifact-e2e",
          }),
        ]),
      });

      await page.getByRole("button", { name: "Evidence Bundle" }).click();
      await expect(page.getByText("review-test-results.txt")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(TEST_RESULTS_TEXT)).toBeVisible();
      await expect(devCard.getByTestId("kanban-card-artifact-gate")).toHaveText("Review ready");
      await expect(devCard.getByTestId("kanban-card-artifact-count")).toHaveText("2 artifacts");

      const moveTaskResponse = await request.patch(`/api/tasks/${taskId}`, {
        data: { columnId: "review", position: 0 },
      });
      expect(moveTaskResponse.ok()).toBeTruthy();

      await expect(reviewCard).toBeVisible({ timeout: 20_000 });
      await expect(devCard).toHaveCount(0);
    } finally {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
  });
});
