/**
 * Layout changes verification - screenshots at each step.
 * Run: npx playwright test e2e/layout-changes.spec.ts
 */
import { test } from "@playwright/test";

test.describe("Layout Changes Verification", () => {
  test.setTimeout(60_000);

  test("1. Initial layout at 1280x800", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);

    await page.screenshot({
      path: "test-results/layout-1-initial.png",
      fullPage: false,
    });
  });

  test("2. Left sidebar resize handle - drag and screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Find left sidebar resize handle (right edge of left sidebar)
    const resizeHandle = page.locator(".left-resize-handle");
    await resizeHandle.waitFor({ state: "visible", timeout: 5000 });

    // Get initial sidebar width by measuring the aside
    const aside = page.locator("aside").first();
    const boxBefore = await aside.boundingBox();

    // Drag resize handle to the right (expand sidebar)
    await resizeHandle.hover();
    await page.mouse.down();
    await page.mouse.move(350, 400); // Move right
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({
      path: "test-results/layout-2-resized.png",
      fullPage: false,
    });
  });

  test("3. Expanded skill with markdown", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const skillBtn = page.locator("aside button").filter({ hasText: /^\/[a-zA-Z0-9-]+/ }).first();
    const count = await skillBtn.count();
    if (count > 0) {
      await skillBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({
      path: "test-results/layout-3-skill-expanded.png",
      fullPage: false,
    });
  });

  test("4a. Mobile view - sidebar closed", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "test-results/layout-4a-mobile-closed.png",
      fullPage: false,
    });
  });

  test("4b. Mobile view - sidebar open via hamburger", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hamburger = page.locator("header button").first();
    await hamburger.click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "test-results/layout-4b-mobile-open.png",
      fullPage: false,
    });
  });

  test("5a. Catalog modal - skills.sh tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Catalog")').click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "test-results/layout-5a-catalog-skillssh.png",
      fullPage: false,
    });
  });

  test("5b. Catalog modal - GitHub tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Catalog")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("GitHub")').click();
    await page.waitForTimeout(800);

    await page.screenshot({
      path: "test-results/layout-5b-catalog-github.png",
      fullPage: false,
    });
  });
});
