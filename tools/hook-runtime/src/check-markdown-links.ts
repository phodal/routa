import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type CommandResult = {
  code: number;
  output: string;
};

type MarkdownLinkStatus = {
  file: string;
  link: string;
  kind: "pass" | "warn" | "fail";
};

type CheckSummary = {
  failed: MarkdownLinkStatus[];
  warnings: MarkdownLinkStatus[];
  checked: number;
};

const EXTERNAL_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
const MARKDOWN_FILE_LIMIT = 100;

function runCommand(program: string, args: string[]): CommandResult {
  const result = spawnSync(program, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    // Windows: spawnSync without shell only resolves .exe, not .cmd/.bat
    shell: process.platform === "win32",
  });

  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function shouldSkipPath(filePath: string): boolean {
  return /(^|\/)(node_modules|\.next|\.git|out|\.routa|\.pytest_cache)(\/|$)/.test(filePath);
}

function listTrackedMarkdownFiles(): string[] {
  const result = runCommand("git", ["ls-files", "*.md"]);
  if (result.code !== 0) {
    return [];
  }

  return result.output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => !shouldSkipPath(entry))
    .slice(0, MARKDOWN_FILE_LIMIT);
}

function extractExternalLinks(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const text = readFileSync(filePath, "utf8");
  const links = new Set<string>();
  let match = EXTERNAL_LINK_RE.exec(text);

  while (match !== null) {
    const link = (match[1] ?? "").trim();
    if (link && /^https?:\/\//.test(link) && !/localhost|127\.0\.0\.1/.test(link)) {
      links.add(link);
    }

    match = EXTERNAL_LINK_RE.exec(text);
  }

  return [...links];
}

function checkExternalLink(filePath: string, link: string): MarkdownLinkStatus {
  // Use NUL on Windows, /dev/null on Unix
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const result = runCommand("curl", [
    "-sS",
    "-o",
    nullDevice,
    "-w",
    "%{http_code}",
    "--connect-timeout",
    "10",
    "--max-time",
    "15",
    "-L",
    "-H",
    "User-Agent: Mozilla/5.0 (compatible; RoutaLinkChecker/1.0)",
    link,
  ]);

  if (result.code !== 0) {
    return { file: filePath, link, kind: "warn" };
  }

  const httpCode = (result.output ?? "").trim();
  if (/^2[0-9][0-9]$/.test(httpCode) || /^3[0-9][0-9]$/.test(httpCode)) {
    return { file: filePath, link, kind: "pass" };
  }

  if (httpCode === "429" || /^4[0-9][0-9]$/.test(httpCode)) {
    return { file: filePath, link, kind: "warn" };
  }

  return { file: filePath, link, kind: "fail" };
}

function runMarkdownLinksCheckWithContext(baseDir = process.cwd()): CheckSummary {
  const markdownFiles = listTrackedMarkdownFiles();
  if (markdownFiles.length === 0) {
    console.log("No markdown files found.");
    console.log("markdown_external_links: ok");
    return { checked: 0, failed: [], warnings: [] };
  }

  const linksToCheck = new Map<string, string>();
  let checked = 0;

  for (const rawFile of markdownFiles) {
    const filePath = path.join(baseDir, rawFile);
    const links = extractExternalLinks(filePath);
    for (const link of links) {
      linksToCheck.set(link, rawFile);
    }
  }

  if (linksToCheck.size === 0) {
    console.log("No external links found in markdown files.");
    console.log("markdown_external_links: ok");
    return { checked: 0, failed: [], warnings: [] };
  }

  const statuses: MarkdownLinkStatus[] = [];
  for (const [link, file] of linksToCheck) {
    checked += 1;
    process.stdout.write(`  [${String(checked).padStart(3, " ")}] Checking: ${link}\r`);
    statuses.push(checkExternalLink(file, link));
  }

  process.stdout.write("\n");
  const failed = statuses.filter((status) => status.kind === "fail");
  const warnings = statuses.filter((status) => status.kind === "warn");
  const passed = checked - failed.length - warnings.length;

  console.log("Link check summary:");
  console.log(`  Total checked: ${checked}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("");
    console.log("Broken links found:");
    for (const failure of failed) {
      console.log(`  ${failure.file}: ${failure.link}`);
    }
  }

  if (failed.length > 0) {
    console.log("[markdown_external_links] failed");
    return { checked, failed, warnings };
  }

  console.log("markdown_external_links: ok");
  return { checked, failed: [], warnings };
}

export function runMarkdownLinksCheck(): number {
  const summary = runMarkdownLinksCheckWithContext(process.cwd());
  return summary.failed.length === 0 ? 0 : 1;
}

const moduleBasename = path.basename(process.argv[1] ?? "");
if (moduleBasename === "check-markdown-links.ts") {
  process.exit(runMarkdownLinksCheck());
}

