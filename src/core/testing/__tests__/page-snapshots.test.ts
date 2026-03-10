import { describe, expect, it } from "vitest";

import {
  extractPageSnapshotElements,
  listPageSnapshotTargets,
  parsePageSnapshotContent,
} from "../page-snapshots";

describe("page snapshots", () => {
  it("loads the configured snapshot targets", () => {
    const targets = listPageSnapshotTargets();

    expect(targets.length).toBeGreaterThanOrEqual(8);
    expect(targets.some((target) => target.id === "home")).toBe(true);
    expect(targets.some((target) => target.id === "workspace")).toBe(true);
  });

  it("parses metadata comments and snapshot body", () => {
    const parsed = parsePageSnapshotContent(`
# page-id: home
# route: /
# title: Routa
- generic [ref=e1]:
  - button "Send" [ref=e2]
`);

    expect(parsed.metadata["page-id"]).toBe("home");
    expect(parsed.metadata.route).toBe("/");
    expect(parsed.snapshotText.startsWith("- generic")).toBe(true);
    expect(parsed.elements).toHaveLength(2);
  });

  it("filters extracted elements by type", () => {
    const snapshotText = `
- generic [ref=e1]:
  - button "Send" [ref=e2]
  - link "Settings" [ref=e3]
  - textbox "Workspace" [ref=e4]
`.trim();

    const buttons = extractPageSnapshotElements(snapshotText, "button");
    const textboxes = extractPageSnapshotElements(snapshotText, "textbox");

    expect(buttons).toEqual([
      {
        type: "button",
        ref: "e2",
        label: "Send",
        line: '- button "Send" [ref=e2]',
      },
    ]);
    expect(textboxes[0]?.label).toBe("Workspace");
  });
});