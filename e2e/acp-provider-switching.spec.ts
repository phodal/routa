import { test, expect } from "@playwright/test";

/**
 * ACP Provider Switching Verification
 *
 * Verifies that:
 * 1) ACP Provider dropdown exists and lists options
 * 2) Connect works
 * 3) Selecting "opencode" and clicking New creates a session with provider label
 * 4) Switching to "gemini" and clicking New - captures success or error
 */
test.describe("ACP Provider Switching", () => {
  test("verify provider dropdown, connect, create opencode session, switch to gemini", async ({
    page,
  }) => {
    // Capture console errors and failed requests for debugging
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });
    test.setTimeout(120_000);

    const results: string[] = [];

    // Step 1: Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");
    results.push("1. Navigated to http://localhost:3000");

    await expect(page.locator("h1")).toHaveText("Routa");
    results.push("   - Page title 'Routa' confirmed");

    // Step 2: Confirm ACP Provider dropdown exists and list visible options
    const providerLabel = page.locator("label:has-text('ACP Provider')");
    await expect(providerLabel).toBeVisible();
    results.push("2. ACP Provider label visible");

    // ACP Provider select is in the Sessions panel (has "Sessions" heading and "ACP Provider" label)
    const providerSelect = page.locator("div:has(h2:has-text('Sessions'))").locator("select").first();
    await expect(providerSelect).toBeVisible();
    results.push("   - ACP Provider dropdown (select) exists");

    // Before Connect, providers may be empty - need to Connect first to load providers
    const connectBtn = page.getByRole("button", { name: "Connect" });
    await expect(connectBtn).toBeVisible();
    results.push("   - Connect button visible");

    // Step 3: Click Connect
    await connectBtn.click();
    // Wait for Connect to complete - success = Disconnect button OR providers loaded
    const disconnectBtn = page.getByRole("button", { name: "Disconnect" });
    const errorBannerEarly = page.locator(".bg-red-50, .dark\\:bg-red-900\\/20");
    const opencodeOption = providerSelect.locator('option[value="opencode"]');
    await Promise.race([
      disconnectBtn.waitFor({ state: "visible", timeout: 25_000 }),
      errorBannerEarly.first().waitFor({ state: "visible", timeout: 25_000 }),
      opencodeOption.waitFor({ state: "visible", timeout: 25_000 }),
    ]).catch(() => {});
    const connected = await disconnectBtn.isVisible();
    const hasError = (await errorBannerEarly.count()) > 0 && (await errorBannerEarly.first().isVisible());
    if (connected) {
      results.push("3. Clicked Connect - Disconnect button now visible (connected)");
    } else if (hasError) {
      const errText = (await errorBannerEarly.first().textContent())?.trim() ?? "";
      results.push(`3. Connect FAILED. Error: "${errText}"`);
      if (consoleErrors.length) results.push(`   Console errors: ${consoleErrors.join("; ")}`);
    } else {
      results.push("3. Connect timed out - Disconnect never appeared, no error banner");
      if (consoleErrors.length) results.push(`   Console errors: ${consoleErrors.join("; ")}`);
      if (failedRequests.length) results.push(`   Failed requests: ${failedRequests.join("; ")}`);
    }

    // Now get provider options (from ACP Provider dropdown)
    const options = providerSelect.locator("option");
    const optionCount = await options.count();
    const optionTexts: string[] = [];
    for (let i = 0; i < optionCount; i++) {
      const text = await options.nth(i).textContent();
      if (text && text !== "No providers") optionTexts.push(text.trim());
    }
    results.push(`   - Provider options (${optionCount}): ${optionTexts.join(", ")}`);

    if (!connected) {
      results.push("BLOCKING: Cannot proceed - Connect did not succeed.");
      console.log("\n=== ACP Provider Switching Verification Log ===\n");
      results.forEach((r) => console.log(r));
      console.log("\n================================================\n");
      expect(connected).toBe(true);
    }

    // Step 4: Select provider "opencode" and click New
    await providerSelect.selectOption({ value: "opencode" });
    results.push("4. Selected provider 'opencode'");

    const newBtn = page.getByRole("button", { name: "New" });
    await newBtn.click();
    results.push("   - Clicked New");

    // Wait for session to appear (input enabled or session list has items)
    const sessionList = page.locator('[class*="divide-y"]').first();
    await page.waitForTimeout(2000);

    // Step 5: Verify session appears with provider label "opencode"
    // (Provider label is in session list item, not the select option - use blue text class)
    const opencodeLabel = page.locator('[class*="text-blue-500"], [class*="text-blue-400"]').filter({ hasText: "opencode" });
    await expect(opencodeLabel.first()).toBeVisible({ timeout: 15_000 });
    results.push("5. Session appears with provider label 'opencode'");

    const sessionCount = await page.locator('div:has(h2:has-text("Sessions"))').locator('button:has(span:has-text("ACTIVE"))').count();
    results.push(`   - Session count in list: ${sessionCount}`);

    // Step 6: Switch provider dropdown to "gemini" and click New
    await providerSelect.selectOption({ value: "gemini" });
    results.push("6. Switched provider dropdown to 'gemini'");

    await newBtn.click();
    results.push("   - Clicked New (for gemini session)");

    // Step 7: Capture what happens - wait a few seconds
    await page.waitForTimeout(5000);

    // Error banner: Chat panel shows errors in div with px-5 py-2 bg-red-50 (exclude Disconnect button)
    const errorBanner = page.locator("div.px-5.py-2.bg-red-50, div.px-5.py-2.dark\\:bg-red-900\\/20");
    const hasErrorBanner = (await errorBanner.count()) > 0;
    let errorText = "";

    if (hasErrorBanner) {
      errorText = (await errorBanner.first().textContent())?.trim() ?? "";
      results.push(`7. ERROR appeared: "${errorText}"`);
    } else {
      // Check if gemini session was created
      const geminiLabel = page.locator("text=gemini").first();
      const geminiVisible = await geminiLabel.isVisible();
      if (geminiVisible) {
        results.push("7. SUCCESS - gemini session created (provider label visible)");
      } else {
        results.push("7. No error banner; gemini session label not found (gemini CLI may not be installed)");
      }
    }

    // Log results
    console.log("\n=== ACP Provider Switching Verification Log ===\n");
    results.forEach((r) => console.log(r));
    console.log("\n================================================\n");

    // Assert: at least opencode session was created
    expect(sessionCount).toBeGreaterThanOrEqual(1);

    // If error occurred, record it for the report
    if (errorText) {
      expect(errorText.length).toBeGreaterThan(0);
    }
  });
});
