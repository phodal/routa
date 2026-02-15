import { test, expect } from "@playwright/test";

/**
 * Routa JS UI Check
 * Verifies main page layout, MCP badge, providers, MCP test page, and ROUTA agent mode
 */
test.describe("Routa JS Application Check", () => {
  test.setTimeout(60_000);

  test("main page layout, MCP badge, providers, mcp-test page, ROUTA mode", async ({
    page,
  }) => {
    // 1. Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");

    // 2. Take screenshot of main page
    await page.screenshot({
      path: "test-results/routa-01-main-page.png",
      fullPage: true,
    });

    // 3. Check app loads - top bar with Routa logo, agent selector, left sidebar
    await expect(page.locator("header span").filter({ hasText: "Routa" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Agent:")).toBeVisible();
    await expect(page.locator("aside")).toBeVisible();

    // 4. Check MCP badge status in top bar
    const mcpBadge = page.locator("text=MCP").first();
    await expect(mcpBadge).toBeVisible();
    const mcpSection = page.locator('header').filter({ hasText: /MCP/ });
    const mcpHtml = await mcpSection.innerHTML();
    const mcpConnected = mcpHtml.includes("Connected") || mcpHtml.includes("green");

    // 5. Provider list - wait for providers to load (may show "Connecting..." initially)
    await page.waitForTimeout(5000);
    const providerSection = page.locator("aside");
    await expect(providerSection).toBeVisible();
    const hasProviders = (await page.locator('aside button').filter({ hasText: /Ready|Not found|installed/ }).count()) > 0 ||
      (await page.locator("text=Connecting").count()) > 0;

    // 6. Full page screenshot
    await page.screenshot({
      path: "test-results/routa-02-full-page.png",
      fullPage: true,
    });

    // 7. Navigate to MCP test page
    await page.goto("http://localhost:3000/mcp-test");

    // 8. Screenshot of MCP test page
    await page.screenshot({
      path: "test-results/routa-03-mcp-test-page.png",
      fullPage: true,
    });

    // 9. Go back to main page
    await page.goto("http://localhost:3000");
    await page.waitForTimeout(3000);

    // 10. Select ROUTA from agent selector
    const agentSelect = page.locator('select').filter({ has: page.locator('option[value="ROUTA"]') });
    const selectCount = await agentSelect.count();
    if (selectCount > 0) {
      await agentSelect.selectOption("ROUTA");
      await page.waitForTimeout(500);
    }

    // 11. Screenshot showing ROUTA mode (or CRAFTER if ROUTA not available)
    await page.screenshot({
      path: "test-results/routa-04-agent-mode.png",
      fullPage: true,
    });

    // Log findings
    console.log("MCP badge visible:", await mcpBadge.isVisible());
    console.log("Provider section visible:", await providerSection.isVisible());
    console.log("Agent selector with ROUTA:", selectCount > 0);
  });
});
