import { test, expect } from "@playwright/test";

/**
 * Task Panel Mock - Visual verification
 * Navigate, inject mock, take snapshots
 */
test.describe("Task Panel Mock Visual", () => {
  test.setTimeout(30_000);

  test("inject mock task panel and capture layout", async ({ page }) => {
    // 1. Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");

    // 2. Wait 3 seconds for page to load
    await page.waitForTimeout(3000);

    // 3. Take snapshot first
    await page.screenshot({
      path: "test-results/task-mock-01-before.png",
      fullPage: true,
    });

    // 4. Inject mock task panel
    await page.evaluate(() => {
      const existing = document.getElementById("task-panel-test");
      if (existing) existing.remove();

      const testDiv = document.createElement("div");
      testDiv.id = "task-panel-test";
      testDiv.style.cssText =
        "position:fixed;top:52px;right:0;bottom:0;width:340px;z-index:1000;background:white;border-left:1px solid #e5e7eb;overflow-y:auto;";
      testDiv.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e5e7eb;"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#6366f1" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg><span style="font-size:14px;font-weight:600;">Sub Tasks</span><span style="font-size:10px;font-weight:500;padding:2px 6px;border-radius:9999px;background:#e0e7ff;color:#4338ca;">3</span><span style="flex:1;"></span><button style="font-size:12px;font-weight:500;padding:4px 10px;border-radius:6px;background:#4f46e5;color:white;border:none;cursor:pointer;">Confirm All</button></div><div style="padding:12px;display:flex;flex-direction:column;gap:8px;"><div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;"><div style="display:flex;align-items:start;gap:10px;padding:10px 12px;"><div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:10px;font-weight:700;color:#9ca3af;">#1</span><span style="font-size:14px;font-weight:500;color:#111827;">完善/更新项目文档</span></div><p style="font-size:12px;color:#6b7280;margin-top:2px;">创建全面的文档系统，包括更新 README.md 和创建独立的文档目录</p></div><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg></div></div><div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;"><div style="display:flex;align-items:start;gap:10px;padding:10px 12px;"><div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:10px;font-weight:700;color:#9ca3af;">#2</span><span style="font-size:14px;font-weight:500;color:#111827;">创建 Hello World 示例项目</span></div><p style="font-size:12px;color:#6b7280;margin-top:2px;">创建一个可运行的 Hello World 示例</p></div><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg></div></div><div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;"><div style="display:flex;align-items:start;gap:10px;padding:10px 12px;"><div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:10px;font-weight:700;color:#9ca3af;">#3</span><span style="font-size:14px;font-weight:500;color:#111827;">添加打包指南和相关配置</span></div><p style="font-size:12px;color:#6b7280;margin-top:2px;">添加打包和部署的文档说明</p></div><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg></div></div></div>';
      document.body.appendChild(testDiv);
    });

    // 5. Take snapshot showing full page with mock task panel
    await page.waitForTimeout(300);
    await page.screenshot({
      path: "test-results/task-mock-02-with-panel.png",
      fullPage: true,
    });

    await expect(page.locator("#task-panel-test")).toBeVisible();
  });
});
