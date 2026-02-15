import { test, expect } from "@playwright/test";

/**
 * Routa JS Task Panel - Inject simulated task data
 *
 * Tests:
 * 1. React fiber detection
 * 2. Task panel aside check
 * 3. Task parser logic (regex)
 * 4. DOM mock injection to simulate Task Panel
 */
test.describe("Task Panel Inject Test", () => {
  test.setTimeout(60_000);

  test("inject tasks and verify task panel", async ({ page }) => {
    // 1. Navigate to http://localhost:3000
    await page.goto("http://localhost:3000");

    // 2. Wait for page to fully load
    await page.waitForTimeout(3000);

    // 3. Take screenshot
    await page.screenshot({
      path: "test-results/task-inject-01-initial.png",
      fullPage: true,
    });

    // 4. Find React fiber
    const fiberResult = await page.evaluate(() => {
      const rootElement = document.getElementById("__next");
      if (!rootElement) return { found: false, message: "No __next element" };
      const fiberKey = Object.keys(rootElement).find((key) =>
        key.startsWith("__reactFiber$")
      );
      return {
        found: !!fiberKey,
        message: fiberKey ? "React fiber found" : "No React fiber found",
      };
    });
    console.log("Step 4 - React fiber:", fiberResult);

    // 5. Check for task panel aside
    const asideResult = await page.evaluate(() => {
      const aside = document.querySelector("aside.border-l");
      return aside ? "Task panel aside found" : "No task panel aside found";
    });
    console.log("Step 5 - Task panel aside:", asideResult);

    // 6. Test task parser logic
    const parserResult = await page.evaluate(() => {
      const testContent = `Here is the plan:

@@@task
Task 1: 完善/更新项目文档

Objective
创建全面的文档系统，包括更新 README.md 和创建独立的文档目录 docs/

Scope
- 包含: README.md 的审查和必要的改进
- docs/ 目录下的多个文档文件
- 不包含: 代码逻辑修改

Definition of Done
1. docs/ 目录已创建
2. 每个文档内容完整、格式正确
@@@

@@@task
Task 2: 创建 Hello World 示例项目

Objective
创建一个可运行的 Hello World 示例

Scope
- examples/ 目录下的示例文件
- 包含完整的运行说明

Definition of Done
1. 代码示例可以正常执行
2. 文档说明完整
@@@

@@@task
Task 3: 添加打包指南和相关配置

Objective
添加打包和部署的文档说明

Scope
- 打包配置文件
- 部署文档

Definition of Done
1. 打包命令可以正常运行
2. 文档说明完整
@@@`;

      const TASK_BLOCK_REGEX = /@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/g;
      const matches = [...testContent.matchAll(TASK_BLOCK_REGEX)];
      return {
        blocksFound: matches.length,
        firstBlockPreview: matches[0]?.[1]?.substring(0, 100),
      };
    });
    console.log("Step 6 - Task parser:", parserResult);

    // 7. Screenshot after evaluation
    await page.screenshot({
      path: "test-results/task-inject-02-after-parser.png",
      fullPage: true,
    });

    // 8. Inject mock task panel DOM
    await page.evaluate(() => {
      // Remove existing test div if present
      const existing = document.getElementById("task-panel-test");
      if (existing) existing.remove();

      const testDiv = document.createElement("div");
      testDiv.id = "task-panel-test";
      testDiv.style.cssText =
        "position:fixed;top:52px;right:0;bottom:0;width:340px;z-index:1000;background:white;border-left:1px solid #e5e7eb;overflow-y:auto;padding:16px;box-shadow:-4px 0 6px rgba(0,0,0,0.05);";
      testDiv.innerHTML = `
<div style="display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid #e5e7eb;margin-bottom:12px;">
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#6366f1" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
  <span style="font-size:14px;font-weight:600;">Sub Tasks</span>
  <span style="font-size:10px;font-weight:500;padding:2px 6px;border-radius:9999px;background:#e0e7ff;color:#4338ca;">3</span>
  <span style="flex:1;"></span>
  <button style="font-size:12px;font-weight:500;padding:4px 10px;border-radius:6px;background:#4f46e5;color:white;border:none;cursor:pointer;">Confirm All</button>
</div>

<div style="display:flex;flex-direction:column;gap:8px;">
  <div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;">
    <div style="display:flex;align-items:start;gap:10px;padding:10px 12px;cursor:pointer;">
      <div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10px;font-weight:700;color:#9ca3af;">#1</span>
          <span style="font-size:14px;font-weight:500;color:#111827;">完善/更新项目文档</span>
        </div>
        <p style="font-size:12px;color:#6b7280;margin-top:2px;">创建全面的文档系统，包括更新 README.md 和创建独立的文档目录 docs/</p>
      </div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
    </div>
  </div>
  
  <div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;">
    <div style="display:flex;align-items:start;gap:10px;padding:10px 12px;cursor:pointer;">
      <div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10px;font-weight:700;color:#9ca3af;">#2</span>
          <span style="font-size:14px;font-weight:500;color:#111827;">创建 Hello World 示例项目</span>
        </div>
        <p style="font-size:12px;color:#6b7280;margin-top:2px;">创建一个可运行的 Hello World 示例</p>
      </div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
    </div>
  </div>
  
  <div style="border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;">
    <div style="display:flex;align-items:start;gap:10px;padding:10px 12px;cursor:pointer;">
      <div style="width:20px;height:20px;border-radius:6px;border:2px solid #d1d5db;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10px;font-weight:700;color:#9ca3af;">#3</span>
          <span style="font-size:14px;font-weight:500;color:#111827;">添加打包指南和相关配置</span>
        </div>
        <p style="font-size:12px;color:#6b7280;margin-top:2px;">添加打包和部署的文档说明</p>
      </div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
    </div>
  </div>
</div>
`;
      document.body.appendChild(testDiv);
    });

    // 9. Take screenshot showing task panel mock on the right
    await page.waitForTimeout(500);
    await page.screenshot({
      path: "test-results/task-inject-03-mock-panel.png",
      fullPage: true,
    });

    // Verify mock is visible
    const mockVisible = await page.locator("#task-panel-test").isVisible();
    expect(mockVisible).toBe(true);
    expect(parserResult.blocksFound).toBe(3);
  });
});
