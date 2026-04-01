import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";
import { HarnessReviewTriggersPanel } from "../harness-review-triggers-panel";

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
        {
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
        },
        {
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
        },
        {
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
            "tools/entrix/**",
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
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
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
        },
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

    expect(screen.getByText("Require Human Review")).not.toBeNull();
    expect(screen.getByText(".husky/pre-push")).not.toBeNull();
    expect(
      screen.getByText('node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push "$@"'),
    ).not.toBeNull();
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
