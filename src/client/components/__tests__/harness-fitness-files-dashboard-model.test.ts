import { describe, expect, it } from "vitest";

import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";

import { buildHarnessFitnessFilesDashboardModel } from "../harness-fitness-files-dashboard-model";

const specFiles: FitnessSpecSummary[] = [
  {
    name: "README.md",
    relativePath: "docs/fitness/README.md",
    kind: "rulebook",
    language: "markdown",
    metricCount: 0,
    metrics: [],
    source: "# README",
  },
  {
    name: "manifest.yaml",
    relativePath: "docs/fitness/manifest.yaml",
    kind: "manifest",
    language: "yaml",
    metricCount: 3,
    metrics: [],
    source: "evidence_files: []",
    manifestEntries: ["api-contract.md", "security.md", "unit-test.md"],
  },
  {
    name: "api-contract.md",
    relativePath: "docs/fitness/api-contract.md",
    kind: "dimension",
    language: "markdown",
    dimension: "evolvability",
    weight: 8,
    thresholdPass: 100,
    thresholdWarn: 95,
    metricCount: 2,
    metrics: [
      {
        name: "openapi_schema_valid",
        command: "npm run api:schema:validate",
        description: "",
        tier: "fast",
        hardGate: true,
        gate: "hard",
        runner: "shell",
        scope: [],
        runWhenChanged: [],
      },
      {
        name: "api_parity_check",
        command: "npm run api:check",
        description: "",
        tier: "fast",
        hardGate: true,
        gate: "hard",
        runner: "shell",
        scope: [],
        runWhenChanged: [],
      },
    ],
    source: "dimension",
    frontmatterSource: "---",
  },
  {
    name: "code-quality.md",
    relativePath: "docs/fitness/code-quality.md",
    kind: "dimension",
    language: "markdown",
    dimension: "code_quality",
    weight: 24,
    thresholdPass: 90,
    thresholdWarn: 80,
    metricCount: 3,
    metrics: [
      {
        name: "eslint_pass",
        command: "npm run lint",
        description: "",
        tier: "fast",
        hardGate: true,
        gate: "hard",
        runner: "shell",
        scope: [],
        runWhenChanged: [],
      },
      {
        name: "clippy_pass",
        command: "cargo clippy",
        description: "",
        tier: "fast",
        hardGate: true,
        gate: "hard",
        runner: "shell",
        scope: [],
        runWhenChanged: [],
      },
      {
        name: "duplicate_code_rust",
        command: "cargo test",
        description: "",
        tier: "normal",
        hardGate: false,
        gate: "soft",
        runner: "graph",
        scope: [],
        runWhenChanged: [],
      },
    ],
    source: "dimension",
    frontmatterSource: "---",
  },
];

describe("buildHarnessFitnessFilesDashboardModel", () => {
  it("builds dimension density chart data from fitness spec files", () => {
    const model = buildHarnessFitnessFilesDashboardModel(specFiles, specFiles[2] ?? null);

    expect(model.selectedDimension).toEqual(
      expect.objectContaining({
        label: "evolvability",
        densityScore: 67,
      }),
    );
    expect(model.dimensions).toEqual([
      expect.objectContaining({
        label: "code_quality",
        fileName: "code-quality.md",
        metricCount: 3,
        hardGateCount: 2,
        densityScore: 100,
        isSelected: false,
      }),
      expect.objectContaining({
        label: "evolvability",
        fileName: "api-contract.md",
        metricCount: 2,
        hardGateCount: 2,
        densityScore: 67,
        isSelected: true,
      }),
    ]);
  });
});
