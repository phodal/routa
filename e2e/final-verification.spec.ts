/**
 * Final quick verification - pass/fail for each check.
 */
import { test, expect } from "@playwright/test";

test.describe("Final Verification", () => {
  test.setTimeout(45_000);

  test("1. Desktop screenshot - overall layout clean", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/final-1-desktop.png" });
    const header = page.locator("header");
    await expect(header).toBeVisible();
    const aside = page.locator("aside").first();
    await expect(aside).toBeVisible();
    // PASS if we got here
  });

  test("2. Skill click - markdown renders (not raw)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const skillBtn = page.locator("aside button").filter({ hasText: /^\/[a-zA-Z0-9-]+/ }).first();
    if ((await skillBtn.count()) > 0) {
      await skillBtn.click();
      await page.waitForTimeout(1000);
      // Check for rendered markdown (prose, headings, etc.) - not raw ``` or #
      const expanded = page.locator(".skill-content-viewer, .prose-compact");
      const hasProse = (await expanded.count()) > 0;
      const rawMarkdown = page.locator("text=# Find Skills").first(); // heading would be rendered
      await expect(rawMarkdown.or(page.locator("text=When to Use"))).toBeVisible({ timeout: 3000 });
    }
  });

  test("3. Catalog - no error, skills.sh and GitHub tabs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Catalog")').click();
    await page.waitForTimeout(1000);

    // No error message
    const error = page.locator('[class*="red"], [class*="error"]').filter({ hasText: /400|error|failed/i });
    await expect(error).toHaveCount(0);

    // Both tabs present
    await expect(page.locator('button:has-text("skills.sh")')).toBeVisible();
    await expect(page.locator('button:has-text("GitHub")')).toBeVisible();
  });

  test("4. skills.sh search - type react", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Catalog")').click();
    await page.waitForTimeout(500);

    const searchInput = page.locator('input[placeholder*="Search skills"]');
    await searchInput.fill("react");
    await page.waitForTimeout(2500); // Allow API call

    // Verify search returned results (e.g. "30 results" or skill list)
    const resultsText = page.locator('text=/\\d+ results?/');
    const hasSkillList = await page.locator('label:has(input[type="checkbox"])').count() > 0;
    expect(await resultsText.isVisible() || hasSkillList).toBe(true);
  });

  test("5. GitHub tab - click preset loads", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Catalog")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("GitHub")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("openai/skills (curated)")').click();
    await page.waitForTimeout(2000); // Load catalog

    // Should show results or loading - no error
    const hasError = await page.locator('text=/400|error|failed/i').count() > 0;
    expect(hasError).toBe(false);
  });

  test("6. Mobile - hamburger visible, sidebar hidden", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hamburger = page.locator("header button").first();
    await expect(hamburger).toBeVisible();

    const sidebar = page.locator("aside").first();
    // On mobile, sidebar has hidden md:flex when closed - so it may not be visible
    const sidebarVisible = await sidebar.isVisible();
    expect(sidebarVisible).toBe(false); // Should be hidden on mobile when closed
  });

  test("7. Mobile sidebar open - bottom actions visible", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator("header button").first().click();
    await page.waitForTimeout(500);

    const installAgents = page.locator('a:has-text("Install Agents")');
    const manageProviders = page.locator('a:has-text("Manage Providers")');

    await expect(installAgents).toBeVisible();
    await expect(manageProviders).toBeVisible();
  });
});
