#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { URL } from "node:url";
import { chromium } from "@playwright/test";

import { prepareSnapshotFixtures } from "./page-snapshot-fixtures.mjs";

export const ROOT_DIR = process.cwd();
export const REGISTRY_FILE = path.join(ROOT_DIR, "resources", "page-snapshot-registry.json");
export const DEFAULT_BASE_URL = process.env.PAGE_SNAPSHOT_BASE_URL || "http://127.0.0.1:3000";
export const DEFAULT_TIMEOUT_MS = 30000;
export const REPORT_FILE = path.join(ROOT_DIR, "test-results", "page-snapshot-report.json");
export const PLAYWRIGHT_ARTIFACTS_DIR = path.join(ROOT_DIR, ".playwright-snapshots");
export const SNAPSHOT_FIXTURES_ENABLED = process.env.PAGE_SNAPSHOT_USE_FIXTURES !== "0";

export function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
  const entries = JSON.parse(raw);

  if (!Array.isArray(entries)) {
    throw new Error("Page snapshot registry must be an array");
  }

  return entries;
}

export function getSnapshotTargetsByIds(ids, registry = loadRegistry()) {
  return ids.map((id) => {
    const target = registry.find((entry) => entry.id === id);
    if (!target) {
      throw new Error(`Missing page snapshot registry entry for "${id}"`);
    }
    return target;
  });
}

export function parseCliArgs(argv) {
  const options = {
    page: null,
    ciOnly: false,
    update: false,
    headed: false,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    similarityThreshold: 0.95, // 95% similarity required by default
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

export function selectSnapshotTargets(registry, options) {
  return registry.filter((target) => {
    if (options.page && target.id !== options.page) {
      return false;
    }

    if (options.ciOnly && !target.ci) {
      return false;
    }

    return true;
  });
}

export function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function ensureReportDir() {
  ensureParentDir(REPORT_FILE);
}

export function resolveWorkspacePath(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

export async function isServerReachable(baseUrl) {
  if (process.env.PAGE_SNAPSHOT_ASSUME_SERVER === "1") {
    return true;
  }

  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await globalThis.fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return response.status < 500;
  } catch {
    try {
      execFileSync("curl", ["-s", "-I", baseUrl], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function createSnapshotRuntime() {
  if (!SNAPSHOT_FIXTURES_ENABLED) {
    return {
      requiresManagedServer: false,
      env: {},
      cleanup: () => {},
    };
  }

  const fixtureRuntime = await prepareSnapshotFixtures(ROOT_DIR);
  return {
    requiresManagedServer: true,
    env: fixtureRuntime.env,
    cleanup: fixtureRuntime.cleanup,
  };
}

export async function createSnapshotScriptSession({
  baseUrl,
  timeoutMs,
  headed = false,
  viewport = { width: 1440, height: 960 },
  useSnapshotFixtures = false,
  managedServerConflictMessage,
  extraEnv = {},
}) {
  let devServer = null;
  let resolvedBaseUrl = baseUrl;
  let snapshotRuntime = {
    requiresManagedServer: false,
    env: {},
    cleanup: () => {},
  };

  const serverReachable = await isServerReachable(baseUrl);
  if (useSnapshotFixtures) {
    snapshotRuntime = await createSnapshotRuntime();
    if (snapshotRuntime.requiresManagedServer) {
      resolvedBaseUrl = await resolveManagedServerBaseUrl(baseUrl);
      if (serverReachable && managedServerConflictMessage) {
        console.warn(
          `${managedServerConflictMessage} Switching snapshot fixtures to ${resolvedBaseUrl} instead.`,
        );
      }
    }
  }

  const mustStartManagedServer = useSnapshotFixtures && snapshotRuntime.requiresManagedServer;
  if (mustStartManagedServer || !serverReachable) {
    devServer = startDevServer(resolvedBaseUrl, {
      ...snapshotRuntime.env,
      ...extraEnv,
    });
    await waitForServer(resolvedBaseUrl, timeoutMs, devServer.getLogs);
  }

  const browser = await createBrowser(headed);

  return {
    browser,
    baseUrl: resolvedBaseUrl,
    async createPageSession() {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      return { context, page };
    },
    async close() {
      await browser.close();
      if (devServer) {
        devServer.child.kill("SIGTERM");
      }
      snapshotRuntime.cleanup();
    },
  };
}

export async function resolveManagedServerBaseUrl(baseUrl, findPort = findAvailablePort) {
  const url = new URL(baseUrl);
  url.port = String(await findPort(url.hostname));
  return url.toString().replace(/\/$/, "");
}

export async function findAvailablePort(hostname = "127.0.0.1") {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, hostname, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to determine an available port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export function startDevServer(baseUrl, extraEnv = {}) {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const port = url.port || "3000";
  const logs = [];

  const child = spawn("npm", ["run", "dev", "--", "--hostname", host, "--port", port], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ROUTA_PAGE_SNAPSHOT_SERVER: "1",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    logs.push(chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    logs.push(chunk.toString());
  });

  return {
    child,
    getLogs: () => logs.join("").slice(-4000),
  };
}

export async function waitForServer(baseUrl, timeoutMs, getLogs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await isServerReachable(baseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for dev server at ${baseUrl}\n${getLogs ? getLogs() : ""}`);
}

export function stripSnapshotHeader(content) {
  const lines = content.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (!trimmed.startsWith("#")) {
      break;
    }
    index += 1;
  }

  return lines.slice(index).join("\n").trim();
}

export function normalizeSnapshotBody(content) {
  const refMap = new Map();
  let nextRef = 1;

  const escapedRoot = ROOT_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootPattern = new RegExp(escapedRoot, "g");
  const localizedDateTimePattern = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{1,2}:\d{2}\s+(?:AM|PM)\b/g;

  return content
    .replace(rootPattern, "<repo-root>")
    .replace(/\[ref=(e\d+)\]/g, (_, originalRef) => {
      if (!refMap.has(originalRef)) {
        refMap.set(originalRef, `e${nextRef}`);
        nextRef += 1;
      }
      return `[ref=${refMap.get(originalRef)}]`;
    })
    .replace(/\b[0-9a-f]{8}…/gi, "<id>…")
    .replace(localizedDateTimePattern, "<localized-datetime>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\s(?:AM|PM))?\b/g, "<time>")
    .replace(/\b(?:just now|\d+\s*[smhdw] ago|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\b/gi, "<relative-time>");
}

export function normalizeComparableSnapshot(content) {
  return normalizeSnapshotBody(stripSnapshotHeader(content));
}

export function calculateSimilarity(expected, actual) {
  const expectedLines = expected.split(/\r?\n/).filter(line => line.trim());
  const actualLines = actual.split(/\r?\n/).filter(line => line.trim());

  if (expectedLines.length === 0 && actualLines.length === 0) {
    return 1.0;
  }

  if (expectedLines.length === 0 || actualLines.length === 0) {
    return 0.0;
  }

  // Build a frequency map for expected lines
  const expectedCounts = new Map();
  for (const line of expectedLines) {
    expectedCounts.set(line, (expectedCounts.get(line) ?? 0) + 1);
  }

  // Multiset intersection: consume one occurrence per matching actual line
  let intersection = 0;
  const remaining = new Map(expectedCounts);
  for (const line of actualLines) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(line, count - 1);
    }
  }

  // Jaccard similarity on multisets: intersection / union
  const union = expectedLines.length + actualLines.length - intersection;
  return intersection / union;
}

export function summarizeDiff(expected, actual) {
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const max = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < max; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        line: index + 1,
        expected: expectedLines[index] ?? null,
        actual: actualLines[index] ?? null,
        expectedLines: expectedLines.length,
        actualLines: actualLines.length,
      };
    }
  }

  return null;
}

export function shouldUpdateTarget(target) {
  const snapshotPath = resolveWorkspacePath(target.snapshotFile);
  if (!fs.existsSync(snapshotPath)) {
    return true;
  }

  const snapshotMtime = fs.statSync(snapshotPath).mtimeMs;
  const sources = [target.pageFile, path.relative(ROOT_DIR, REGISTRY_FILE)];

  return sources.some((sourcePath) => {
    const absoluteSourcePath = resolveWorkspacePath(sourcePath);
    return fs.existsSync(absoluteSourcePath) && fs.statSync(absoluteSourcePath).mtimeMs > snapshotMtime;
  });
}

export async function captureSnapshot({
  page,
  target,
  baseUrl,
  timeoutMs,
  outputPath,
}) {
  const targetUrl = new URL(target.route, baseUrl).toString();

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForSnapshotTarget(page, target, timeoutMs);

  const title = await page.title();
  const finalUrl = page.url();
  const effectiveTimeout = target.waitFor?.timeoutMs ?? timeoutMs;

  const snapshotRoot = target.snapshotSelector ? page.locator(target.snapshotSelector) : page.locator("body");
  if (target.snapshotSelector) {
    await snapshotRoot.waitFor({ state: "visible", timeout: effectiveTimeout });
  }

  // Use the newer ariaSnapshot() API which returns YAML directly
  const snapshotYaml = await snapshotRoot.ariaSnapshot();

  if (!snapshotYaml) {
    throw new Error(`Failed to capture accessibility snapshot for ${target.id}`);
  }

  const snapshotBody = normalizeSnapshotBody(snapshotYaml);

  const header = [
    `# page-id: ${target.id}`,
    `# route: ${target.route}`,
    `# source-page: ${target.pageFile}`,
    `# url: ${finalUrl}`,
    `# title: ${title}`,
    `# generated-at: ${new Date().toISOString()}`,
    `# generator: playwright`,
    `# playwright-version: ${await getPlaywrightVersion()}`,
    "",
  ].join("\n");

  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, `${header}${snapshotBody}\n`, "utf-8");
  return { outputPath, title, finalUrl };
}

export async function waitForSnapshotTarget(page, target, timeoutMs) {
  const waitFor = target.waitFor ?? { strategy: "networkidle", timeoutMs, settleMs: 1000 };
  const effectiveTimeout = waitFor.timeoutMs ?? timeoutMs;
  const settleMs = waitFor.settleMs ?? 1000;

  if (waitFor.strategy === "selector" && waitFor.value) {
    await page.waitForSelector(waitFor.value, { timeout: effectiveTimeout });
  } else if (waitFor.strategy === "text" && waitFor.value) {
    await page.getByText(waitFor.value, { exact: false }).first().waitFor({ timeout: effectiveTimeout });
  } else if (waitFor.strategy === "text-absent" && waitFor.value) {
    await page.waitForFunction(
      (text) => !globalThis.document.body?.innerText?.includes(text),
      waitFor.value,
      { timeout: effectiveTimeout },
    );
  } else {
    await page.waitForLoadState("networkidle", { timeout: effectiveTimeout }).catch(() => {});
  }

  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
}

async function getPlaywrightVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, "node_modules", "@playwright", "test", "package.json"), "utf-8")
    );
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export async function createBrowser(headed) {
  return await chromium.launch({
    headless: !headed,
  });
}

export function writeReport(report) {
  ensureReportDir();
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}
