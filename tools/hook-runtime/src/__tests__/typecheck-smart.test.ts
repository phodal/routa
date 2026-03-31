import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runTypecheckSmart } from "../typecheck-smart.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const isWindows = process.platform === "win32";

/**
 * Creates a cross-platform fake npx command that responds with scripted behavior.
 * On Windows: writes a Node.js script + .cmd wrapper
 * On Unix: writes a Node.js script with shebang
 */
function writeFakeNpx(binDir: string, mode: "pass" | "stale" | "fail"): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const counterPath = path.join(binDir, "npx-call-count");
  const pathSep = isWindows ? ";" : ":";

  // Cross-platform Node.js script that mimics npx tsc behavior
  const script = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const counterFile = ${JSON.stringify(counterPath.replace(/\\/g, "\\\\"))};
const mode = ${JSON.stringify(mode)};

let count = 0;
try { count = parseInt(fs.readFileSync(counterFile, "utf8").trim(), 10) || 0; } catch {}
count += 1;
try { fs.writeFileSync(counterFile, String(count)); } catch {}

if (count === 1) {
  if (mode === "stale") {
    process.stderr.write(".next/types/src/app/page.js: Cannot find module './src/app/page.js' or its corresponding type declarations.\\n");
    process.exit(1);
  }
  if (mode === "fail") {
    process.stderr.write("Type error: Something else\\n");
    process.exit(1);
  }
}

process.exit(0);
`;

  if (isWindows) {
    const npxJs = path.join(binDir, "npx.js");
    const npxCmd = path.join(binDir, "npx.cmd");
    writeFileSync(npxJs, script, "utf8");
    writeFileSync(npxCmd, `@node "${npxJs}" %*\n`, "utf8");
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(npxCmd, { force: true });
          rmSync(npxJs, { force: true });
          rmSync(counterPath, { force: true });
        } catch { /* ignore */ }
      },
    };
  } else {
    const fakeNpx = path.join(binDir, "npx");
    writeFileSync(fakeNpx, script, { mode: 0o755 });
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(fakeNpx, { force: true });
          rmSync(counterPath, { force: true });
        } catch { /* ignore */ }
      },
    };
  }
}

function withTypecheckRepo<T>(mode: "pass" | "stale" | "fail", run: (repoRoot: string) => T): T {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? "";
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-typecheck-"));
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), "routa-typecheck-bin-"));

  process.chdir(repoRoot);
  const { restore } = writeFakeNpx(fakeBinDir, mode);

  try {
    return run(repoRoot);
  } finally {
    restore();
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
}

describe("runTypecheckSmart", () => {
  it("returns success when tsc passes on first run", () => {
    const result = withTypecheckRepo("pass", () => runTypecheckSmart());

    expect(result).toBe(0);
  });

  it("retries and succeeds after stale .next/types detection", () => {
    let repoRoot = "";
    const result = withTypecheckRepo("stale", (root) => {
      repoRoot = root;
      const nextDir = path.join(root, ".next", "types");
      mkdirSync(nextDir, { recursive: true });
      writeFileSync(path.join(nextDir, ".keep"), "");
      return runTypecheckSmart();
    });

    expect(result).toBe(0);
    expect(existsSync(path.join(repoRoot, ".next"))).toBe(false);
  });

  it("returns failure for non-stale typecheck errors", () => {
    const result = withTypecheckRepo("fail", () => runTypecheckSmart());

    expect(result).toBe(1);
  });
});
