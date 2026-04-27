/**
 * @vitest-environment node
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractSearchOutputPathCandidates,
  normalizeRepoRelative,
  parsePatchBlock,
} from "../task-adaptive-path-signals";

function ensureFile(filePath: string, content = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("task-adaptive-path-signals", () => {
  it("parses real apply_patch headers as changed file evidence", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/core/harness/task-adaptive.ts",
      "*** Add File: src/core/harness/task-adaptive-path-signals.ts",
      "*** Delete File: docs/issues/old-task-adaptive-note.md",
      "*** Move to: src/core/harness/__tests__/task-adaptive-path-signals.test.ts",
      "*** End Patch",
      "",
    ].join("\n");

    expect(parsePatchBlock(patch)).toEqual([
      "src/core/harness/task-adaptive.ts",
      "src/core/harness/task-adaptive-path-signals.ts",
      "docs/issues/old-task-adaptive-note.md",
      "src/core/harness/__tests__/task-adaptive-path-signals.test.ts",
    ]);
  });

  it("prefers session-cwd relative files when the transcript ran in a nested codebase", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-path-signals-nested-"));
    const repoRoot = path.join(tempRoot, "repo");
    const codebaseRoot = path.join(repoRoot, ".routa", "repos", "example-codebase");
    const sessionRelativeFile = "packages/app/src/page.tsx";
    const repoRelativeFile = ".routa/repos/example-codebase/packages/app/src/page.tsx";
    const absoluteFile = path.join(codebaseRoot, sessionRelativeFile);

    ensureFile(absoluteFile, "export const nestedPage = true;\n");

    expect(normalizeRepoRelative(repoRoot, sessionRelativeFile, codebaseRoot)).toBe(repoRelativeFile);
    expect(normalizeRepoRelative(repoRoot, absoluteFile, codebaseRoot)).toBe(repoRelativeFile);
  });

  it("keeps repo-root relative paths stable when the transcript already ran at repo root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-path-signals-root-"));
    const repoRoot = path.join(tempRoot, "repo");
    const repoRelativeFile = "src/app/page.tsx";
    const absoluteFile = path.join(repoRoot, repoRelativeFile);

    ensureFile(absoluteFile, "export default function Page() { return null; }\n");

    expect(normalizeRepoRelative(repoRoot, repoRelativeFile, repoRoot)).toBe(repoRelativeFile);
    expect(normalizeRepoRelative(repoRoot, absoluteFile, repoRoot)).toBe(repoRelativeFile);
  });

  it("extracts discovery paths from git grep and find output", () => {
    expect(
      extractSearchOutputPathCandidates(
        "git grep task-adaptive",
        [
          "src/core/harness/task-adaptive.ts:42:const ready = true;",
          "Binary file assets/logo.png matches",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "src/core/harness/task-adaptive.ts",
      "assets/logo.png",
    ]);

    expect(
      extractSearchOutputPathCandidates(
        "find src -type f",
        [
          "src",
          "src/core",
          "src/core/harness/task-adaptive.ts",
          "Cargo.toml",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "src/core/harness/task-adaptive.ts",
      "Cargo.toml",
    ]);
  });

  it("unwraps shell-wrapped search commands before extracting discovery paths", () => {
    expect(
      extractSearchOutputPathCandidates(
        `/bin/zsh -lc "rg --files packages/app/src"`,
        [
          "packages/app/src/page.tsx",
          "packages/app/src/layout.tsx",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "packages/app/src/page.tsx",
      "packages/app/src/layout.tsx",
    ]);
  });
});
