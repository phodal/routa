import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HarnessSpecSourcesPanel } from "../harness-spec-sources-panel";

const sampleData = {
  generatedAt: "2026-03-30T00:00:00.000Z",
  repoRoot: "/tmp/repo",
  warnings: [],
  sources: [
    {
      kind: "native-tool" as const,
      system: "kiro" as const,
      rootPath: ".kiro/specs",
      confidence: "high" as const,
      status: "artifacts-present" as const,
      evidence: ["feature-tree"],
      children: [],
      features: [
        {
          name: "Feature Tree",
          documents: [{ type: "requirements" as const, path: ".kiro/specs/feature/requirements.md" }],
        },
      ],
    },
    {
      kind: "framework" as const,
      system: "bmad" as const,
      rootPath: "docs",
      confidence: "low" as const,
      status: "legacy" as const,
      evidence: ["docs/prd.md"],
      children: [{ type: "prd" as const, path: "docs/prd.md" }],
    },
  ],
};

describe("HarnessSpecSourcesPanel", () => {
  it("hides stale compact source cards while loading", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        loading
        variant="compact"
      />,
    );

    expect(screen.getByTestId("spec-sources-compact")).not.toBeNull();
    expect(screen.getByText("Loading...")).not.toBeNull();
    expect(screen.queryByText("bmad")).toBeNull();
  });

  it("shows the unsupported message in compact mode instead of stale cards", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        unsupportedMessage="Harness is unavailable for this repository."
        variant="compact"
      />,
    );

    expect(screen.getByText("Harness is unavailable for this repository.")).not.toBeNull();
    expect(screen.queryByText("bmad")).toBeNull();
  });

  it("keeps Kiro docs collapsed by default while leaving source cards expanded", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
      />,
    );

    expect(screen.getByText("Feature Tree")).not.toBeNull();
    expect(screen.queryByText(".kiro/specs/feature/requirements.md")).toBeNull();
    expect(screen.getByText("docs/prd.md")).not.toBeNull();
  });
});
