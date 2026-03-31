import { describe, expect, it } from "vitest";

import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runSubmoduleRefsCheck } from "../check-submodule-refs.js";

const isWindows = process.platform === "win32";

/**
 * Creates a cross-platform fake git command that responds with scripted output.
 * On Windows: writes a Node.js script + .cmd wrapper
 * On Unix: writes a Node.js script with shebang
 */
function writeFakeGit(binDir: string, mode: "pass" | "fetch-fail"): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const counterPath = path.join(binDir, "git-call-count");
  const pathSep = isWindows ? ";" : ":";

  // Cross-platform Node.js script that mimics git behavior based on call count
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
  process.stdout.write("submodule.entrix.path tools/entrix\\n");
  process.exit(0);
}
if (count === 2) {
  process.stdout.write("https://github.com/phodal/entrix.git\\n");
  process.exit(0);
}
if (count === 3) {
  process.stdout.write("160000 commit12345 tools/entrix\\n");
  process.exit(0);
}
if (count === 4) {
  process.stdout.write("Initialized empty Git repository in /tmp/routa-submodule-test\\n");
  process.exit(0);
}
if (count === 5) {
  if (mode === "fetch-fail") {
    process.stderr.write("fatal: repository not found\\n");
    process.exit(128);
  }
  process.stdout.write("From https://github.com/phodal/entrix.git\\n");
  process.exit(0);
}
process.exit(0);
`;

  if (isWindows) {
    const gitJs = path.join(binDir, "git.js");
    const gitCmd = path.join(binDir, "git.cmd");
    writeFileSync(gitJs, script, "utf8");
    writeFileSync(gitCmd, `@node "${gitJs}" %*\n`, "utf8");
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(gitCmd, { force: true });
          rmSync(gitJs, { force: true });
          rmSync(counterPath, { force: true });
        } catch { /* ignore */ }
      },
    };
  } else {
    const fakeGit = path.join(binDir, "git");
    writeFileSync(fakeGit, script, { mode: 0o755 });
    process.env.PATH = `${binDir}${pathSep}${originalPath}`;
    return {
      restore: () => {
        process.env.PATH = originalPath;
        try {
          rmSync(fakeGit, { force: true });
          rmSync(counterPath, { force: true });
        } catch { /* ignore */ }
      },
    };
  }
}

async function withSubmoduleRepo<T>(mode: "pass" | "fetch-fail", run: (repoRoot: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? "";
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-submodule-"));
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), "routa-submodule-bin-"));
  process.chdir(repoRoot);

  const { restore } = writeFakeGit(fakeBinDir, mode);

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

describe("runSubmoduleRefsCheck", () => {
  it("passes when .gitmodules is absent", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-submodule-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(repoRoot);
      const passed = await runSubmoduleRefsCheck();
      expect(passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes when submodule refs are reachable", async () => {
    const result = await withSubmoduleRepo("pass", async (repoRoot) => {
      writeFileSync(
        path.join(repoRoot, ".gitmodules"),
        [
          '[submodule "entrix"]',
          "\tpath = tools/entrix",
          "\turl = https://github.com/phodal/entrix.git",
          "",
        ].join("\n"),
      );
      return runSubmoduleRefsCheck();
    });

    expect(result).toBe(true);
  });

  it("fails when submodule refs are not reachable", async () => {
    const result = await withSubmoduleRepo("fetch-fail", async (repoRoot) => {
      writeFileSync(
        path.join(repoRoot, ".gitmodules"),
        [
          '[submodule "entrix"]',
          "\tpath = tools/entrix",
          "\turl = https://github.com/phodal/entrix.git",
          "",
        ].join("\n"),
      );
      return runSubmoduleRefsCheck();
    });

    expect(result).toBe(false);
  });
});
