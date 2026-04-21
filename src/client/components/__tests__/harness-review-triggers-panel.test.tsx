import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HooksResponse, ReviewTriggerLayerSummary, ReviewTriggerRuleSummary } from "@/client/hooks/use-harness-settings-data";
import { HarnessReviewTriggersPanel } from "../harness-review-triggers-panel";

function createReviewTriggerRule(
  overrides: Partial<ReviewTriggerRuleSummary>,
): ReviewTriggerRuleSummary {
  return {
    name: "rule",
    type: "changed_paths",
    severity: "medium",
    action: "require_human_review",
    paths: [],
    evidencePaths: [],
    boundaries: [],
    directories: [],
    pathCount: 0,
    evidencePathCount: 0,
    boundaryCount: 0,
    directoryCount: 0,
    minBoundaries: null,
    maxFiles: null,
    maxAddedLines: null,
    maxDeletedLines: null,
    confidenceThreshold: null,
    fallbackAction: null,
    specialistId: null,
    provider: null,
    model: null,
    context: [],
    contextCount: 0,
    reviewLayers: [],
    reviewLayerCount: 0,
    ...overrides,
  };
}

function createReviewTriggerLayer(
  overrides: Partial<ReviewTriggerLayerSummary>,
): ReviewTriggerLayerSummary {
  return {
    confidenceThreshold: null,
    specialistId: null,
    provider: null,
    model: null,
    context: [],
    contextCount: 0,
    ...overrides,
  };
}

function createHooksResponse(): HooksResponse {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    repoRoot: "/Users/phodal/ai/routa-js",
    hooksDir: "/Users/phodal/ai/routa-js/.husky",
    configFile: {
      relativePath: "docs/fitness/runtime/hooks.yaml",
      source: "schema: hook-runtime-v1",
      schema: "hook-runtime-v1",
    },
    reviewTriggerFile: {
      relativePath: "docs/fitness/review-triggers.yaml",
      source: "review_triggers: []",
      ruleCount: 7,
      rules: [
        createReviewTriggerRule({
          name: "high_risk_directory_change",
          type: "changed_paths",
          severity: "high",
          action: "require_human_review",
          paths: [
            "src/core/acp/**",
            "src/core/orchestration/**",
            "crates/routa-server/src/api/**",
          ],
          evidencePaths: [],
          boundaries: [],
          directories: [],
          pathCount: 3,
          evidencePathCount: 0,
          boundaryCount: 0,
          directoryCount: 0,
          minBoundaries: null,
          maxFiles: null,
          maxAddedLines: null,
          maxDeletedLines: null,
          confidenceThreshold: 8,
          fallbackAction: "require_human_review",
          provider: "codex",
          model: "gpt-5.4-mini",
          specialistId: "security-reviewer",
          context: ["graph_review_context"],
          contextCount: 1,
          reviewLayers: [
            createReviewTriggerLayer({
              provider: "codex",
              model: "gpt-5.4-mini",
              confidenceThreshold: 7,
            }),
            createReviewTriggerLayer({
              provider: "claude",
              model: "claude-sonnet",
              confidenceThreshold: 9,
            }),
          ],
          reviewLayerCount: 2,
        }),
        createReviewTriggerRule({
          name: "sensitive_contract_or_governance_change",
          type: "sensitive_file_change",
          severity: "high",
          action: "require_human_review",
          paths: [
            "api-contract.yaml",
            "docs/fitness/manifest.yaml",
            "docs/fitness/review-triggers.yaml",
            ".github/workflows/defense.yaml",
          ],
          evidencePaths: [],
          boundaries: [],
          directories: [],
          pathCount: 4,
          evidencePathCount: 0,
          boundaryCount: 0,
          directoryCount: 0,
          minBoundaries: null,
          maxFiles: null,
          maxAddedLines: null,
          maxDeletedLines: null,
        }),
        createReviewTriggerRule({
          name: "fitness_evidence_gap_for_core_paths",
          type: "evidence_gap",
          severity: "medium",
          action: "require_human_review",
          paths: [
            "src/core/acp/**",
            "src/core/orchestration/**",
            "crates/routa-server/src/api/**",
          ],
          evidencePaths: [
            "docs/fitness/**",
            "crates/entrix/**",
            ".github/workflows/defense.yaml",
          ],
          boundaries: [],
          directories: [],
          pathCount: 3,
          evidencePathCount: 3,
          boundaryCount: 0,
          directoryCount: 0,
          minBoundaries: null,
          maxFiles: null,
          maxAddedLines: null,
          maxDeletedLines: null,
        }),
        createReviewTriggerRule({
          name: "api_contract_evidence_gap",
          type: "evidence_gap",
          severity: "high",
          action: "require_human_review",
          paths: ["api-contract.yaml"],
          evidencePaths: [
            "docs/fitness/api-contract.md",
            "scripts/fitness/check-api-parity.ts",
            "scripts/fitness/validate-openapi-schema.ts",
            "src/app/api/**",
            "crates/routa-server/src/api/**",
            "docs/fitness/unit-test.md",
            "docs/fitness/rust-api-test.md",
          ],
          boundaries: [],
          directories: [],
          pathCount: 1,
          evidencePathCount: 7,
          boundaryCount: 0,
          directoryCount: 0,
          minBoundaries: null,
          maxFiles: null,
          maxAddedLines: null,
          maxDeletedLines: null,
        }),
        createReviewTriggerRule({
          name: "cross_boundary_change_web_rust",
          type: "cross_boundary_change",
          severity: "medium",
          action: "require_human_review",
          paths: [],
          evidencePaths: [],
          boundaries: [
            {
              name: "web",
              paths: ["src/**", "apps/web/**"],
            },
            {
              name: "rust",
              paths: ["crates/**", "apps/desktop/src-tauri/**"],
            },
          ],
          directories: [],
          pathCount: 0,
          evidencePathCount: 0,
          boundaryCount: 2,
          directoryCount: 0,
          minBoundaries: 2,
          maxFiles: null,
          maxAddedLines: null,
          maxDeletedLines: null,
        }),
        createReviewTriggerRule({
          name: "directory_file_count_guard",
          type: "directory_file_count",
          severity: "medium",
          action: "require_human_review",
          paths: [],
          evidencePaths: [],
          boundaries: [],
          directories: ["scripts"],
          pathCount: 0,
          evidencePathCount: 0,
          boundaryCount: 0,
          directoryCount: 1,
          minBoundaries: null,
          maxFiles: 20,
          maxAddedLines: null,
          maxDeletedLines: null,
        }),
        createReviewTriggerRule({
          name: "oversized_change",
          type: "diff_size",
          severity: "medium",
          action: "require_human_review",
          paths: [],
          evidencePaths: [],
          boundaries: [],
          directories: [],
          pathCount: 0,
          evidencePathCount: 0,
          boundaryCount: 0,
          directoryCount: 0,
          minBoundaries: null,
          maxFiles: 12,
          maxAddedLines: 600,
          maxDeletedLines: 400,
        }),
      ],
    },
    hookFiles: [
      {
        name: "pre-push",
        relativePath: ".husky/pre-push",
        source: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push \"$@\"",
        triggerCommand: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push \"$@\"",
        kind: "runtime-profile",
        runtimeProfileName: "pre-push",
        skipEnvVar: "SKIP_HOOKS",
      },
    ],
    profiles: [
      {
        name: "pre-push",
        phases: ["fitness", "review"],
        fallbackMetrics: ["ts_test_pass", "rust_test_pass"],
        hooks: ["pre-push"],
        metrics: [],
      },
    ],
    releaseTriggerFile: null,
    warnings: [],
  };
}

describe("HarnessReviewTriggersPanel", () => {
  it("keeps the cards compact and removes aggregate summary boxes", () => {
    render(
      <HarnessReviewTriggersPanel
        repoLabel="routa-js"
        data={createHooksResponse()}
      />,
    );

    expect(screen.getByText("Review triggers")).not.toBeNull();
    expect(screen.queryByText(/high severity/i)).toBeNull();
    expect(screen.queryByText("Path scope")).toBeNull();
    expect(screen.queryByText("Protected scope")).toBeNull();
    expect(screen.queryByText("Human review routing")).toBeNull();
    expect(screen.queryByRole("button", { name: /Details/i })).toBeNull();
  });

  it("shows real rule paths and thresholds without requiring expansion", () => {
    render(
      <HarnessReviewTriggersPanel
        repoLabel="routa-js"
        data={createHooksResponse()}
      />,
    );

    expect(screen.getAllByText("src/core/acp/**").length).toBeGreaterThan(0);
    expect(screen.getAllByText("crates/routa-server/src/api/**").length).toBeGreaterThan(0);
    expect(screen.getAllByText("api-contract.yaml").length).toBeGreaterThan(0);
    expect(screen.getAllByText("docs/fitness/api-contract.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("scripts/fitness/check-api-parity.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("min 2 boundaries")).not.toBeNull();
    expect(screen.getByText("max 20 files")).not.toBeNull();
    expect(screen.getByText("+600 lines")).not.toBeNull();
    expect(screen.getByText("-400 lines")).not.toBeNull();
  });

  it("shows routing profiles and hook commands by default", () => {
    render(
      <HarnessReviewTriggersPanel
        repoLabel="routa-js"
        data={createHooksResponse()}
      />,
    );

    expect(screen.getAllByText("Require Human Review").length).toBeGreaterThan(0);
    expect(screen.getByText(".husky/pre-push")).not.toBeNull();
    expect(
      screen.getByText('node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push "$@"'),
    ).not.toBeNull();
  });

  it("shows advanced routing fields and layered reviewer overrides", () => {
    render(
      <HarnessReviewTriggersPanel
        repoLabel="routa-js"
        data={createHooksResponse()}
      />,
    );

    expect(screen.getByText("Fallback action")).not.toBeNull();
    expect(screen.getAllByText("Require Human Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Provider").length).toBeGreaterThan(0);
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Model").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-5.4-mini").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Specialist").length).toBeGreaterThan(0);
    expect(screen.getByText("security-reviewer")).not.toBeNull();
    expect(screen.getAllByText("Context").length).toBeGreaterThan(0);
    expect(screen.getAllByText("graph_review_context").length).toBeGreaterThan(0);
    expect(screen.getByText("Review layers")).not.toBeNull();
    expect(screen.getByText("Layer 1")).not.toBeNull();
    expect(screen.getByText("Layer 2")).not.toBeNull();
    expect(screen.getByText("claude-sonnet")).not.toBeNull();
    expect(screen.getByText("confidence 9/10")).not.toBeNull();
  });

  it("keeps loop sidebar compact until details are requested", () => {
    render(
      <HarnessReviewTriggersPanel
        repoLabel="routa-js"
        data={createHooksResponse()}
        variant="compact"
        showDetailToggle
        defaultShowDetails={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Show details" })).not.toBeNull();
    expect(screen.getAllByText("src/core/acp/**").length).toBe(2);
    expect(screen.queryByText("docs/fitness/api-contract.md")).toBeNull();
    expect(screen.queryByText("Trigger command")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByRole("button", { name: "Hide details" })).not.toBeNull();
    expect(screen.getByText("docs/fitness/api-contract.md")).not.toBeNull();
    expect(screen.getByText("Trigger command")).not.toBeNull();
  });
});
