import { describe, expect, it, vi } from "vitest";
import {
  captureSnapshot,
  getSnapshotTargetsByIds,
  normalizeSnapshotBody,
  parseCliArgs,
  resolveManagedServerBaseUrl,
  waitForSnapshotTarget,
} from "../page-snapshot-lib.mjs";

describe("page-snapshot-lib", () => {
  it("parses --page in both supported CLI forms", () => {
    expect(parseCliArgs(["--page=workspace"]).page).toBe("workspace");
    expect(parseCliArgs(["--page", "kanban"]).page).toBe("kanban");
  });

  it("resolves configured targets by id", () => {
    expect(
      getSnapshotTargetsByIds(["home", "kanban"], [
        { id: "home", route: "/" },
        { id: "kanban", route: "/workspace/default/kanban" },
      ]),
    ).toEqual([
      { id: "home", route: "/" },
      { id: "kanban", route: "/workspace/default/kanban" },
    ]);
  });

  it("moves fixture-managed servers to a free port when the requested port is occupied", async () => {
    const managedBaseUrl = await resolveManagedServerBaseUrl("http://127.0.0.1:3000", vi.fn().mockResolvedValue(4010));

    expect(new URL(managedBaseUrl).hostname).toBe("127.0.0.1");
    expect(new URL(managedBaseUrl).port).toBe("4010");
  });

  it("waits for a configured snapshot selector before taking the aria snapshot", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const ariaSnapshot = vi.fn().mockResolvedValue("- text: Snapshot");
    const locator = vi.fn().mockReturnValue({
      waitFor,
      ariaSnapshot,
    });
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto,
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      getByText: vi.fn(),
      waitForFunction: vi.fn(),
      title: vi.fn().mockResolvedValue("Routa"),
      url: vi.fn().mockReturnValue("http://127.0.0.1:3000/workspace/default/kanban"),
      locator,
    };

    await captureSnapshot({
      page,
      target: {
        id: "kanban",
        route: "/workspace/default/kanban",
        pageFile: "src/app/workspace/[workspaceId]/kanban/page.tsx",
        snapshotFile: "tmp/page.snapshot.yaml",
        snapshotSelector: "[data-testid=\"kanban-board-content\"]",
        waitFor: {
          strategy: "text-absent",
          value: "worktree loading...",
          timeoutMs: 1234,
          settleMs: 0,
        },
      },
      baseUrl: "http://127.0.0.1:3000",
      timeoutMs: 3000,
      outputPath: "tmp/page.snapshot.yaml",
    });

    expect(goto).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/workspace/default/kanban",
      { waitUntil: "domcontentloaded", timeout: 3000 },
    );
    expect(locator).toHaveBeenCalledWith("[data-testid=\"kanban-board-content\"]");
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1234 });
    expect(ariaSnapshot).toHaveBeenCalledOnce();
  });

  it("supports text-absent wait strategies for dynamic pages", async () => {
    const page = {
      waitForLoadState: vi.fn(),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn(),
      getByText: vi.fn(),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    await waitForSnapshotTarget(page, {
      waitFor: {
        strategy: "text-absent",
        value: "worktree loading...",
        timeoutMs: 2345,
        settleMs: 50,
      },
    }, 3000);

    expect(page.waitForFunction).toHaveBeenCalledOnce();
    expect(page.waitForTimeout).toHaveBeenCalledWith(50);
  });

  it("normalizes localized datetime strings in snapshot content", () => {
    expect(
      normalizeSnapshotBody("- button \"Snapshot Fixture Session 6 Mar 19, 09:00 PM CRAFTER opencode\""),
    ).toBe("- button \"Snapshot Fixture Session 6 <localized-datetime> CRAFTER opencode\"");
  });
});
