import { expect, test, type Page, type Response } from "@playwright/test";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const NEXT_DEV_RECOVERY_TEXT = "missing required error components, refreshing...";
const WORKSPACE_DEFAULT = "workspaceId=default";
const ROUTE_RESPONSE_PATTERNS: Record<string, string[]> = {
  "/workspace/default": [
    `/api/sessions?${WORKSPACE_DEFAULT}`,
    `/api/tasks?${WORKSPACE_DEFAULT}`,
    `/api/kanban/boards?${WORKSPACE_DEFAULT}`,
  ],
  "/workspace/default/kanban": [
    `/api/kanban/boards?${WORKSPACE_DEFAULT}`,
    `/api/tasks?${WORKSPACE_DEFAULT}`,
    `/api/sessions?${WORKSPACE_DEFAULT}`,
  ],
};

function createRouteResponseWaiters(page: Page, path: string): Array<Promise<unknown>> {
  const optionalResponse = (matcher: (response: Response) => boolean) =>
    page.waitForResponse(matcher, { timeout: 20_000 }).catch(() => null);
  const patterns = ROUTE_RESPONSE_PATTERNS[path] ?? (path.startsWith("/traces") ? ["/api/traces", "/api/sessions"] : []);

  return patterns.map((pattern) => optionalResponse((response) => response.url().includes(pattern)));
}

async function waitForDesktopShell(page: Page) {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="desktop-shell-root"]') ||
      document.querySelector('[data-testid="kanban-page-header"]') ||
      document.querySelector('[data-testid="traces-page-header"]') ||
      document.querySelector('[data-testid="workspace-tab-bar"]'),
    ),
    undefined,
    { timeout: 20_000 },
  );
}

async function openDesktopRoute(page: Page, path: string, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const routeResponses = createRouteResponseWaiters(page, path);
  let shellReady = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 0) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    } else {
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    const bodyText = (await page.locator("body").textContent()) ?? "";
    if (bodyText.includes(NEXT_DEV_RECOVERY_TEXT)) {
      await page.waitForTimeout(1500);
      continue;
    }

    try {
      await waitForDesktopShell(page);
      shellReady = true;
      break;
    } catch {
      const retryBodyText = (await page.locator("body").textContent()) ?? "";
      if (!retryBodyText.includes(NEXT_DEV_RECOVERY_TEXT)) {
        throw new Error(`desktop shell did not become ready for ${path}`);
      }
      await page.waitForTimeout(1500);
    }
  }

  if (!shellReady) {
    throw new Error(`desktop shell never became ready for ${path}`);
  }

  await Promise.allSettled(routeResponses);
  await page.waitForLoadState("networkidle").catch(() => null);

  if (path.includes("/kanban")) {
    await page.getByTestId("kanban-page-header").waitFor({ state: "visible", timeout: 20_000 });
  }

  await page.waitForTimeout(1000);
  await page.addStyleTag({
    content: `
      [data-testid="workspace-tab-count"],
      [data-testid="kanban-task-count"],
      [data-testid="traces-selected-session"],
      [data-testid="traces-page-header"] > div:last-child {
        visibility: hidden !important;
      }

      [data-testid="desktop-shell-header"] .lg\\:flex {
        visibility: hidden !important;
      }

      [data-testid="kanban-page-header"] > div > div:last-child {
        visibility: hidden !important;
      }

      [data-radix-popper-content-wrapper] {
        visibility: hidden !important;
      }
    `,
  });
}

test.describe("Desktop Shell Visual Regression", () => {
  test.setTimeout(60_000);

  for (const colorScheme of ["light", "dark"] as const) {
    test(`workspace shell chrome (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/workspace/default", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("desktop-shell-header")).toHaveScreenshot(
        `workspace-shell-header-${colorScheme}.png`,
        { animations: "disabled", maxDiffPixels: 250, timeout: 15_000 },
      );
      await expect(page.getByTestId("desktop-shell-sidebar")).toHaveScreenshot(
        `workspace-shell-sidebar-${colorScheme}.png`,
        { animations: "disabled", timeout: 15_000 },
      );
    });

    test(`kanban page header (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/workspace/default/kanban", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("kanban-page-header")).toHaveScreenshot(
        `kanban-page-header-${colorScheme}.png`,
        { animations: "disabled", timeout: 15_000 },
      );
    });

    test(`traces shell chrome (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/traces?sessionId=none", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("traces-page-header")).toHaveScreenshot(
        `traces-page-header-${colorScheme}.png`,
        { animations: "disabled", maxDiffPixels: 400, timeout: 15_000 },
      );
      await expect(page.getByTestId("traces-view-tabs")).toHaveScreenshot(
        `traces-view-tabs-${colorScheme}.png`,
        { animations: "disabled", timeout: 15_000 },
      );
    });
  }
});
