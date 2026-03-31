import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { runMarkdownLinksCheck } from "../check-markdown-links.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const isWindows = process.platform === "win32";

/**
 * Writes a cross-platform fake curl that responds with scripted output
 * based on URL pattern matching.
 *
 * On Windows: writes a Node.js script + .cmd wrapper (requires shell:true in spawnSync)
 * On Unix: writes a Node.js script with shebang
 */
function writeFakeCurl(
  binDir: string,
  responses: Array<{ urlPattern: string; exitCode: number; stdout: string; stderr: string }>,
  defaultResponse: { exitCode: number; stdout: string; stderr: string },
): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const pathSep = isWindows ? ";" : ":";

  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const urlArg = args.find(a => typeof a === 'string' && a.startsWith('http'));
const responses = ${JSON.stringify(responses)};
const defaultResponse = ${JSON.stringify(defaultResponse)};
if (urlArg) {
  for (const r of responses) {
    if (urlArg.includes(r.urlPattern)) {
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      process.exit(r.exitCode);
    }
  }
}
process.stdout.write(defaultResponse.stdout);
process.stderr.write(defaultResponse.stderr);
process.exit(defaultResponse.exitCode);
`;

  if (isWindows) {
    const curlJs = path.join(binDir, "curl.js");
    const curlCmd = path.join(binDir, "curl.cmd");
    writeFileSync(curlJs, script, "utf8");
    writeFileSync(curlCmd, `@node "${curlJs.replace(/\\/g, "\\\\")}" %*\n`, "utf8");
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(curlCmd, { force: true });
          rmSync(curlJs, { force: true });
        } catch {
          /* ignore */
        }
      },
    };
  } else {
    const fakeCurl = path.join(binDir, "curl");
    writeFileSync(fakeCurl, script, { mode: 0o755 });
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(fakeCurl, { force: true });
        } catch {
          /* ignore */
        }
      },
    };
  }
}

function withRepo<T>(
  files: Array<{ file: string; content: string }>,
  curlResponses: Array<{ urlPattern: string; exitCode: number; stdout: string; stderr: string }>,
  curlDefault: { exitCode: number; stdout: string; stderr: string },
  run: () => T,
): T {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? "";
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-md-links-"));
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), "routa-md-links-bin-"));

  process.chdir(repoRoot);
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: repoRoot, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: repoRoot, stdio: "ignore" });

  for (const file of files) {
    const absolutePath = path.join(repoRoot, file.file);
    const dir = path.dirname(absolutePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(absolutePath, file.content);
    execSync(`git add "${file.file}"`, { cwd: repoRoot, stdio: "ignore" });
  }

  if (files.length > 0) {
    execSync("git commit -m init", { cwd: repoRoot, stdio: "ignore" });
  }

  const { restore } = writeFakeCurl(fakeBinDir, curlResponses, curlDefault);
  try {
    return run();
  } finally {
    restore();
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
}

describe("runMarkdownLinksCheck", () => {
  it("passes when there are no markdown files", () => {
    const result = withRepo(
      [],
      [],
      { exitCode: 0, stdout: "200\n", stderr: "" },
      () => runMarkdownLinksCheck(),
    );
    expect(result).toBe(0);
  });

  it("passes when all external links are reachable", () => {
    const result = withRepo(
      [
        {
          file: "readme.md",
          content: "[r1](https://good.example.com)\n[r2](https://redirect.example.com)",
        },
      ],
      [
        { urlPattern: "good.example.com", exitCode: 0, stdout: "200\n", stderr: "" },
        { urlPattern: "redirect.example.com", exitCode: 0, stdout: "301\n", stderr: "" },
      ],
      { exitCode: 0, stdout: "200\n", stderr: "" },
      () => runMarkdownLinksCheck(),
    );

    expect(result).toBe(0);
  });

  it("warns on recoverable link checks without failing", () => {
    const result = withRepo(
      [
        {
          file: "guide.md",
          content: "[bad](https://warn.example.com)\n[timeout](https://timeout.example.com)",
        },
      ],
      [
        { urlPattern: "warn.example.com", exitCode: 0, stdout: "404\n", stderr: "" },
        { urlPattern: "timeout.example.com", exitCode: 7, stdout: "", stderr: "timeout" },
      ],
      { exitCode: 0, stdout: "200\n", stderr: "" },
      () => runMarkdownLinksCheck(),
    );

    expect(result).toBe(0);
  });

  it("fails when an external link is broken", () => {
    const result = withRepo(
      [
        {
          file: "doc.md",
          content: "[bad](https://fail.example.com/bad)",
        },
      ],
      [{ urlPattern: "fail.example.com", exitCode: 0, stdout: "500\n", stderr: "" }],
      { exitCode: 0, stdout: "200\n", stderr: "" },
      () => runMarkdownLinksCheck(),
    );

    expect(result).toBe(1);
  });
});
