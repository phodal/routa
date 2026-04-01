import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HooksResponse, ReleaseTriggerRuleSummary } from "@/client/hooks/use-harness-settings-data";
import { HarnessReleaseTriggersPanel } from "../harness-release-triggers-panel";

function makeRule(overrides: Partial<ReleaseTriggerRuleSummary>): ReleaseTriggerRuleSummary {
  return {
    name: "test_rule",
    type: "unexpected_file",
    severity: "critical",
    action: "block_release",
    patterns: [],
    applyTo: [],
    paths: [],
    groupBy: [],
    baseline: null,
    maxGrowthPercent: null,
    minGrowthBytes: null,
    patternCount: 0,
    applyToCount: 0,
    pathCount: 0,
    ...overrides,
  };
}

function createHooksResponse(rules: ReleaseTriggerRuleSummary[] = []): HooksResponse {
  return {
    generatedAt: "2026-04-01T00:00:00.000Z",
    repoRoot: "/tmp/routa",
    hooksDir: "/tmp/routa/.husky",
    configFile: null,
    reviewTriggerFile: null,
    releaseTriggerFile: {
      relativePath: "docs/fitness/release-triggers.yaml",
      source: "release_triggers: []",
      ruleCount: rules.length,
      rules,
    },
    hookFiles: [],
    profiles: [],
    warnings: [],
  };
}

describe("HarnessReleaseTriggersPanel", () => {
  it("renders empty state when no release trigger file", () => {
    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        data={{ ...createHooksResponse(), releaseTriggerFile: null }}
      />,
    );
    expect(screen.getByText(/release-triggers\.yaml/i)).toBeDefined();
  });

  it("renders empty state when release trigger file has no rules", () => {
    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        data={createHooksResponse([])}
      />,
    );
    expect(screen.getByText(/defines no rules/i)).toBeDefined();
  });

  it("renders layer cards when rules are present", () => {
    const rules: ReleaseTriggerRuleSummary[] = [
      makeRule({
        name: "unexpected_sourcemap_in_release",
        type: "unexpected_file",
        severity: "critical",
        action: "block_release",
        patterns: ["**/*.map"],
        applyTo: ["npm_tarball", "tauri_bundle"],
        patternCount: 1,
        applyToCount: 2,
      }),
      makeRule({
        name: "cli_binary_growth_guard",
        type: "artifact_size_delta",
        severity: "high",
        action: "require_human_review",
        groupBy: ["target", "arch"],
        baseline: "last_successful_same_target",
        maxGrowthPercent: 20,
        minGrowthBytes: 2097152,
      }),
      makeRule({
        name: "packaging_boundary_changed",
        type: "release_boundary_change",
        severity: "high",
        action: "require_human_review",
        paths: ["package.json", ".github/workflows/**"],
        pathCount: 2,
      }),
      makeRule({
        name: "capability_or_supply_chain_drift",
        type: "capability_change",
        severity: "high",
        action: "require_human_review",
        paths: ["apps/desktop/src-tauri/capabilities/**"],
        pathCount: 1,
      }),
    ];

    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        data={createHooksResponse(rules)}
      />,
    );

    expect(screen.getByText(/Layer 1: Exposure/i)).toBeDefined();
    expect(screen.getByText(/Layer 2: Artifact Drift/i)).toBeDefined();
    expect(screen.getByText(/Layer 3: Boundary Drift/i)).toBeDefined();
    expect(screen.getByText(/Layer 4: Capability Drift/i)).toBeDefined();
  });

  it("shows action summary badges", () => {
    const rules: ReleaseTriggerRuleSummary[] = [
      makeRule({ name: "block_rule", action: "block_release", type: "unexpected_file" }),
      makeRule({ name: "review_rule", action: "require_human_review", type: "artifact_size_delta" }),
    ];

    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        data={createHooksResponse(rules)}
      />,
    );

    expect(screen.getAllByText(/block.*release/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/human review/i).length).toBeGreaterThan(0);
  });

  it("renders loading state", () => {
    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        loading
      />,
    );
    expect(screen.getByText(/Release Surface Governance/i)).toBeDefined();
  });

  it("renders unsupported message", () => {
    render(
      <HarnessReleaseTriggersPanel
        repoLabel="routa"
        unsupportedMessage="Repo not supported"
      />,
    );
    expect(screen.getByText(/Release Surface Governance/i)).toBeDefined();
  });
});
