import { describe, expect, it } from "vitest";

import { fileSelectionKey, splitFileChangesByIndex } from "../kanban-file-changes-types";

describe("splitFileChangesByIndex (#570)", () => {
  it("treats payloads without index flags as all unstaged", () => {
    const files = [{ path: "a.ts", status: "modified" as const }];
    expect(splitFileChangesByIndex(files)).toEqual({ unstagedFiles: files, stagedFiles: [] });
  });

  it("routes staged, unstaged, and partially staged files to the right lists", () => {
    const staged = { path: "s.ts", status: "modified" as const, staged: true };
    const unstaged = { path: "u.ts", status: "modified" as const, unstaged: true };
    const both = { path: "b.ts", status: "modified" as const, staged: true, unstaged: true };
    const untracked = { path: "n.ts", status: "untracked" as const, unstaged: true };

    const result = splitFileChangesByIndex([staged, unstaged, both, untracked]);

    expect(result.stagedFiles.map((f) => f.path)).toEqual(["s.ts", "b.ts"]);
    expect(result.unstagedFiles.map((f) => f.path)).toEqual(["u.ts", "b.ts", "n.ts"]);
    expect(result.stagedFiles.every((f) => f.side === "staged")).toBe(true);
    expect(result.unstagedFiles.every((f) => f.side === "unstaged")).toBe(true);
  });

  it("builds side-specific status and drops ambiguous worktree stats on the staged row", () => {
    const md = {
      path: "md.ts",
      status: "deleted" as const,
      staged: true,
      unstaged: true,
      stagedStatus: "modified" as const,
      unstagedStatus: "deleted" as const,
      additions: 0,
      deletions: 12,
    };

    const { stagedFiles, unstagedFiles } = splitFileChangesByIndex([md]);

    expect(stagedFiles[0]).toMatchObject({ status: "modified", side: "staged" });
    expect(stagedFiles[0].additions).toBeUndefined();
    expect(stagedFiles[0].deletions).toBeUndefined();
    expect(unstagedFiles[0]).toMatchObject({ status: "deleted", side: "unstaged", deletions: 12 });
  });

  it("scopes selection keys to the row side", () => {
    const { stagedFiles, unstagedFiles } = splitFileChangesByIndex([
      { path: "b.ts", status: "modified", staged: true, unstaged: true },
    ]);
    expect(fileSelectionKey(stagedFiles[0])).not.toBe(fileSelectionKey(unstagedFiles[0]));
  });
});
