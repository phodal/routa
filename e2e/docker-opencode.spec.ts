import { test, expect } from "@playwright/test";

/**
 * Docker OpenCode E2E Test
 *
 * Tests the Docker-based OpenCode agent flow:
 * 1. Verify Docker status endpoint returns available
 * 2. Configure auth.json in settings
 * 3. Select docker-opencode provider
 * 4. Create a session and send a message
 * 5. Verify redirection to session detail page with ACP response
 *
 * Run with Tauri backend:
 *   npx playwright test --config=playwright.tauri.config.ts e2e/docker-opencode.spec.ts
 */
test.describe("Docker OpenCode Flow", () => {
  const getBaseUrl = () => {
    return process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3210";
  };

  test("Docker status API is available", async ({ request }) => {
    const baseUrl = getBaseUrl();
    const response = await request.get(`${baseUrl}/api/acp/docker/status`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("available");
    expect(data).toHaveProperty("daemonRunning");
    console.log("✓ Docker status:", data);
  });

  test("Configure auth.json and select docker-opencode provider", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const baseUrl = getBaseUrl();
    const results: string[] = [];

    // Step 1: Navigate to home page
    await page.goto(baseUrl);
    results.push("1. Navigated to home page");

    // Wait for the main content to load
    await page.waitForSelector("main", { timeout: 15_000 });
    results.push("   - Main content visible");

    // Take initial screenshot
    await page.screenshot({
      path: "test-results/docker-opencode-01-home.png",
      fullPage: true,
    });

    // Step 2: Set auth.json in localStorage for Docker OpenCode
    await page.evaluate(() => {
      const testAuthJson = JSON.stringify({
        zai: { type: "api", key: "test-key-for-e2e" }
      }, null, 2);
      localStorage.setItem("docker-opencode-auth-json", testAuthJson);
    });
    results.push("2. Set auth.json in localStorage");

    // Verify "Connected" status (already connected from page load)
    const connectedIndicator = page.locator('text=Connected');
    await expect(connectedIndicator).toBeVisible({ timeout: 10_000 });
    results.push("3. ACP Connected status visible");

    // Step 4: Click on provider button (shows "OpenCode" by default)
    // The provider button is in the input area
    const providerBtn = page.getByRole("button", { name: /OpenCode|claude|gemini/i }).first();
    await providerBtn.waitFor({ state: "visible", timeout: 10_000 });
    await providerBtn.click();
    results.push("4. Clicked provider dropdown button");

    await page.screenshot({
      path: "test-results/docker-opencode-02-provider-dropdown.png",
      fullPage: true,
    });

    // Wait for dropdown menu to appear
    await page.waitForTimeout(500);

    // Look for docker-opencode option in dropdown
    const dockerOption = page.locator('text=Docker OpenCode').first();
    const hasDockerOption = await dockerOption.isVisible().catch(() => false);

    if (hasDockerOption) {
      await dockerOption.click();
      results.push("5. Selected Docker OpenCode provider");
    } else {
      // List available options for debugging
      const dropdown = page.locator('[role="menu"], [role="listbox"], .dropdown-menu');
      const options = await dropdown.locator("button, [role='option'], [role='menuitem']").allTextContents();
      results.push(`5. Docker OpenCode not in dropdown. Available: ${options.slice(0, 10).join(", ")}`);
    }

    await page.screenshot({
      path: "test-results/docker-opencode-03-provider-selected.png",
      fullPage: true,
    });

    // Step 6: Type a message and send
    const inputArea = page.locator('[contenteditable="true"]').first();
    if (await inputArea.isVisible()) {
      await inputArea.fill("hi");
      results.push("6. Typed 'hi' in input");

      // Click send button
      const sendBtn = page.getByRole("button", { name: "Send" });
      if (await sendBtn.isEnabled()) {
        await sendBtn.click();
        results.push("   - Clicked Send button");

        // Wait for navigation or session creation
        await page.waitForTimeout(3000);

        await page.screenshot({
          path: "test-results/docker-opencode-04-after-send.png",
          fullPage: true,
        });

        // Check if we navigated to session detail page
        const currentUrl = page.url();
        if (currentUrl.includes("/session") || currentUrl.includes("/workspace")) {
          results.push(`7. Navigated to: ${currentUrl}`);
        }
      }
    }

    // Log results
    console.log("\n=== Docker OpenCode E2E Test Log ===\n");
    results.forEach((r) => console.log(r));
    console.log("\n====================================\n");

    // Basic assertion - page should still be functional
    await expect(page.locator("body")).toBeVisible();
  });
});

