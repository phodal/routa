import { describe, expect, it } from "vitest";

import { splitFileChangesByIndex } from "../kanban-file-changes-types";

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
  });
});
