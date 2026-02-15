import { test, expect } from "@playwright/test";

/**
 * Task Panel with MarkdownViewer styles - Visual verification
 */
test.describe("Task Panel MarkdownViewer Styles", () => {
  test.setTimeout(30_000);

  test("inject styled task panel with markdown content", async ({ page }) => {
    await page.goto("http://localhost:3000");
    await page.waitForTimeout(3000);

    // Snapshot before
    await page.screenshot({
      path: "test-results/task-markdown-01-before.png",
      fullPage: true,
    });

    // Inject task panel with MarkdownViewer styles
    await page.evaluate(() => {
      const existing = document.getElementById("task-panel-markdown-test");
      if (existing) existing.remove();

      const aside = document.createElement("aside");
      aside.id = "task-panel-markdown-test";
      aside.className =
        "w-[340px] shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col overflow-hidden";
      aside.style.cssText =
        "position:fixed;top:52px;right:0;bottom:0;width:340px;z-index:1000;";

      aside.innerHTML = `
<div class="flex flex-col h-full">
  <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <svg class="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
      <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Sub Tasks</span>
      <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">3</span>
    </div>
    <div class="flex items-center gap-1.5">
      <button class="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">Confirm All</button>
      <button class="text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white">Execute All</button>
    </div>
  </div>
  <div class="flex-1 overflow-y-auto p-3 space-y-2">
    <div class="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10">
      <div class="flex items-start gap-2.5 px-3 py-2.5">
        <div class="w-5 h-5 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
          <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold text-gray-400">#1</span>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">完善/更新项目文档</span>
          </div>
        </div>
      </div>
      <div class="px-3 pb-3 border-t border-blue-100 dark:border-blue-800/50">
        <div class="mt-2.5 space-y-2.5 text-xs">
          <div>
            <h4 class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Objective</h4>
            <div class="markdown-viewer text-gray-600 dark:text-gray-300">
              <p>创建全面的文档系统，包括：</p>
              <ul style="list-style:disc;padding-left:1.25rem;margin:0.25rem 0;">
                <li>更新 <strong>README.md</strong></li>
                <li>创建独立的文档目录 <code style="background:rgba(0,0,0,0.06);padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:monospace;font-size:0.85em;">docs/</code></li>
                <li>添加 API 使用文档、配置说明、开发指南</li>
              </ul>
            </div>
          </div>
          <div>
            <h4 class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Scope</h4>
            <div class="markdown-viewer text-gray-600 dark:text-gray-300">
              <ul style="list-style:disc;padding-left:1.25rem;margin:0.25rem 0;">
                <li>包含: <code style="background:rgba(0,0,0,0.06);padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:monospace;font-size:0.85em;">getting-started.md</code> 快速开始指南</li>
                <li>包含: <code style="background:rgba(0,0,0,0.06);padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:monospace;font-size:0.85em;">api-reference.md</code> API 参考</li>
                <li>不包含: 代码逻辑修改、测试代码编写</li>
              </ul>
            </div>
          </div>
          <div>
            <h4 class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Definition of Done</h4>
            <div class="markdown-viewer text-gray-600 dark:text-gray-300">
              <ol style="list-style:decimal;padding-left:1.25rem;margin:0.25rem 0;">
                <li><code style="background:rgba(0,0,0,0.06);padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:monospace;font-size:0.85em;">docs/</code> 目录已创建，包含所有计划的文档文件</li>
                <li>每个文档内容完整、格式正确</li>
                <li>代码示例可以正常执行</li>
              </ol>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 mt-3 pt-2.5 border-t border-blue-100 dark:border-blue-800/50">
          <button class="text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white">Execute</button>
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
      <div class="flex items-start gap-2.5 px-3 py-2.5">
        <div class="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold text-gray-400">#2</span>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">创建 Hello World 示例项目</span>
          </div>
          <p class="text-xs text-gray-500 mt-0.5 truncate">创建一个可运行的 Hello World 示例</p>
        </div>
        <svg class="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>

    <div class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
      <div class="flex items-start gap-2.5 px-3 py-2.5">
        <div class="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center flex-shrink-0" style="animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite">
          <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold text-gray-400">#3</span>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">添加打包指南和相关配置</span>
          </div>
          <p class="text-xs text-amber-600 mt-0.5">Running...</p>
        </div>
      </div>
    </div>
  </div>
</div>`;

      document.body.appendChild(aside);
    });

    await page.waitForTimeout(500);
    await page.screenshot({
      path: "test-results/task-markdown-02-with-panel.png",
      fullPage: true,
    });

    const panel = page.locator("#task-panel-markdown-test");
    await expect(panel).toBeVisible();
  });
});
