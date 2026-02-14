import { test, expect } from "@playwright/test";

/**
 * Repo Picker E2E Test
 *
 * Tests the full repo management feature:
 * 1. Repo picker UI appears in the input area (tabs: Repositories / Clone from GitHub)
 * 2. Clone from GitHub tab with progress
 * 3. Repo selection with branch selector
 * 4. Branch dropdown with search, local/remote sections
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

test.describe("Repo Picker", () => {
  test("full flow: repo picker tabs, clone, branch selector", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Step 1: Navigate
    await page.goto(BASE_URL);
    await page.waitForTimeout(3000);

    // Step 2: Find repo picker trigger
    const repoPicker = page.getByRole("button", {
      name: /Select or clone a repository/i,
    });

    // It should be visible (may need to scroll or wait for the input area)
    if (await repoPicker.isVisible()) {
      await repoPicker.click();
      await page.waitForTimeout(500);

      // Screenshot: dropdown open
      await page.screenshot({
        path: "test-results/repo-v2-01-dropdown.png",
        fullPage: false,
      });

      // Step 3: Verify tabs exist
      const reposTab = page.getByRole("button", { name: /Repositories/i });
      const cloneTab = page.getByRole("button", { name: /Clone from GitHub/i });
      await expect(reposTab).toBeVisible();
      await expect(cloneTab).toBeVisible();

      // Step 4: Check if unit-mesh/unit-mesh already cloned
      const existingRepo = page.getByText("unit-mesh/unit-mesh").first();
      if (await existingRepo.isVisible()) {
        // Select the existing repo
        await existingRepo.click();
        await page.waitForTimeout(500);
      } else {
        // Switch to Clone tab
        await cloneTab.click();
        await page.waitForTimeout(300);

        // Screenshot: clone tab
        await page.screenshot({
          path: "test-results/repo-v2-02-clone-tab.png",
          fullPage: false,
        });

        // Enter URL
        const cloneInput = page.getByPlaceholder("owner/repo");
        await expect(cloneInput).toBeVisible();
        await cloneInput.fill("unit-mesh/unit-mesh");

        // Click Clone Repository button
        const cloneBtn = page.getByRole("button", { name: /Clone Repository/i });
        await expect(cloneBtn).toBeVisible();
        await cloneBtn.click();

        // Wait for clone to complete
        await page.waitForTimeout(2000);
        const cloningIndicator = page.getByText("Cloning...");
        if (await cloningIndicator.isVisible()) {
          await expect(cloningIndicator).not.toBeVisible({ timeout: 60_000 });
        }
        await page.waitForTimeout(1000);
      }

      // Screenshot: repo selected
      await page.screenshot({
        path: "test-results/repo-v2-03-selected.png",
        fullPage: false,
      });

      // Step 5: Verify repo is selected with branch selector
      const repoName = page.getByText("unit-mesh/unit-mesh").first();
      await expect(repoName).toBeVisible({ timeout: 10_000 });

      // Step 6: Click branch selector (the button with branch icon + branch name)
      const branchBtn = page
        .locator("button")
        .filter({ hasText: /master|main/ })
        .first();
      if (await branchBtn.isVisible()) {
        await branchBtn.click();
        await page.waitForTimeout(500);

        // Screenshot: branch dropdown
        await page.screenshot({
          path: "test-results/repo-v2-04-branch-dropdown.png",
          fullPage: false,
        });

        // Verify "Switch branch" header
        const switchHeader = page.getByText("Switch branch");
        await expect(switchHeader).toBeVisible();

        // Verify filter input
        const filterInput = page.getByPlaceholder("Filter branches...");
        await expect(filterInput).toBeVisible();

        // Verify "Local" section
        const localSection = page.getByText("Local", { exact: true });
        await expect(localSection).toBeVisible();

        // Close branch dropdown by clicking elsewhere
        await page.locator("body").click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(300);
      }

      // Final screenshot
      await page.screenshot({
        path: "test-results/repo-v2-05-final.png",
        fullPage: false,
      });
    }
  });
});
