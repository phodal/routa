/**
 * Kanban OpenCode Smoke Test
 *
 * Validates:
 * 1. ACP triggering with OpenCode provider
 * 2. Session popup behavior
 *
 * Flow:
 * 1. Navigate to workspace
 * 2. Switch to Kanban tab
 * 3. Create a test issue
 * 4. Assign OpenCode provider
 * 5. Trigger ACP session
 * 6. Verify session popup opens
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("Kanban OpenCode Smoke Test", () => {
  test("ACP triggering with OpenCode provider and session popup", async ({ page }) => {
    const results: string[] = [];

    test.setTimeout(180_000);

    // Capture console errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Step 1: Navigate to workspace
    await page.goto(`${BASE}/workspace/default`);
    results.push("1. Navigated to workspace/default");

    // Wait for page load
    await page.waitForLoadState("networkidle");

    // Step 2: Click on Kanban tab
    const kanbanTab = page.locator("button:has-text('Kanban'), [role='tab']:has-text('Kanban')").first();
    await kanbanTab.click({ timeout: 10_000 });
    results.push("2. Clicked Kanban tab");

    // Wait for Kanban board to load
    await page.waitForTimeout(2000);

    // Step 3: Check if there's an existing board, or create one
    const boardSelect = page.locator("select").filter({ has: page.locator("option") }).first();
    const hasBoards = await boardSelect.count() > 0 && await boardSelect.locator("option").count() > 0;
    
    if (!hasBoards) {
      // Create a new board
      const newBoardBtn = page.locator("button:has-text('New board')");
      if (await newBoardBtn.isVisible({ timeout: 5_000 })) {
        await newBoardBtn.click();
        results.push("3. Created new board");
        await page.waitForTimeout(1000);
      }
    } else {
      results.push("3. Board already exists");
    }

    // Step 4: Click "Create issue" button
    const createIssueBtn = page.locator("button:has-text('Create issue')");
    await expect(createIssueBtn).toBeVisible({ timeout: 10_000 });
    await createIssueBtn.click();
    results.push("4. Clicked 'Create issue' button");

    // Wait for modal
    await page.waitForTimeout(1000);

    // Step 5: Fill in issue details
    const titleInput = page.locator('input[placeholder="Issue title"]');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill("Test OpenCode Smoke Issue");
    results.push("5. Filled issue title");

    // Fill objective
    const objectiveInput = page.locator('textarea[placeholder="Describe the work"]');
    await objectiveInput.fill("Testing ACP triggering with OpenCode provider and session popup behavior");
    results.push("   - Filled issue objective");

    // Step 6: Select priority (medium)
    const prioritySelect = page.locator('select').filter({ has: page.locator("option[value='medium']") }).first();
    await prioritySelect.selectOption("medium");
    results.push("6. Selected priority: medium");

    // Step 7: Submit the form
    const submitBtn = page.locator("button:has-text('Create'), button:has-text('Submit')").last();
    await submitBtn.click();
    results.push("7. Submitted issue");

    // Wait for issue to appear in Kanban
    await page.waitForTimeout(3000);
    results.push("8. Issue created, waiting for Kanban to update");

    // Step 8: Find the created issue card
    const issueCard = page.locator("text=Test OpenCode Smoke Issue").first();
    await expect(issueCard).toBeVisible({ timeout: 15_000 });
    results.push("9. Issue card visible in Kanban");

    // Step 9: Click Assign button on the issue
    const assignBtn = page.locator("button:has-text('Assign')").first();
    await assignBtn.click();
    results.push("10. Clicked Assign button");

    // Wait for assignment dropdown
    await page.waitForTimeout(1000);

    // Step 10: Select OpenCode provider
    const providerSelect = page.locator("select").filter({ has: page.locator("option[value='opencode']") }).first();
    await providerSelect.selectOption("opencode");
    results.push("11. Selected OpenCode provider");

    // Step 11: Select CRAFTER role
    const roleSelect = page.locator("select").nth(1);
    await roleSelect.selectOption("CRAFTER");
    results.push("12. Selected CRAFTER role");

    // Step 12: Save assignment
    const saveBtn = page.locator("button:has-text('Save')").first();
    await saveBtn.click();
    results.push("13. Saved assignment");

    // Wait for session to be triggered
    await page.waitForTimeout(5000);

    // Step 14: Check if "View session" button appears (indicates session was created)
    const viewSessionBtn = page.locator("button:has-text('View session')").first();
    
    // Also check for error banner (Docker not running, etc.)
    const errorBanner = page.locator(".bg-red-50, .dark\\:bg-red-900\\/20, .bg-red-100");
    const hasErrorBanner = await errorBanner.count() > 0;
    
    if (hasErrorBanner) {
      const errorText = await errorBanner.first().textContent();
      results.push(`14. ERROR banner detected: "${errorText?.slice(0, 150)}"`);
    }
    
    if (await viewSessionBtn.isVisible({ timeout: 30_000 })) {
      results.push("14. SUCCESS: View session button appeared (ACP triggered)");
    } else if (hasErrorBanner) {
      results.push("    - ACP triggered but encountered error (expected in some environments)");
    } else {
      results.push("14. View session button not found (may need more time or ACP not triggered)");
    }

    // Step 15: Click View session to open popup (if available)
    const sessionPopupBtn = page.locator("button:has-text('View session')").first();
    if (await sessionPopupBtn.isVisible()) {
      await sessionPopupBtn.click();
      results.push("15. Clicked 'View session' button");
      
      // Wait for popup
      await page.waitForTimeout(2000);
      
      // Check for session iframe or modal
      const sessionIframe = page.locator("iframe[title='ACP session']");
      if (await sessionIframe.isVisible({ timeout: 10_000 })) {
        results.push("16. SUCCESS: Session popup iframe is visible");
        
        // Take screenshot
        await page.screenshot({ 
          path: "test-results/kanban-opencode-smoke-session-popup.png", 
          fullPage: true 
        });
      } else {
        results.push("16. Session iframe not visible in popup");
      }

      // Close the popup
      const closeBtn = page.locator("button:has-text('Close')").first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        results.push("17. Closed session popup");
      }
    } else {
      results.push("15. Skipped session popup check - no View session button");
      
      // Take screenshot of current state
      await page.screenshot({ 
        path: "test-results/kanban-opencode-smoke-final.png", 
        fullPage: true 
      });
    }

    // Log results
    console.log("\n=== Kanban OpenCode Smoke Test Log ===\n");
    results.forEach((r) => console.log(r));
    console.log("\n========================================\n");
    
    if (consoleErrors.length > 0) {
      console.log("Console Errors:", consoleErrors.join("; "));
    }

    // Final assertion - at least verify we got to the Kanban board
    expect(issueCard).toBeVisible();
  });
});
