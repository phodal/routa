#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const ROOT_DIR = process.cwd();
export const REGISTRY_FILE = path.join(ROOT_DIR, "resources", "page-snapshot-registry.json");
export const DEFAULT_BASE_URL = process.env.PAGE_SNAPSHOT_BASE_URL || "http://127.0.0.1:3000";
export const DEFAULT_TIMEOUT_MS = 30000;
export const REPORT_FILE = path.join(ROOT_DIR, "test-results", "page-snapshot-report.json");
export const PLAYWRIGHT_ARTIFACTS_DIR = path.join(ROOT_DIR, ".playwright-cli");

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
    update: false,
    headed: false,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg.startsWith("--page=")) {
      options.page = arg.slice("--page=".length);
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
    }
  }

  return options;
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

export function parseEvalResult(output) {
  const match = output.match(/### Result\s+([\s\S]*?)\s+### Ran Playwright code/);
  if (!match) {
    return "";
  }

  const value = match[1].trim();
  if (!value) {
    return "";
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function runPlaywrightCli(args, { allowFailure = false } = {}) {
  const result = spawnSync("playwright-cli", args, {
    cwd: ROOT_DIR,
    encoding: "utf-8",
  });

  if (result.status !== 0 && !allowFailure) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `playwright-cli failed for args: ${args.join(" ")}`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 0,
  };
}

export function getPlaywrightCliVersion() {
  return runPlaywrightCli(["--version"]).stdout.trim();
}

export async function isServerReachable(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(baseUrl, {
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

export function capturePlaywrightArtifactState() {
  if (!fs.existsSync(PLAYWRIGHT_ARTIFACTS_DIR)) {
    return new Set();
  }

  return new Set(fs.readdirSync(PLAYWRIGHT_ARTIFACTS_DIR));
}

export function cleanupPlaywrightArtifacts(previousArtifacts) {
  if (!fs.existsSync(PLAYWRIGHT_ARTIFACTS_DIR)) {
    return;
  }

  for (const fileName of fs.readdirSync(PLAYWRIGHT_ARTIFACTS_DIR)) {
    if (!previousArtifacts.has(fileName)) {
      fs.rmSync(path.join(PLAYWRIGHT_ARTIFACTS_DIR, fileName), { force: true });
    }
  }
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

export function buildWaitScript(target, timeoutMs) {
  const waitFor = target.waitFor ?? { strategy: "networkidle", timeoutMs, settleMs: 1000 };
  const effectiveTimeout = waitFor.timeoutMs ?? timeoutMs;
  const settleMs = waitFor.settleMs ?? 1000;
  const lines = [
    "async (page) => {",
    `  await page.waitForLoadState(\"domcontentloaded\", { timeout: ${effectiveTimeout} });`,
  ];

  if (waitFor.strategy === "selector" && waitFor.value) {
    lines.push(`  await page.waitForSelector(${JSON.stringify(waitFor.value)}, { timeout: ${effectiveTimeout} });`);
  } else if (waitFor.strategy === "text" && waitFor.value) {
    lines.push(`  await page.getByText(${JSON.stringify(waitFor.value)}, { exact: false }).first().waitFor({ timeout: ${effectiveTimeout} });`);
  } else {
    lines.push(`  await page.waitForLoadState(\"networkidle\", { timeout: ${effectiveTimeout} }).catch(() => {});`);
  }

  if (settleMs > 0) {
    lines.push(`  await page.waitForTimeout(${settleMs});`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function openSession(sessionName, headed) {
  runPlaywrightCli([`-s=${sessionName}`, "close"], { allowFailure: true });
  const args = [`-s=${sessionName}`, "open"];
  if (headed) {
    args.push("--headed");
  }
  runPlaywrightCli(args);
  runPlaywrightCli([`-s=${sessionName}`, "resize", "1440", "960"]);
}

export function closeSession(sessionName) {
  runPlaywrightCli([`-s=${sessionName}`, "close"], { allowFailure: true });
}

export function captureSnapshot({
  sessionName,
  target,
  baseUrl,
  timeoutMs,
  playwrightCliVersion,
  outputPath,
}) {
  const targetUrl = new URL(target.route, baseUrl).toString();
  runPlaywrightCli([`-s=${sessionName}`, "goto", targetUrl]);
  runPlaywrightCli([`-s=${sessionName}`, "run-code", buildWaitScript(target, timeoutMs)]);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-snapshot-"));
  const tempFile = path.join(tempDir, `${target.id}.yaml`);

  try {
    runPlaywrightCli([`-s=${sessionName}`, "snapshot", `--filename=${tempFile}`]);
    const title = String(parseEvalResult(runPlaywrightCli([`-s=${sessionName}`, "eval", "document.title"]).stdout) ?? "");
    const finalUrl = String(parseEvalResult(runPlaywrightCli([`-s=${sessionName}`, "eval", "location.href"]).stdout) ?? targetUrl);
    const snapshotBody = normalizeSnapshotBody(fs.readFileSync(tempFile, "utf-8").trim());

    const header = [
      `# page-id: ${target.id}`,
      `# route: ${target.route}`,
      `# source-page: ${target.pageFile}`,
      `# url: ${finalUrl}`,
      `# title: ${title}`,
      `# generated-at: ${new Date().toISOString()}`,
      `# generator: playwright-cli`,
      `# playwright-cli-version: ${playwrightCliVersion}`,
      "",
    ].join("\n");

    ensureParentDir(outputPath);
    fs.writeFileSync(outputPath, `${header}${snapshotBody}\n`, "utf-8");
    return { outputPath, title, finalUrl };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function writeReport(report) {
  ensureReportDir();
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}