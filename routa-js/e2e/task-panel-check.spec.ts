import { test, expect } from "@playwright/test";

/**
 * Routa JS Task Panel Feature Test
 *
 * Tests:
 * 1. Main page load and layout
 * 2. ROUTA mode selection and toast
 * 3. Page evaluate (document.title)
 * 4. Layout verification (sidebar, chat area)
 *
 * Note: The Task Panel only appears when assistant messages contain @@@task blocks.
 * Without a real Routa agent response, we verify the layout and ROUTA mode selection.
 */
test.describe("Routa JS Task Panel Feature", () => {
  test.setTimeout(60_000);

  test("main page, ROUTA mode, layout verification", async ({ page }) => {
    // 1. Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");

    // 2. Take screenshot of initial page
    await page.screenshot({
      path: "test-results/task-panel-01-initial.png",
      fullPage: true,
    });

    // 3. Wait for page to load fully (providers should show as Ready)
    await page.waitForTimeout(6000);
    const readyCount = await page.locator('text=Ready').count();
    const installedCount = await page.locator('text=/\\d+\\/\\d+ installed/').count();
    console.log("Providers Ready count:", readyCount, "Installed indicator:", installedCount > 0);

    await page.screenshot({
      path: "test-results/task-panel-02-loaded.png",
      fullPage: true,
    });

    // 4. Select ROUTA from the Agent dropdown
    const agentSelect = page.locator('select').filter({ has: page.locator('option[value="ROUTA"]') });
    await agentSelect.selectOption("ROUTA");
    await page.waitForTimeout(500);

    // 5. Take screenshot showing ROUTA mode active (toast may appear briefly)
    await page.screenshot({
      path: "test-results/task-panel-03-routa-selected.png",
      fullPage: true,
    });

    // 6. Use evaluate to test - run JavaScript in page context
    const pageTitle = await page.evaluate(() => document.title);
    console.log("document.title:", pageTitle);

    // Check if TaskPanel component structure exists (it returns null when tasks=0)
    const hasTaskPanelStructure = await page.evaluate(() => {
      // TaskPanel renders only when routaTasks.length > 0, so we check for layout elements
      const aside = document.querySelector('aside[class*="border-l"]');
      const main = document.querySelector("main");
      return { hasRightAside: !!aside, hasMain: !!main };
    });
    console.log("Layout check:", hasTaskPanelStructure);

    await page.screenshot({
      path: "test-results/task-panel-04-after-evaluate.png",
      fullPage: true,
    });

    // 7. Verify layout
    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator('header span').filter({ hasText: "Routa" })).toBeVisible();

    // ROUTA mode: agent selector should show ROUTA
    const agentValue = await page.locator('select').first().inputValue();
    expect(agentValue).toBe("ROUTA");

    // Check for ROUTA mode banner (may be in toast or as persistent UI)
    const routaBanner = page.locator("text=ROUTA mode");
    const hasRoutaBanner = (await routaBanner.count()) > 0;
    console.log("ROUTA mode banner/toast visible:", hasRoutaBanner);

    await page.screenshot({
      path: "test-results/task-panel-05-final.png",
      fullPage: true,
    });
  });
});
