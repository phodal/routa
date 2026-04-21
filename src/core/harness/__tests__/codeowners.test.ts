import { describe, expect, it } from "vitest";
import {
  buildOwnershipRoutingContext,
  matchFileToRule,
  parseCodeownersContent,
  resolveOwnership,
} from "../codeowners";
import { evaluateReviewTriggers, parseReviewTriggerConfig } from "../review-triggers";

describe("parseCodeownersContent", () => {
  it("parses rules with single owner", () => {
    const content = "*.js @frontend-team\n";
    const { rules, warnings } = parseCodeownersContent(content);
    expect(warnings).toHaveLength(0);
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe("*.js");
    expect(rules[0].owners).toHaveLength(1);
    expect(rules[0].owners[0].name).toBe("@frontend-team");
    expect(rules[0].owners[0].kind).toBe("user");
  });

  it("parses rules with multiple owners", () => {
    const content = "src/core/** @arch-team @platform-team\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules).toHaveLength(1);
    expect(rules[0].owners).toHaveLength(2);
    expect(rules[0].owners[0].name).toBe("@arch-team");
    expect(rules[0].owners[1].name).toBe("@platform-team");
  });

  it("skips comments and blank lines", () => {
    const content = "# Comment\n\n# Another\n*.ts @ts-team\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules).toHaveLength(1);
  });

  it("warns on pattern without owners", () => {
    const content = "src/core/**\n";
    const { rules, warnings } = parseCodeownersContent(content);
    expect(rules).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("pattern without owners");
  });

  it("classifies team owners", () => {
    const content = "*.ts @org/frontend-team\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules[0].owners[0].kind).toBe("team");
  });

  it("classifies email owners", () => {
    const content = "*.ts user@example.com\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules[0].owners[0].kind).toBe("email");
  });

  it("assigns incrementing precedence", () => {
    const content = "* @default\nsrc/** @src-team\nsrc/core/** @core-team\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules[0].precedence).toBe(0);
    expect(rules[1].precedence).toBe(1);
    expect(rules[2].precedence).toBe(2);
  });

  it("records line numbers correctly", () => {
    const content = "# header comment\n\n*.ts @ts-team\nsrc/** @src-team\n";
    const { rules } = parseCodeownersContent(content);
    expect(rules[0].line).toBe(3);
    expect(rules[1].line).toBe(4);
  });
});

describe("matchFileToRule", () => {
  it("matches wildcard pattern", () => {
    const { rules } = parseCodeownersContent("*.js @frontend\n");
    const rule = matchFileToRule("lib/utils.js", rules);
    expect(rule).not.toBeNull();
    expect(rule!.owners[0].name).toBe("@frontend");
  });

  it("matches directory glob", () => {
    const { rules } = parseCodeownersContent("src/core/** @core-team\n");
    const rule = matchFileToRule("src/core/handler.ts", rules);
    expect(rule).not.toBeNull();
    expect(rule!.owners[0].name).toBe("@core-team");
  });

  it("returns null for unmatched file", () => {
    const { rules } = parseCodeownersContent("src/** @src-team\n");
    const rule = matchFileToRule("docs/README.md", rules);
    expect(rule).toBeNull();
  });

  it("higher precedence rule wins", () => {
    const content = "* @default-team\nsrc/core/** @arch-team\n";
    const { rules } = parseCodeownersContent(content);
    const rule = matchFileToRule("src/core/handler.ts", rules);
    expect(rule).not.toBeNull();
    expect(rule!.owners[0].name).toBe("@arch-team");
  });

  it("matches catch-all pattern", () => {
    const { rules } = parseCodeownersContent("* @default\n");
    const rule = matchFileToRule("any/path/file.rs", rules);
    expect(rule).not.toBeNull();
  });

  it("keeps leading-slash file rules anchored to the repo root", () => {
    const { rules } = parseCodeownersContent("/README.md @docs\n");
    expect(matchFileToRule("README.md", rules)?.owners[0].name).toBe("@docs");
    expect(matchFileToRule("docs/README.md", rules)).toBeNull();
  });
});

describe("resolveOwnership", () => {
  it("resolves ownership for multiple files", () => {
    const content = "src/** @src-team\ndocs/** @docs-team\n";
    const { rules } = parseCodeownersContent(content);
    const matches = resolveOwnership(
      ["src/index.ts", "docs/README.md", "README.md"],
      rules,
    );

    expect(matches).toHaveLength(3);
    expect(matches[0].covered).toBe(true);
    expect(matches[0].owners[0].name).toBe("@src-team");
    expect(matches[1].covered).toBe(true);
    expect(matches[1].owners[0].name).toBe("@docs-team");
    expect(matches[2].covered).toBe(false);
    expect(matches[2].owners).toHaveLength(0);
  });

  it("detects overlapping ownership", () => {
    const content = "*.ts @ts-team\nsrc/** @src-team\n";
    const { rules } = parseCodeownersContent(content);
    const matches = resolveOwnership(["src/handler.ts"], rules);

    expect(matches[0].overlap).toBe(true);
    expect(matches[0].covered).toBe(true);
  });

  it("no overlap for single rule match", () => {
    const content = "src/** @src-team\ndocs/** @docs-team\n";
    const { rules } = parseCodeownersContent(content);
    const matches = resolveOwnership(["src/index.ts"], rules);

    expect(matches[0].overlap).toBe(false);
  });

  it("does not mark nested files as overlaps for root-anchored basename rules", () => {
    const content = "/package.json @root\npackages/** @packages\n";
    const { rules } = parseCodeownersContent(content);
    const matches = resolveOwnership(["packages/routa-cli/package.json", "package.json"], rules);

    expect(matches[0].covered).toBe(true);
    expect(matches[0].owners[0].name).toBe("@packages");
    expect(matches[0].overlap).toBe(false);
    expect(matches[1].covered).toBe(true);
    expect(matches[1].owners[0].name).toBe("@root");
    expect(matches[1].overlap).toBe(false);
  });

  it("builds trigger-aware ownership routing context", () => {
    const { rules } = parseCodeownersContent([
      "src/core/** @arch-team",
      "crates/** @platform-team",
    ].join("\n"));
    const matches = resolveOwnership([
      "src/core/review.ts",
      "crates/routa-server/src/api/harness.rs",
      "api-contract.yaml",
    ], rules);
    const triggerRules = parseReviewTriggerConfig([
      "review_triggers:",
      "  - name: cross_boundary_change_web_rust",
      "    type: cross_boundary_change",
      "    severity: medium",
      "    action: require_human_review",
      "    boundaries:",
      "      web:",
      "        - src/**",
      "      rust:",
      "        - crates/**",
      "  - name: sensitive_contract_or_governance_change",
      "    type: sensitive_file_change",
      "    severity: high",
      "    action: require_human_review",
      "    paths:",
      "      - api-contract.yaml",
    ].join("\n"));

    const routing = buildOwnershipRoutingContext({
      changedFiles: [
        "src/core/review.ts",
        "crates/routa-server/src/api/harness.rs",
        "api-contract.yaml",
      ],
      matches,
      triggerRules,
      matchedTriggerNames: [
        "cross_boundary_change_web_rust",
        "sensitive_contract_or_governance_change",
      ],
    });

    expect(routing.touchedOwners).toEqual(["@arch-team", "@platform-team"]);
    expect(routing.unownedChangedFiles).toEqual(["api-contract.yaml"]);
    expect(routing.highRiskUnownedFiles).toEqual(["api-contract.yaml"]);
    expect(routing.crossOwnerTriggers).toEqual(["cross_boundary_change_web_rust"]);
    expect(routing.triggerCorrelations).toHaveLength(2);
  });

  it("parses staged review trigger fields with normalized actions", () => {
    const [rule] = parseReviewTriggerConfig([
      "review_triggers:",
      "  - name: staged_security_review",
      "    type: changed_paths",
      "    severity: high",
      "    action: review",
      "    fallback_action: human_review",
      "    confidence_threshold: 12",
      "    specialist_id: security-reviewer",
      "    provider: codex",
      "    model: gpt-5.4",
      "    context:",
      "      - graph_review_context",
      "    review_layers:",
      "      - provider: codex",
      "        model: gpt-5.4-mini",
      "        confidence_threshold: 7",
      "      - provider: claude",
      "        model: claude-sonnet",
      "        confidence_threshold: 9",
      "    paths:",
      "      - src/core/acp/**",
    ].join("\n"));

    expect(rule?.action).toBe("staged");
    expect(rule?.fallbackAction).toBe("require_human_review");
    expect(rule?.confidenceThreshold).toBe(10);
    expect(rule?.specialistId).toBe("security-reviewer");
    expect(rule?.provider).toBe("codex");
    expect(rule?.model).toBe("gpt-5.4");
    expect(rule?.context).toEqual(["graph_review_context"]);
    expect(rule?.reviewLayers).toEqual([
      {
        confidenceThreshold: 7,
        specialistId: null,
        provider: "codex",
        model: "gpt-5.4-mini",
        context: [],
      },
      {
        confidenceThreshold: 9,
        specialistId: null,
        provider: "claude",
        model: "claude-sonnet",
        context: [],
      },
    ]);
  });

  it("evaluates staged review trigger reports with diff-size and path matches", () => {
    const rules = parseReviewTriggerConfig([
      "review_triggers:",
      "  - name: high_risk_directory_change",
      "    type: changed_paths",
      "    severity: high",
      "    action: staged",
      "    confidence_threshold: 8",
      "    fallback_action: require_human_review",
      "    paths:",
      "      - src/core/acp/**",
      "  - name: oversized_change",
      "    type: diff_size",
      "    severity: medium",
      "    action: advisory",
      "    max_files: 2",
      "    max_added_lines: 20",
    ].join("\n"));

    const report = evaluateReviewTriggers({
      rules,
      changedFiles: [
        "src/core/acp/session.ts",
        "src/core/orchestration/runner.ts",
        "src/client/app.tsx",
      ],
      diffStats: {
        fileCount: 3,
        addedLines: 24,
        deletedLines: 5,
      },
      base: "origin/main",
    });

    expect(report.base).toBe("origin/main");
    expect(report.stagedReviewRequired).toBe(true);
    expect(report.triggers.map((trigger) => trigger.name)).toEqual([
      "high_risk_directory_change",
      "oversized_change",
    ]);
    expect(report.triggers[0]?.action).toBe("staged");
    expect(report.triggers[0]?.confidenceThreshold).toBe(8);
    expect(report.triggers[1]?.action).toBe("advisory");
    expect(report.advisoryOnly).toBe(false);
  });
});
