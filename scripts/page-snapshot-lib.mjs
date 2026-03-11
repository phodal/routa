#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { chromium } from "@playwright/test";

export const ROOT_DIR = process.cwd();
export const REGISTRY_FILE = path.join(ROOT_DIR, "resources", "page-snapshot-registry.json");
export const DEFAULT_BASE_URL = process.env.PAGE_SNAPSHOT_BASE_URL || "http://127.0.0.1:3000";
export const DEFAULT_TIMEOUT_MS = 30000;
export const REPORT_FILE = path.join(ROOT_DIR, "test-results", "page-snapshot-report.json");
export const PLAYWRIGHT_ARTIFACTS_DIR = path.join(ROOT_DIR, ".playwright-snapshots");

export function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
  const entries = JSON.parse(raw);

  if (!Array.isArray(entries)) {
    throw new Error("Page snapshot registry must be an array");
  }

  return entries;
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

  for (const arg of argv) {
    if (arg.startsWith("--page=")) {
      options.page = arg.slice("--page=".length);
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
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function startDevServer(baseUrl) {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const port = url.port || "3000";
  const logs = [];

  const child = spawn("npm", ["run", "dev", "--", "--hostname", host, "--port", port], {
    cwd: ROOT_DIR,
    env: process.env,
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

  return content
    .replace(/\[ref=(e\d+)\]/g, (_, originalRef) => {
      if (!refMap.has(originalRef)) {
        refMap.set(originalRef, `e${nextRef}`);
        nextRef += 1;
      }
      return `[ref=${refMap.get(originalRef)}]`;
    })
    .replace(/\b[0-9a-f]{8}…/gi, "<id>…")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\s(?:AM|PM)\b/g, "<time>");
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
  
  const minLines = Math.min(expectedLines.length, actualLines.length);
  const maxLines = Math.max(expectedLines.length, actualLines.length);
  let matchingLines = 0;
  
  // Count matching lines up to the shorter length
  for (let i = 0; i < minLines; i += 1) {
    if (expectedLines[i] === actualLines[i]) {
      matchingLines += 1;
    }
  }
  
  // Similarity is based on the longer snapshot to penalize additions/deletions
  return matchingLines / maxLines;
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

  const waitFor = target.waitFor ?? { strategy: "networkidle", timeoutMs, settleMs: 1000 };
  const effectiveTimeout = waitFor.timeoutMs ?? timeoutMs;
  const settleMs = waitFor.settleMs ?? 1000;

  if (waitFor.strategy === "selector" && waitFor.value) {
    await page.waitForSelector(waitFor.value, { timeout: effectiveTimeout });
  } else if (waitFor.strategy === "text" && waitFor.value) {
    await page.getByText(waitFor.value, { exact: false }).first().waitFor({ timeout: effectiveTimeout });
  } else {
    await page.waitForLoadState("networkidle", { timeout: effectiveTimeout }).catch(() => {});
  }

  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }

  const title = await page.title();
  const finalUrl = page.url();
  
  // Use the newer ariaSnapshot() API which returns YAML directly
  const snapshotYaml = await page.locator('body').ariaSnapshot();

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
