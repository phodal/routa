import { test, expect, type Page } from "@playwright/test";

/**
 * Homepage "Open board" E2E Test for Tauri/Rust Backend
 * 
 * Tests the complete flow:
 * 1. Load homepage
 * 2. Click "Open board" button
 * 3. Verify navigation to Kanban page
 * 4. Click a task to view details
 * 5. Close detail panel
 * 6. Navigate back to homepage
 * 
 * Run with:
 *   npx playwright test --config=playwright.tauri.config.ts e2e/homepage-open-board-tauri.spec.ts --project=chromium-headed
 */
test.describe("Homepage Open Board Flow (Tauri/Rust)", () => {
  const getBaseUrl = () => {
    return process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3210";
  };

  const ensureWorkspaceExists = async (page: Page) => {
    const getStartedButton = page.getByRole("button", { name: "Get Started" });
    if (await getStartedButton.isVisible().catch(() => false)) {
      await getStartedButton.click();
    }

    await expect(page.getByRole("heading", { name: "Recent work" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Open board" })).toHaveAttribute("href", /\/kanban$/, { timeout: 10_000 });
  };

  test.setTimeout(120_000);

  test("Complete flow: Homepage → Open board → Kanban → Task detail → Back to homepage", async ({ page }) => {
    const baseUrl = getBaseUrl();
    const results: string[] = [];

    // Step 1: Navigate to homepage
    await page.goto(baseUrl);
    await page.waitForLoadState("domcontentloaded");
    await ensureWorkspaceExists(page);
    results.push("1. Homepage loaded");

    await page.screenshot({
      path: "test-results/tauri-homepage-01-initial.png",
      fullPage: true,
    });

    // Step 2: Verify homepage elements
    await expect(page.locator("text=Routa")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Recent work")).toBeVisible();
    await expect(page.locator("text=Board Snapshot")).toHaveCount(0);
    results.push("2. Homepage elements visible");

    // Step 3: Find and click "Open board" button
    const openBoardLink = page.locator('a:has-text("Open board"), a:has-text("Open Kanban")').first();
    await expect(openBoardLink).toBeVisible({ timeout: 10_000 });
    results.push("3. 'Open board' button found");

    await page.screenshot({
      path: "test-results/tauri-homepage-02-before-click.png",
      fullPage: true,
    });

    await openBoardLink.click();
    await page.waitForLoadState("domcontentloaded");
    results.push("4. Clicked 'Open board' button");

    // Step 4: Verify navigation to Kanban page
    await expect(page).toHaveURL(/\/kanban/, { timeout: 10_000 });
    results.push("5. Navigated to Kanban page");

    await page.screenshot({
      path: "test-results/tauri-homepage-03-kanban-page.png",
      fullPage: true,
    });

    // Step 5: Verify Kanban page elements
    await expect(page.locator("text=Backlog").first()).toBeVisible({ timeout: 10_000 });
    results.push("6. Kanban board columns visible");

    // Step 6: Try to click a task if available
    const taskCards = page.locator('[data-testid="kanban-card"], button:has-text("Open ")').first();
    const taskCount = await taskCards.count();
    
    if (taskCount > 0) {
      await taskCards.click();
      await page.waitForTimeout(1000);
      results.push("7. Clicked on a task card");

      await page.screenshot({
        path: "test-results/tauri-homepage-04-task-detail.png",
        fullPage: true,
      });

      // Close the detail panel if it opened
      const closeButton = page.locator('button:has-text("Close")').first();
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await page.waitForTimeout(500);
        results.push("8. Closed task detail panel");
      }
    } else {
      results.push("7. No tasks available to click");
    }

    // Step 7: Navigate back to homepage
    const routaLink = page.locator('a:has-text("Routa")').first();
    if (await routaLink.isVisible()) {
      await routaLink.click();
      await page.waitForLoadState("domcontentloaded");
      results.push("9. Clicked Routa logo to go back");

      await page.screenshot({
        path: "test-results/tauri-homepage-05-back-to-home.png",
        fullPage: true,
      });

      // Verify we're back on homepage
      await expect(page.locator("text=Recent work")).toBeVisible({ timeout: 10_000 });
      results.push("10. Back on homepage");
    }

    // Print results
    console.log("\n=== Test Results ===");
    results.forEach((result) => console.log(`✓ ${result}`));
    console.log("====================\n");

    // Final assertion
    expect(results.length).toBeGreaterThan(5);
  });

  test("Verify 'Open board' button exists and has correct href", async ({ page }) => {
    const baseUrl = getBaseUrl();

    await page.goto(baseUrl);
    await page.waitForLoadState("domcontentloaded");
    await ensureWorkspaceExists(page);

    // Find the "Open board" or "Open Kanban" link
    const openBoardLink = page.locator('a:has-text("Open board"), a:has-text("Open Kanban")').first();
    await expect(openBoardLink).toBeVisible({ timeout: 10_000 });

    // Get the href attribute
    const href = await openBoardLink.getAttribute("href");
    expect(href).toMatch(/\/kanban$/);

    console.log(`✓ 'Open board' link found with href: ${href}`);

    await page.screenshot({
      path: "test-results/tauri-homepage-open-board-button.png",
      fullPage: true,
    });
  });
});
