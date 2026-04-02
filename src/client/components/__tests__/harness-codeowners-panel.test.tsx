import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HarnessCodeownersPanel } from "../harness-codeowners-panel";

const sampleData = {
  generatedAt: "2026-04-02T08:00:00.000Z",
  repoRoot: "/Users/phodal/ai/routa-js",
  codeownersFile: ".github/CODEOWNERS",
  owners: [
    {
      name: "@phodal",
      kind: "user" as const,
      matchedFileCount: 1846,
    },
  ],
  rules: [
    {
      pattern: ".agents/**",
      owners: ["@phodal"],
      line: 6,
      precedence: 1,
    },
    {
      pattern: ".augment/**",
      owners: ["@phodal"],
      line: 7,
      precedence: 2,
    },
  ],
  coverage: {
    unownedFiles: [],
    overlappingFiles: [],
    sensitiveUnownedFiles: [],
  },
  correlation: {
    reviewTriggerFile: "docs/fitness/review-triggers.yaml",
    triggerCorrelations: [],
    hotspots: [],
  },
  warnings: [],
};

describe("HarnessCodeownersPanel", () => {
  it("uses a larger rules table scroll region in the full view than in compact mode", () => {
    const { rerender } = render(
      <HarnessCodeownersPanel
        repoLabel="routa-js"
        data={sampleData}
      />,
    );

    const fullViewScrollContainer = screen.getByRole("table").parentElement;
    expect(fullViewScrollContainer?.getAttribute("style")).toContain("max-height: min(36rem, calc(100vh - 24rem))");

    rerender(
      <HarnessCodeownersPanel
        repoLabel="routa-js"
        data={sampleData}
        variant="compact"
      />,
    );

    const compactViewScrollContainer = screen.getByRole("table").parentElement;
    expect(compactViewScrollContainer?.getAttribute("style")).toContain("max-height: 14rem");
  });
});
