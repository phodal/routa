import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Tauri/Rust Backend Verification Test
 * 
 * This test verifies that the Tauri application with Rust backend is working correctly.
 * Run with: npx playwright test --config=playwright.tauri.config.ts e2e/tauri-backend-check.spec.ts
 * 
 * Prerequisites:
 *   1. Start Tauri dev: cd apps/desktop && npm run tauri dev
 *   2. Wait for Rust backend to be ready on port 3210
 */
test.describe("Tauri/Rust Backend Verification", () => {
  test.setTimeout(60_000);

  // Use baseURL from config (127.0.0.1:3210 for Tauri)
  const getBaseUrl = () => {
    return process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3210";
  };

  async function getJsonWithRetry<T>(
    request: APIRequestContext,
    url: string,
    opts: { attempts?: number; retryDelayMs?: number } = {}
  ): Promise<T> {
    const attempts = opts.attempts ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 500;
    let lastError: unknown;

    for (let i = 0; i < attempts; i += 1) {
      try {
        const response = await request.get(url);
        if (!response.ok()) {
          throw new Error(`HTTP ${response.status()} for ${url}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
  }

  test("Rust backend health check", async ({ request }) => {
    const baseUrl = getBaseUrl();
    const response = await request.get(`${baseUrl}/api/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.server).toBe("routa-server");
    console.log("✓ Rust backend health:", data);
  });

  test("API endpoints work correctly", async ({ request }) => {
    const baseUrl = getBaseUrl();

    // Test agents endpoint
    const agentsRes = await request.get(`${baseUrl}/api/agents`);
    expect(agentsRes.ok()).toBeTruthy();
    const agents = await agentsRes.json();
    expect(agents).toHaveProperty("agents");
    console.log("✓ Agents API:", agents);

    // Test workspaces endpoint
    const workspacesRes = await request.get(`${baseUrl}/api/workspaces`);
    expect(workspacesRes.ok()).toBeTruthy();
    const workspaces = await workspacesRes.json();
    expect(workspaces).toHaveProperty("workspaces");
    console.log("✓ Workspaces API:", workspaces);

    // Test sessions endpoint
    const sessionsRes = await request.get(`${baseUrl}/api/sessions`);
    expect(sessionsRes.ok()).toBeTruthy();
    console.log("✓ Sessions API working");
  });

  test("Team specialists are exposed by the Rust backend", async ({ request }) => {
    const baseUrl = getBaseUrl();
    const data = await getJsonWithRetry<{ specialists: Array<{ id: string }> }>(
      request,
      `${baseUrl}/api/specialists`
    );
    expect(Array.isArray(data.specialists)).toBeTruthy();

    const specialistIds = data.specialists.map((specialist: { id: string }) => specialist.id);
    expect(specialistIds).toContain("team-agent-lead");
    expect(specialistIds).toContain("team-frontend-dev");
    expect(specialistIds).toContain("team-backend-dev");
    expect(specialistIds).toContain("team-qa");

    console.log("✓ Team specialists available:", specialistIds.filter((id: string) => id.startsWith("team-")));
  });

  test("Frontend loads correctly from Rust backend", async ({ page }) => {
    const baseUrl = getBaseUrl();
    
    // Navigate to the main page served by Rust backend
    await page.goto(baseUrl);
    
    // Take screenshot
    await page.screenshot({
      path: "test-results/tauri-01-main-page.png",
      fullPage: true,
    });

    // Check that the page loads - look for Routa branding
    await expect(page.getByRole("link", { name: /Mode Kanban/i })).toBeVisible({ timeout: 15_000 });
    console.log("✓ Homepage mode links visible");

    // Check main content is present
    await expect(page.getByTestId("desktop-shell-main")).toBeVisible();
    console.log("✓ Main content visible");

    // Check top navigation is present
    await expect(page.getByRole("link", { name: "Kanban" }).first()).toBeVisible();
    console.log("✓ Kanban link visible");

    // Full page screenshot
    await page.screenshot({
      path: "test-results/tauri-02-full-page.png",
      fullPage: true,
    });
  });

  test("MCP test page works", async ({ page }) => {
    const baseUrl = getBaseUrl();
    
    await page.goto(`${baseUrl}/mcp-test`);
    
    await page.screenshot({
      path: "test-results/tauri-03-mcp-test.png",
      fullPage: true,
    });

    // Verify page loaded
    await expect(page).toHaveURL(/mcp-test/);
    console.log("✓ MCP test page loaded");
  });

  test("Settings page works", async ({ page }) => {
    const baseUrl = getBaseUrl();
    
    await page.goto(`${baseUrl}/settings`);
    
    // Wait for page to load
    await page.waitForLoadState("networkidle");
    
    await page.screenshot({
      path: "test-results/tauri-04-settings.png",
      fullPage: true,
    });

    console.log("✓ Settings page loaded");
  });

  test("Team page shows Agent Lead roster on Rust backend", async ({ page }) => {
    const baseUrl = getBaseUrl();

    await page.goto(`${baseUrl}/workspace/default/team`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Launch the Team lead with the shared input.")).toBeVisible();
    await expect(page.getByText("Agent Lead").first()).toBeVisible();
    await expect(page.getByText("Research Analyst").first()).toBeVisible();
    await expect(page.getByText("Frontend Dev").first()).toBeVisible();
    await expect(page.getByText("Backend Developer").first()).toBeVisible();
    await expect(page.getByText("QA Specialist").first()).toBeVisible();
    await expect(page.getByText("Code Reviewer").first()).toBeVisible();
    await expect(page.getByText("UX Designer").first()).toBeVisible();
    await expect(page.getByText("Operations Engineer").first()).toBeVisible();
    await expect(page.getByText("General Engineer").first()).toBeVisible();
    await expect(page.getByText(/members/i).locator("..").getByText("8")).toBeVisible();

    const emptyState = page.getByText("No Team runs yet.");
    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toBeVisible();
    } else {
      await expect(page.getByText("Direct delegates").first()).toBeVisible();
    }

    await page.screenshot({
      path: "test-results/tauri-05-team-page.png",
      fullPage: true,
    });

    console.log("✓ Team page roster visible");
  });
});
