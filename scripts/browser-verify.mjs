#!/usr/bin/env node
/**
 * One-off browser verification for http://127.0.0.1:3210
 * Takes screenshot and reports on UI elements.
 */
import { chromium } from "playwright";

const URL = "http://127.0.0.1:3210";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setViewportSize({ width: 1920, height: 1080 });

  const consoleLogs = [];
  page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(2000);

    // Screenshot
    await page.screenshot({ path: "test-results/browser-verify-screenshot.png", fullPage: true });
    console.log("Screenshot saved to test-results/browser-verify-screenshot.png");

    // Check elements
    const hasHeader = await page.locator("header").isVisible();
    const hasRouta = await page.locator("header span").filter({ hasText: "Routa" }).isVisible();
    const hasProvider = await page.locator("label:has-text('Provider')").isVisible();
    const hasSessions = await page.locator("text=Sessions").first().isVisible();
    const hasSkills = await page.locator("text=Skills").first().isVisible();
    const hasAside = await page.locator("aside").first().isVisible();
    const hasMain = await page.locator("main").isVisible();

    // Check for visible error messages
    const errorElements = await page.locator('[role="alert"], .error, .text-red-500, [class*="error"]').all();
    let visibleErrors = [];
    for (const el of errorElements) {
      if (await el.isVisible()) {
        visibleErrors.push(await el.textContent());
      }
    }

    const consoleErrors = consoleLogs.filter((l) => l.type === "error");

    console.log("\n--- REPORT ---");
    console.log("1. Page loads correctly:", hasHeader && hasRouta ? "YES" : "NO");
    console.log("2. Routa UI (header, sidebar, main):", hasHeader && hasAside && hasMain ? "YES" : "NO");
    console.log("3. Sidebar sections:");
    console.log("   - Provider:", hasProvider ? "YES" : "NO");
    console.log("   - Sessions:", hasSessions ? "YES" : "NO");
    console.log("   - Skills:", hasSkills ? "YES" : "NO");
    console.log("4. Visible error messages:", visibleErrors.length ? visibleErrors : "None");
    console.log("5. Console errors:", consoleErrors.length ? consoleErrors : "None");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
