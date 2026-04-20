import { describe, expect, it } from "vitest";
import {
  buildPierreDiffFromFullUnifiedPatch,
  parseUnifiedDiffPreview,
  reconstructFileContentsFromUnifiedDiff,
  renderUnifiedDiffLines,
} from "../kanban-diff-preview";

describe("kanban diff preview", () => {
  it("keeps keys unique when parsed diff lines are rendered one at a time and flattened", () => {
    const parsedDiff = parseUnifiedDiffPreview({
      patch: [
        "@@ -1,0 +1,2 @@",
        "+",
        "+",
      ].join("\n"),
    });

    const renderedRows = parsedDiff.lines.flatMap((line) =>
      renderUnifiedDiffLines({
        additions: parsedDiff.additions,
        deletions: parsedDiff.deletions,
        lines: [line],
      })
    );

    const keys = renderedRows.map((row) => row.key);

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reconstructs full old and new files from a full-context unified diff", () => {
    const parsedDiff = parseUnifiedDiffPreview({
      patch: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,4 +1,4 @@",
        " export const unchangedTop = true;",
        "-export const label = 'old';",
        "+export const label = 'new';",
        " export const unchangedBottom = true;",
      ].join("\n"),
    });

    const contents = reconstructFileContentsFromUnifiedDiff(parsedDiff);

    expect(contents?.oldContents).toBe([
      "export const unchangedTop = true;",
      "export const label = 'old';",
      "export const unchangedBottom = true;",
      "",
    ].join("\n"));
    expect(contents?.newContents).toBe([
      "export const unchangedTop = true;",
      "export const label = 'new';",
      "export const unchangedBottom = true;",
      "",
    ].join("\n"));
  });

  it("preserves real no-newline-at-eof markers when reconstructing files", () => {
    const parsedDiff = parseUnifiedDiffPreview({
      patch: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-export const label = 'old';",
        "\\ No newline at end of file",
        "+export const label = 'new';",
        "\\ No newline at end of file",
      ].join("\n"),
    });

    const contents = reconstructFileContentsFromUnifiedDiff(parsedDiff);

    expect(contents?.oldContents).toBe("export const label = 'old';");
    expect(contents?.newContents).toBe("export const label = 'new';");
  });

  it("builds an expandable @pierre/diffs file diff from a full-context file patch", () => {
    const fileDiff = buildPierreDiffFromFullUnifiedPatch({
      path: "src/app.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      startLineIndex: 0,
      patch: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,9 +1,9 @@",
        " const line1 = 1;",
        " const line2 = 2;",
        " const line3 = 3;",
        " const line4 = 4;",
        " const line5 = 5;",
        "-const label = 'old';",
        "+const label = 'new';",
        " const line7 = 7;",
        " const line8 = 8;",
        " const line9 = 9;",
      ].join("\n"),
    });

    expect(fileDiff).not.toBeNull();
    expect(fileDiff?.deletionLines.length).toBe(9);
    expect(fileDiff?.additionLines.length).toBe(9);
    expect(fileDiff?.isPartial).toBe(false);
    expect(fileDiff?.hunks[0]?.collapsedBefore).toBeGreaterThanOrEqual(0);
  });
});
