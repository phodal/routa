import { expect, test } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test.describe("Harness settings spec sources", () => {
  test("renders full and compact spec source panels when the thinking node is selected", async ({ page }) => {
    test.setTimeout(120_000);

    await page.addInitScript(() => {
      window.localStorage.setItem(
        "routa.repoSelection.harness.default",
        JSON.stringify({
          name: "routa-js",
          path: "/Users/phodal/ai/routa-js",
          branch: "main",
        }),
      );
    });

    await page.route("**/api/workspaces?status=active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspaces: [
            {
              id: "default",
              title: "Default Workspace",
              status: "active",
              metadata: {},
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.route("**/api/workspaces/default/codebases", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          codebases: [
            {
              id: "cb-1",
              workspaceId: "default",
              repoPath: "/Users/phodal/ai/routa-js",
              branch: "main",
              label: "phodal/routa",
              isDefault: true,
              sourceType: "local",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z",
            },
          ],
        }),
      });
    });

    const json = (body: unknown) => ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    await page.route("**/api/fitness/specs?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        fitnessDir: "docs/fitness",
        files: [
          {
            name: "README.md",
            relativePath: "docs/fitness/README.md",
            kind: "rulebook",
            language: "markdown",
            metricCount: 0,
            metrics: [],
            source: "# Fitness README",
          },
        ],
      }));
    });

    await page.route("**/api/fitness/plan?**", async (route) => {
      await route.fulfill(json({
        metricCount: 2,
        hardGateCount: 1,
        dimensions: [],
      }));
    });

    await page.route("**/api/harness/hooks?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        hooksDir: ".claude/hooks",
        configFile: null,
        reviewTriggerFile: null,
        hookFiles: [],
        profiles: [],
        warnings: [],
      }));
    });

    await page.route("**/api/harness/instructions?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        fileName: "AGENTS.md",
        relativePath: "AGENTS.md",
        source: "# Routa.js",
        fallbackUsed: false,
        audit: null,
      }));
    });

    await page.route("**/api/harness/design-decisions?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        sources: [
          {
            kind: "canonical-doc",
            label: "Architecture",
            rootPath: "docs",
            confidence: "high",
            status: "documents-present",
            artifacts: [
              {
                id: "architecture-top-level",
                title: "Top-level architecture contract",
                path: "docs/ARCHITECTURE.md",
                type: "architecture",
                status: "canonical",
                summary: "Canonical architecture overview for runtime boundaries and invariants.",
                codeRefs: ["Workspace-first scope over hidden global state"],
              },
            ],
          },
        ],
        warnings: [],
      }));
    });

    await page.route("**/api/harness/github-actions?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        workflowsDir: ".github/workflows",
        flows: [],
        warnings: [],
      }));
    });

    await page.route("**/api/harness/agent-hooks?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        configFile: null,
        hooks: [],
        warnings: [],
      }));
    });

    await page.route("**/api/harness/spec-sources?**", async (route) => {
      await route.fulfill(json({
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        sources: [
          {
            kind: "framework",
            system: "bmad",
            rootPath: "docs",
            confidence: "low",
            status: "legacy",
            evidence: ["docs/prd.md"],
            children: [{ type: "prd", path: "docs/prd.md" }],
          },
        ],
        warnings: [],
      }));
    });

    await page.goto(`${BASE_URL}/settings/harness?workspaceId=default`);

    await expect(page.getByTestId("spec-sources-full")).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-governance-node-id="thinking"]').click();

    await expect(page.getByTestId("spec-sources-full")).toBeVisible();
    await expect(page.getByTestId("spec-sources-compact")).toBeVisible({ timeout: 15_000 });
  });
});
