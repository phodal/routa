import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateHarnessFluency,
  formatTextReport,
  loadFluencyModel,
  parseArgs,
} from "../index.js";

function writeJson(targetPath: string, value: unknown): void {
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("loadFluencyModel", () => {
  it("loads the production generic model and enforces at least two criteria per cell", async () => {
    const model = await loadFluencyModel(path.resolve(process.cwd(), "docs/fitness/harness-fluency.model.yaml"));

    expect(model.levels).toHaveLength(5);
    expect(model.dimensions).toHaveLength(5);
    expect(model.criteria).toHaveLength(50);

    for (const level of model.levels) {
      for (const dimension of model.dimensions) {
        const criteria = model.criteria.filter(
          (criterion) => criterion.level === level.id && criterion.dimension === dimension.id,
        );
        expect(criteria.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("loads the agent_orchestrator profile as a merged overlay", async () => {
    const genericModel = await loadFluencyModel(path.resolve(process.cwd(), "docs/fitness/harness-fluency.model.yaml"));
    const profileModel = await loadFluencyModel(
      path.resolve(process.cwd(), "docs/fitness/harness-fluency.profile.agent_orchestrator.yaml"),
    );

    expect(profileModel.version).toBe(genericModel.version);
    expect(profileModel.criteria.length).toBeGreaterThan(genericModel.criteria.length);
    expect(profileModel.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "harness.assisted.runtime_manager" }),
        expect.objectContaining({ id: "governance.agent_centric.entrix_runtime" }),
      ]),
    );
  });

  it("rejects cyclic model extends chains", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-cycle-"));
    const firstModelPath = path.join(repoRoot, "first.yaml");
    const secondModelPath = path.join(repoRoot, "second.yaml");

    writeFileSync(firstModelPath, "extends: ./second.yaml\n", "utf8");
    writeFileSync(secondModelPath, "extends: ./first.yaml\n", "utf8");

    await expect(loadFluencyModel(firstModelPath)).rejects.toThrow("cyclic harness fluency model extends");
  });

  it("rejects invalid regex flags in command_output_regex detectors", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-model-"));
    const modelPath = path.join(repoRoot, "model.yaml");

    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: one
    recommended_action: one
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.regex
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: two
    recommended_action: two
    evidence_hint: regex
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: linux
      flags: xyz
`,
      "utf8",
    );

    await expect(loadFluencyModel(modelPath)).rejects.toThrow("invalid regex settings");
  });
});

describe("parseArgs", () => {
  it("accepts repo-root, profile aliases, and profile-specific snapshot defaults", () => {
    const options = parseArgs([
      "--repo-root",
      "/tmp/repo",
      "--profile",
      "orchestrator",
      "--json",
      "--compare-last",
      "--no-save",
    ]);

    expect(options.repoRoot).toBe("/tmp/repo");
    expect(options.profile).toBe("agent_orchestrator");
    expect(options.format).toBe("json");
    expect(options.compareLast).toBe(true);
    expect(options.save).toBe(false);
    expect(options.modelPath).toBe(
      path.resolve(process.cwd(), "docs/fitness/harness-fluency.profile.agent_orchestrator.yaml"),
    );
    expect(options.snapshotPath).toBe(
      "/tmp/repo/docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json",
    );
  });

  it("rejects unsupported profile names", () => {
    expect(() => parseArgs(["--profile", "unknown-profile"])).toThrow('unsupported profile "unknown-profile"');
  });
});

describe("evaluateHarnessFluency", () => {
  it("evaluates a small repo, persists snapshots, and compares against the last run", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".github", "workflows"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
        "test:run": "vitest run",
      },
    });
    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(path.join(repoRoot, ".github", "workflows", "guard.yml"), "jobs:\n  build:\n    steps: []\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.operating_contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: Repo guidance must be durable.
    recommended_action: Add an AGENTS contract.
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.lint_script
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: Teams need a baseline feedback loop.
    recommended_action: Add a lint script.
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
  - id: collaboration.assisted.test_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: Assisted flows should verify changes.
    recommended_action: Add a test runner script.
    evidence_hint: package.json scripts.test:run
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, "test:run"]
  - id: collaboration.assisted.guard_workflow
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: Assisted flows should surface automation hooks.
    recommended_action: Add a guard workflow.
    evidence_hint: .github/workflows/guard.yml
    detector:
      type: yaml_path_exists
      path: .github/workflows/guard.yml
      yamlPath: [jobs, build, steps]
`,
      "utf8",
    );

    const firstReport = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: true,
      save: true,
    });
    expect(firstReport.overallLevel).toBe("assisted");
    expect(firstReport.comparison).toBeNull();

    const guardWorkflow = path.join(repoRoot, ".github", "workflows", "guard.yml");
    writeFileSync(guardWorkflow, "name: guard\n", "utf8");

    const secondReport = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: true,
      save: false,
    });

    expect(secondReport.overallLevel).toBe("awareness");
    expect(secondReport.comparison?.overallChange).toBe("down");
    expect(secondReport.comparison?.criteriaChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.assisted.guard_workflow",
          previousStatus: "pass",
          currentStatus: "fail",
        }),
      ]),
    );

    const textReport = formatTextReport(secondReport);
    expect(textReport).toContain("HARNESS FLUENCY REPORT");
    expect(textReport).toContain("Blocking Gaps To Assisted");
  });

  it("blocks next-level readiness behind current-level debt", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-readiness-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "README.md"), "# contract\n", "utf8");
    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
        "test:run": "vitest run",
      },
    });
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: contract
    recommended_action: add contract
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.agent_doc
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: agent doc
    recommended_action: add AGENTS
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.assisted.test_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: tests
    recommended_action: add tests
    evidence_hint: package.json scripts.test:run
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, "test:run"]
  - id: collaboration.assisted.lint_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: lint
    recommended_action: add lint
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.overallLevel).toBe("awareness");
    expect(report.currentLevelReadiness).toBe(0.5);
    expect(report.nextLevel).toBe("assisted");
    expect(report.nextLevelReadiness).toBeNull();
    expect(report.blockingTargetLevel).toBe("awareness");
    expect(report.blockingCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.agent_doc",
          status: "fail",
        }),
      ]),
    );

    const textReport = formatTextReport(report);
    expect(textReport).toContain("Current Level Readiness: 50%");
    expect(textReport).toContain("Next Level Readiness: Blocked until Awareness is stable");
    expect(textReport).toContain("Blocking Gaps To Stabilize Awareness");
  });

  it("reports next-level gaps once the current level is stable", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-next-gap-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
      },
    });
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: contract
    recommended_action: add contract
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.lint
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: lint
    recommended_action: add lint
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
  - id: collaboration.assisted.test_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: tests
    recommended_action: add tests
    evidence_hint: package.json scripts.test:run
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, "test:run"]
  - id: collaboration.assisted.lint_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: lint
    recommended_action: keep lint
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.overallLevel).toBe("awareness");
    expect(report.currentLevelReadiness).toBe(1);
    expect(report.nextLevelReadiness).toBe(0.5);
    expect(report.blockingTargetLevel).toBe("assisted");
    expect(report.blockingCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.assisted.test_script",
          status: "fail",
        }),
      ]),
    );

    const textReport = formatTextReport(report);
    expect(textReport).toContain("Next Level Readiness: 50%");
    expect(textReport).toContain("Blocking Gaps To Assisted");
    expect(textReport).not.toContain("Blocked until Awareness is stable");
  });

  it("reports top-level repos without blockers", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-top-level-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
        "test:run": "vitest run",
      },
    });
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: contract
    recommended_action: add contract
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.lint
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: lint
    recommended_action: add lint
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
  - id: collaboration.assisted.test_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: tests
    recommended_action: add tests
    evidence_hint: package.json scripts.test:run
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, "test:run"]
  - id: collaboration.assisted.lint_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: lint
    recommended_action: keep lint
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.overallLevel).toBe("assisted");
    expect(report.currentLevelReadiness).toBe(1);
    expect(report.nextLevel).toBeNull();
    expect(report.nextLevelReadiness).toBeNull();
    expect(report.blockingTargetLevel).toBeNull();
    expect(report.blockingCriteria).toEqual([]);

    const textReport = formatTextReport(report);
    expect(textReport).toContain("Next Level: Reached top level");
    expect(textReport).toContain("Blocking Gaps: none");
  });

  it("covers remaining detector types with safe command execution", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-detectors-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, "docs", "issues"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".claude", "skills"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, ".claude", "skills", "README.md"), "skill\n", "utf8");
    writeFileSync(path.join(repoRoot, "docs", "issues", "one.md"), "# one\n", "utf8");
    writeFileSync(path.join(repoRoot, "docs", "issues", "two.md"), "# two\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.skill_dir
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: skills matter
    recommended_action: add skills
    evidence_hint: .claude/skills
    detector:
      type: any_file_exists
      paths:
        - .claude/skills
        - .agents/skills
  - id: collaboration.awareness.issue_history
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: history matters
    recommended_action: add issues
    evidence_hint: docs/issues/*.md
    detector:
      type: glob_count
      patterns:
        - docs/issues/*.md
      min: 2
  - id: collaboration.assisted.command_exit
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: command checks matter
    recommended_action: add command checks
    evidence_hint: node -p 1
    detector:
      type: command_exit_code
      command: node -p 1
      expectedExitCode: 0
  - id: collaboration.assisted.command_output
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: output checks matter
    recommended_action: add output checks
    evidence_hint: node -p process.platform
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: ^(darwin|linux|win32)$
      flags: ""
  - id: collaboration.assisted.attestation
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: manual checks matter
    recommended_action: document manual checks
    evidence_hint: manual prompt
    detector:
      type: manual_attestation
      prompt: Confirm org process
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.overallLevel).toBe("assisted");
    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "collaboration.awareness.skill_dir", status: "pass" }),
        expect.objectContaining({ id: "collaboration.awareness.issue_history", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.command_exit", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.command_output", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.attestation", status: "skipped" }),
      ]),
    );
  });

  it("matches file and glob regex detectors against repo content", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-regex-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, "src", "runtime"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "README.md"), "# AI coding assistant\nUse this agent workflow.\n", "utf8");
    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
        "test:run": "vitest run",
      },
    });
    writeFileSync(
      path.join(repoRoot, "src", "runtime", "manager.ts"),
      "export class RuntimeManager {}\n",
      "utf8",
    );
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: contract
    recommended_action: contract
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.ai_text
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: ai text
    recommended_action: ai text
    evidence_hint: README.md
    detector:
      type: file_contains_regex
      path: README.md
      pattern: '\\b(ai|agent)\\b'
      flags: i
  - id: collaboration.assisted.commands
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: commands
    recommended_action: commands
    evidence_hint: package.json scripts
    detector:
      type: glob_contains_regex
      patterns:
        - package.json
      pattern: '"scripts"\\s*:\\s*\\{'
      flags: i
      minMatches: 1
  - id: harness.assisted.runtime
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: runtime
    recommended_action: runtime
    evidence_hint: src/runtime/*.ts
    detector:
      type: glob_contains_regex
      patterns:
        - src/**/*.ts
      pattern: 'RuntimeManager'
      flags: i
      minMatches: 1
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "collaboration.awareness.ai_text", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.commands", status: "pass" }),
        expect.objectContaining({ id: "harness.assisted.runtime", status: "pass" }),
      ]),
    );
  });

  it("supports any_of composite detectors for contract-like fallbacks", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-any-of-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
    writeFileSync(
      path.join(repoRoot, "CONTRIBUTING.md"),
      "Contributor workflow guide for Gemini agents and review rules.\n",
      "utf8",
    );
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.readme
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: readme
    recommended_action: readme
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: contract
    recommended_action: contract
    evidence_hint: GEMINI.md or docs
    detector:
      type: any_of
      detectors:
        - type: any_file_exists
          paths:
            - GEMINI.md
            - AGENTS.md
        - type: glob_contains_regex
          patterns:
            - CONTRIBUTING.md
          pattern: 'gemini[^\\n]{0,40}(workflow|rules)'
          flags: i
          minMatches: 1
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.contract",
          status: "pass",
          detail: expect.stringContaining("matched glob_contains_regex"),
          evidence: ["CONTRIBUTING.md"],
        }),
      ]),
    );
  });

  it("ignores vendored and generated directories when matching glob detectors", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-ignore-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, "node_modules", "pkg", "__tests__"), { recursive: true });
    mkdirSync(path.join(repoRoot, "vendor", "pkg", "__tests__"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
    writeFileSync(path.join(repoRoot, "node_modules", "pkg", "__tests__", "dep.spec.ts"), "dep\n", "utf8");
    writeFileSync(path.join(repoRoot, "vendor", "pkg", "__tests__", "vendor.spec.ts"), "vendor\n", "utf8");
    writeFileSync(path.join(repoRoot, "tests", "app.spec.ts"), "real\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.readme
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: readme
    recommended_action: readme
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.readme_text
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: readme text
    recommended_action: readme text
    evidence_hint: README.md
    detector:
      type: file_contains_regex
      path: README.md
      pattern: repo
      flags: i
  - id: collaboration.assisted.real_tests
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: real tests
    recommended_action: real tests
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_count
      patterns:
        - tests/**/*.spec.ts
        - node_modules/**/*.spec.ts
        - vendor/**/*.spec.ts
      min: 2
  - id: collaboration.assisted.real_test_text
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: real test text
    recommended_action: real test text
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_contains_regex
      patterns:
        - tests/**/*.spec.ts
        - node_modules/**/*.spec.ts
        - vendor/**/*.spec.ts
      pattern: real
      flags: i
      minMatches: 1
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.assisted.real_tests",
          status: "fail",
          detail: "matched 1 paths (min 2)",
        }),
        expect.objectContaining({
          id: "collaboration.assisted.real_test_text",
          status: "pass",
          evidence: ["tests/app.spec.ts"],
        }),
      ]),
    );
  });

  it("skips snapshot comparison when the previous snapshot model version is incompatible", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-compare-skip-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 2
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.path
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: AGENTS.md
    detector:
      type: any_file_exists
      paths:
        - AGENTS.md
`,
      "utf8",
    );

    writeJson(snapshotPath, {
      modelVersion: 1,
      profile: "generic",
      generatedAt: "2026-03-26T00:00:00.000Z",
      overallLevel: "awareness",
      dimensions: {},
      criteria: [],
    });

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: true,
      save: false,
    });

    expect(report.comparison).toBeNull();
  });

  it("fails disallowed command executables instead of executing via shell", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-guard-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.command
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: command
    recommended_action: command
    evidence_hint: bash -lc pwd
    detector:
      type: command_exit_code
      command: bash -lc pwd
      expectedExitCode: 0
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.command",
          status: "fail",
          detail: expect.stringContaining('command executable "bash" is not allowed'),
        }),
      ]),
    );
  });

  it("rejects path-based command executables before allowlist checks", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-path-guard-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.command
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: command
    recommended_action: command
    evidence_hint: ./node -p 1
    detector:
      type: command_exit_code
      command: ./node -p 1
      expectedExitCode: 0
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.command",
          status: "fail",
          detail: expect.stringContaining('command executable "./node" must be a bare allowlisted name'),
        }),
      ]),
    );
  });
});
