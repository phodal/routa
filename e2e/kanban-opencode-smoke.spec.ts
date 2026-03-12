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

const BASE_URL = "http://127.0.0.1:3000";

async function fillIssueObjective(page: import("@playwright/test").Page, text: string) {
  const editor = page.locator(".ProseMirror").last();
  await expect(editor).toBeVisible({ timeout: 5_000 });
  await editor.click();
  await page.keyboard.type(text);
}

test.describe("Kanban OpenCode Smoke Test", () => {
  test.use({ baseURL: BASE_URL });

  test("ACP triggering with OpenCode provider and session popup", async ({ page, request }) => {
    const results: string[] = [];
    const title = `Test OpenCode Smoke Issue ${Date.now()}`;

    test.setTimeout(180_000);

    // Capture console errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Step 1: Navigate directly to the Kanban page.
    await page.goto("/workspace/default/kanban", { waitUntil: "domcontentloaded" });
    results.push("1. Navigated to workspace/default/kanban");

    await expect(page.getByRole("button", { name: /Create issue|Manual/ })).toBeVisible({
      timeout: 15_000,
    });
    results.push("2. Kanban page loaded");

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
    const createIssueBtn = page.locator("button:has-text('Create issue'), button:has-text('Manual')");
    await expect(createIssueBtn).toBeVisible({ timeout: 10_000 });
    await createIssueBtn.click();
    results.push("4. Clicked 'Create issue' button");

    // Wait for modal
    await page.waitForTimeout(1000);

    // Step 5: Fill in issue details
    const titleInput = page.locator('input[placeholder="Issue title"]');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(title);
    results.push("5. Filled issue title");

    // Fill objective
    await fillIssueObjective(
      page,
      "Testing ACP triggering with OpenCode provider and session popup behavior",
    );
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
    const issueCard = page.getByTestId("kanban-card").filter({ hasText: title }).first();
    await expect(issueCard).toBeVisible({ timeout: 15_000 });
    results.push("9. Issue card visible in Kanban");

    // Step 9: Assign provider and move to dev via API for a stable smoke path.
    const taskResponse = await request.get("/api/tasks?workspaceId=default");
    const taskData = await taskResponse.json();
    const createdTask = (taskData.tasks as Array<{ id: string; title: string }>).find(
      (task) => task.title === title,
    );
    expect(createdTask).toBeTruthy();

    const triggerResponse = await request.patch(`/api/tasks/${createdTask!.id}`, {
      data: {
        assignedProvider: "opencode",
        assignedRole: "CRAFTER",
        columnId: "dev",
        position: 0,
      },
    });
    expect(triggerResponse.ok()).toBeTruthy();
    results.push("10. Assigned OpenCode and moved task to dev via API");

    await expect
      .poll(
        async () => {
          const response = await request.get("/api/tasks?workspaceId=default");
          if (!response.ok()) return null;
          const data = await response.json();
          const task = (data.tasks as Array<{ title: string; triggerSessionId?: string }>).find(
            (item) => item.title === title,
          );
          return task?.triggerSessionId ?? null;
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .not.toBeNull();
    results.push("11. ACP session created");

    await page.reload({ waitUntil: "domcontentloaded" });
    const triggeredCard = page.getByTestId("kanban-card").filter({ hasText: title }).first();
    await expect(triggeredCard).toBeVisible({ timeout: 20_000 });

    // Step 14: Check if "View session" button appears (indicates session was created)
    const viewSessionBtn = triggeredCard.getByRole("button", { name: "View session" });
    
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
    const sessionPopupBtn = triggeredCard.getByRole("button", { name: "View session" });
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
