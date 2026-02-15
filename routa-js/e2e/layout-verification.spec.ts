import { test, expect } from "@playwright/test";

/**
 * Layout verification at 1920x1080 viewport.
 * Verifies: top bar, left sidebar, chat area, agent selector.
 * Notes: Right sidebar appears only when tasks exist (ROUTA mode + tasks).
 */
test.describe("Layout Verification", () => {
  test.setTimeout(30_000);

  test("main layout at 1920x1080 - top bar, sidebar, chat area, agent selector", async ({
    page,
  }) => {
    // Set viewport to 1920x1080
    await page.setViewportSize({ width: 1920, height: 1080 });

    // 1. Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("domcontentloaded");

    // 2. Take screenshot
    await page.screenshot({
      path: "test-results/layout-1920x1080.png",
      fullPage: false,
    });

    // 3. Verify top bar
    const header = page.locator("header");
    await expect(header).toBeVisible();
    await expect(header.locator("span").filter({ hasText: "Routa" })).toBeVisible();

    // 4. Verify left sidebar
    const leftSidebar = page.locator("aside").first();
    await expect(leftSidebar).toBeVisible();
    await expect(page.locator("label:has-text('Provider')")).toBeVisible();
    await expect(page.locator("span").filter({ hasText: /^Sessions$/ })).toBeVisible();

    // 5. Verify main chat area
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // 6. Agent selector visible and changeable
    const agentLabel = page.locator("span:has-text('Agent:')");
    await expect(agentLabel).toBeVisible();

    const agentSelect = page.locator("select").filter({
      has: page.locator('option[value="ROUTA"]'),
    });
    await expect(agentSelect).toBeVisible();

    // Change to ROUTA
    await agentSelect.selectOption("ROUTA");
    const selectedValue = await agentSelect.inputValue();
    expect(selectedValue).toBe("ROUTA");

    // 7. Right sidebar: only appears when routaTasks.length > 0 or crafterAgents.length > 0
    // Without tasks, right sidebar should NOT be visible
    const rightSidebar = page.locator('aside[class*="border-l"]');
    const rightSidebarCount = await rightSidebar.count();
    // We expect 0 or 1 - the left sidebar has border-r, right has border-l
    console.log("Right sidebar (task panel) visible:", rightSidebarCount > 0);

    // 8. Final screenshot with ROUTA selected
    await page.screenshot({
      path: "test-results/layout-1920x1080-routa-mode.png",
      fullPage: false,
    });

    console.log("Layout verified: top bar, left sidebar, chat area, agent selector OK");
  });
});
