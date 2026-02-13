import { test, expect } from "@playwright/test";

test.describe("ACP Chat with OpenCode", () => {
  test("full flow: connect → new session → send message → streaming response", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto("http://localhost:3000");
    await expect(page.locator("h1")).toHaveText("Routa");

    // Step 1: Connect
    const connectBtn = page.getByRole("button", { name: "Connect" });
    await connectBtn.click();
    await expect(
      page.getByRole("button", { name: "Disconnect" })
    ).toBeVisible({ timeout: 10_000 });

    // Step 2: New session
    await page.getByRole("button", { name: "New" }).click();
    const input = page.getByPlaceholder("Type a message...");
    await expect(input).toBeEnabled({ timeout: 30_000 });

    // Step 3: Send message
    await input.fill("What is 2+3? Answer just the number.");
    await input.press("Enter");

    // Step 4: Verify user message appears
    await expect(page.locator("text=What is 2+3?")).toBeVisible({
      timeout: 5_000,
    });

    // Step 5: Wait for assistant response (gray bubble, not thought/system)
    await page.waitForFunction(
      () => {
        const bubbles = document.querySelectorAll(
          ".bg-gray-100.rounded-2xl"
        );
        for (const b of bubbles) {
          const text = (b.textContent || "").trim();
          if (text.length > 0) return true;
        }
        return false;
      },
      { timeout: 60_000 }
    );

    // Step 6: Verify thought bubble exists and is collapsible
    const thoughtBubbles = page.locator("text=Thinking").first();
    // Thought may or may not appear depending on model - check if it exists
    const hasThought = (await thoughtBubbles.count()) > 0;
    if (hasThought) {
      // Thought label should be visible
      await expect(thoughtBubbles).toBeVisible();
      // The thought content should be constrained (max-h class)
      const thoughtContent = page.locator(
        ".bg-purple-50, .dark\\:bg-purple-900\\/20"
      ).first();
      if ((await thoughtContent.count()) > 0) {
        // Should have max-height constraint (collapsed by default)
        const classList = await thoughtContent.getAttribute("class");
        expect(classList).toContain("max-h-");
      }
    }

    // Step 7: Verify usage badge appears
    const usageBadge = page.locator("text=tokens");
    await expect(usageBadge.first()).toBeVisible({ timeout: 10_000 });

    // Take screenshot
    await page.screenshot({
      path: "test-results/acp-chat-final.png",
      fullPage: true,
    });

    // Log the result
    const assistantBubbles = page.locator(".bg-gray-100.rounded-2xl");
    const count = await assistantBubbles.count();
    for (let i = 0; i < count; i++) {
      const text = await assistantBubbles.nth(i).textContent();
      console.log(`Assistant bubble ${i}: ${text?.slice(0, 200)}`);
    }
    expect(count).toBeGreaterThan(0);
  });
});
