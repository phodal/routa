import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
function writeFakeNpx(
  binDir: string,
  mode: "pass" | "stale" | "stale-dev-types" | "fail",
): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const counterPath = path.join(binDir, "npx-call-count");
  const pathSep = isWindows ? ";" : ":";

  // Cross-platform Node.js script that mimics npx tsc behavior
  const script = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const counterFile = ${JSON.stringify(counterPath.replace(/\\/g, "\\\\"))};
const mode = ${JSON.stringify(mode)};

let state = { tsc: 0, typegen: 0 };
try { state = JSON.parse(fs.readFileSync(counterFile, "utf8")); } catch {}

const args = process.argv.slice(2);
if (args[0] === "next" && args[1] === "typegen") {
  state.typegen += 1;
  try { fs.writeFileSync(counterFile, JSON.stringify(state)); } catch {}
  process.stdout.write("Generating route types...\\n✓ Types generated successfully\\n");
  process.exit(0);
}

if (args[0] === "tsc" && args[1] === "--noEmit") {
  state.tsc += 1;
  try { fs.writeFileSync(counterFile, JSON.stringify(state)); } catch {}

  if (state.tsc === 1) {
    if (mode === "stale") {
      process.stderr.write(".next/types/src/app/page.js: Cannot find module './src/app/page.js' or its corresponding type declarations.\\n");
      process.exit(1);
    }
    if (mode === "stale-dev-types") {
      process.stderr.write(".next/dev/types/routes.d.ts(256,37): error TS1005: '?' expected.\\n");
      process.stderr.write(".next/dev/types/validator.ts(1718,1): error TS1128: Declaration or statement expected.\\n");
      process.exit(1);
    }
    if (mode === "fail") {
      process.stderr.write("Type error: Something else\\n");
      process.exit(1);
    }
  }

  process.exit(0);
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

function withTypecheckRepo<T>(
  mode: "pass" | "stale" | "stale-dev-types" | "fail",
  run: (repoRoot: string) => T,
): T {
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
    const result = withTypecheckRepo("stale", (root) => {
      const nextDir = path.join(root, ".next", "types");
      mkdirSync(nextDir, { recursive: true });
      writeFileSync(path.join(nextDir, ".keep"), "");
      return runTypecheckSmart();
    });

    expect(result).toBe(0);
  });

  it("retries and succeeds after stale .next/dev/types parser errors", () => {
    const result = withTypecheckRepo("stale-dev-types", () => runTypecheckSmart());

    expect(result).toBe(0);
  });

  it("returns failure for non-stale typecheck errors", () => {
    const result = withTypecheckRepo("fail", () => runTypecheckSmart());

    expect(result).toBe(1);
  });
});
