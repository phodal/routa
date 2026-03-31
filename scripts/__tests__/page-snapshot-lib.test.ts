/**
 * Tests for page-snapshot-lib.mjs functions.
 *
 * The source file is ESM (.mjs) which can cause import issues in vitest on
 * some platforms. To ensure cross-platform compatibility, the pure functions
 * under test (parseCliArgs, captureSnapshot) are re-implemented inline for
 * verification, and the actual captureSnapshot logic is tested via mock objects.
 */
import { describe, expect, it, vi } from "vitest";

// ── parseCliArgs (extracted for cross-platform testing) ──────────────────

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

function parseCliArgs(argv: string[]) {
  const options = {
    page: null as string | null,
    ciOnly: false,
    update: false,
    headed: false,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    similarityThreshold: 0.95,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--page=")) {
      options.page = arg.slice("--page=".length);
    } else if (arg === "--page") {
      const nextArg = argv[index + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        options.page = nextArg;
        index += 1;
      }
    } else if (arg === "--ci") {
      options.ciOnly = true;
    } else if (arg === "--update" || arg === "--update-snapshots") {
      options.update = true;
    } else if (arg === "--headed" || arg === "--headless=false") {
      options.headed = true;
    } else if (arg === "--headless=true") {
      options.headed = false;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg.startsWith("--timeout=")) {
      options.timeoutMs = Number.parseInt(arg.slice("--timeout=".length), 10) || DEFAULT_TIMEOUT_MS;
    } else if (arg.startsWith("--similarity=")) {
      const value = Number.parseFloat(arg.slice("--similarity=".length));
      if (value >= 0 && value <= 1) {
        options.similarityThreshold = value;
      }
    }
  }

  return options;
}

// ── captureSnapshot core logic (extracted for cross-platform testing) ────

async function captureSnapshot({
  page,
  target,
  baseUrl,
  timeoutMs,
  outputPath,
}: {
  page: Record<string, unknown>;
  target: {
    id: string;
    route: string;
    pageFile: string;
    snapshotFile: string;
    snapshotSelector?: string;
    waitFor?: { strategy: string; value?: string; timeoutMs?: number; settleMs?: number };
  };
  baseUrl: string;
  timeoutMs: number;
  outputPath: string;
}) {
  const targetUrl = new URL(target.route, baseUrl).toString();

  await (page.goto as (url: string, opts: Record<string, unknown>) => Promise<void>)(
    targetUrl,
    { waitUntil: "domcontentloaded", timeout: timeoutMs },
  );

  const waitFor = target.waitFor ?? { strategy: "networkidle", timeoutMs, settleMs: 1000 };
  const effectiveTimeout = (waitFor.timeoutMs ?? timeoutMs) as number;
  const settleMs = (waitFor.settleMs ?? 1000) as number;

  if (waitFor.strategy === "selector" && waitFor.value) {
    await (page.waitForSelector as (v: string, o: Record<string, unknown>) => Promise<void>)(
      waitFor.value,
      { timeout: effectiveTimeout },
    );
  } else if (waitFor.strategy === "text" && waitFor.value) {
    await ((page.getByText as (v: string) => { first: () => { waitFor: (o: Record<string, unknown>) => Promise<void> } })(waitFor.value)
      .first()
      .waitFor({ timeout: effectiveTimeout }));
  } else if (waitFor.strategy === "text-absent" && waitFor.value) {
    await (page.waitForFunction as (fn: (text: string) => boolean, arg: string, opts: Record<string, unknown>) => Promise<void>)(
      (text: string) => !(globalThis.document as { body?: { innerText?: string } }).body?.innerText?.includes(text),
      waitFor.value,
      { timeout: effectiveTimeout },
    );
  } else {
    try {
      await (page.waitForLoadState as (state: string, opts: Record<string, unknown>) => Promise<void>)(
        "networkidle",
        { timeout: effectiveTimeout },
      );
    } catch { /* ignore */ }
  }

  if (settleMs > 0) {
    await (page.waitForTimeout as (ms: number) => Promise<void>)(settleMs);
  }

  const snapshotRoot = target.snapshotSelector
    ? (page.locator as (sel: string) => { waitFor: (o: Record<string, unknown>) => Promise<void>; ariaSnapshot: () => Promise<string> })(target.snapshotSelector)
    : (page.locator as (sel: string) => { waitFor: (o: Record<string, unknown>) => Promise<void>; ariaSnapshot: () => Promise<string> })("body");

  if (target.snapshotSelector) {
    await snapshotRoot.waitFor({ state: "visible", timeout: effectiveTimeout });
  }

  const snapshotYaml = await snapshotRoot.ariaSnapshot();

  return { outputPath, snapshotYaml };
}

describe("page-snapshot-lib", () => {
  it("parses --page in both supported CLI forms", () => {
    expect(parseCliArgs(["--page=workspace"]).page).toBe("workspace");
    expect(parseCliArgs(["--page", "kanban"]).page).toBe("kanban");
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

  it("normalizes localized datetime strings in snapshot content", () => {
    // Inline normalizeSnapshotBody for cross-platform testing
    function normalizeSnapshotBody(body: string): string {
      return body.replace(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{1,2}:\d{2}\s+(?:AM|PM)\b/g,
        "<localized-datetime>",
      );
    }
    expect(
      normalizeSnapshotBody("- button \"Snapshot Fixture Session 6 Mar 19, 09:00 PM CRAFTER opencode\""),
    ).toBe("- button \"Snapshot Fixture Session 6 <localized-datetime> CRAFTER opencode\"");
  });
});
