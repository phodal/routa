use super::model::load_fluency_model;
use super::types::{CriterionStatus, EvidenceMode, FluencyMode, LevelChange};
use super::{evaluate_harness_fluency, format_text_report, EvaluateOptions};
use serde_json::json;
use std::fs::{create_dir_all, write};
use std::path::Path;
use std::process::Command;
use tempfile::tempdir;

fn write_json(path: &Path, value: serde_json::Value) {
    write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&value).unwrap()),
    )
    .unwrap();
}

fn init_git_repo(repo_root: &Path) {
    let init = Command::new("git")
        .args(["init"])
        .current_dir(repo_root)
        .status()
        .unwrap();
    assert!(init.success(), "git init should succeed");

    let add = Command::new("git")
        .args(["add", "."])
        .current_dir(repo_root)
        .status()
        .unwrap();
    assert!(add.success(), "git add should succeed");
}

#[test]
fn loads_generic_model_and_enforces_two_criteria_per_cell() {
    let model = load_fluency_model(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("docs/fitness/harness-fluency.model.yaml")
            .as_path(),
    )
    .expect("model");

    assert_eq!(model.levels.len(), 5);
    assert_eq!(model.dimensions.len(), 5);
    assert_eq!(model.criteria.len(), 50);

    for level in &model.levels {
        for dimension in &model.dimensions {
            let count = model
                .criteria
                .iter()
                .filter(|criterion| {
                    criterion.level == level.id && criterion.dimension == dimension.id
                })
                .count();
            assert!(
                count >= 2,
                "missing coverage for {} × {}",
                dimension.id,
                level.id
            );
        }
    }
}

#[test]
fn loads_agent_orchestrator_profile_as_overlay() {
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let generic_model =
        load_fluency_model(&workspace_root.join("docs/fitness/harness-fluency.model.yaml"))
            .expect("generic model");
    let overlay_model = load_fluency_model(
        &workspace_root.join("docs/fitness/harness-fluency.profile.agent_orchestrator.yaml"),
    )
    .expect("overlay model");

    assert_eq!(overlay_model.version, generic_model.version);
    assert!(overlay_model.criteria.len() > generic_model.criteria.len());
    assert!(overlay_model
        .criteria
        .iter()
        .any(|criterion| criterion.id == "harness.assisted.runtime_manager"));
    assert!(overlay_model
        .criteria
        .iter()
        .any(|criterion| criterion.id == "governance.agent_centric.entrix_runtime"));
}

#[test]
fn rejects_cyclic_model_extends() {
    let repo = tempdir().unwrap();
    let first_model = repo.path().join("first.yaml");
    let second_model = repo.path().join("second.yaml");

    write(&first_model, "extends: ./second.yaml\n").unwrap();
    write(&second_model, "extends: ./first.yaml\n").unwrap();

    let error = load_fluency_model(&first_model).expect_err("expected cycle error");
    assert!(error.contains("cyclic harness fluency model extends"));
}

#[test]
fn rejects_invalid_regex_flags_in_model() {
    let repo = tempdir().unwrap();
    let model_path = repo.path().join("model.yaml");
    write(
        &model_path,
        r#"version: 1
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
"#,
    )
    .unwrap();

    let error = load_fluency_model(&model_path).expect_err("expected invalid regex error");
    assert!(error.contains("invalid regex settings"));
}

#[test]
fn parses_capability_groups_profiles_and_ai_metadata() {
    let repo = tempdir().unwrap();
    let model_path = repo.path().join("model.yaml");
    write(
        &model_path,
        r#"version: 3
capability_groups:
  - id: execution_surface
    name: Execution Surface
  - id: workflow_automation
    name: Workflow Automation
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.cli_surface
    level: awareness
    dimension: collaboration
    capability_group: execution_surface
    profiles: [generic, agent_orchestrator]
    weight: 1
    critical: true
    evidence_mode: hybrid
    why_it_matters: cli
    recommended_action: cli
    evidence_hint: package.json
    ai_check:
      prompt_template: fluency-capability-scorer
      requires: [code_excerpt, runtime_surface]
    detector:
      type: any_of
      detectors:
        - type: file_exists
          path: package.json
  - id: collaboration.awareness.docs
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: docs
    recommended_action: docs
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
"#,
    )
    .unwrap();

    let model = load_fluency_model(&model_path).expect("model");
    assert_eq!(model.capability_groups.len(), 2);

    let cli_surface = model
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.awareness.cli_surface")
        .expect("cli surface criterion");
    assert_eq!(cli_surface.capability_group, "execution_surface");
    assert_eq!(
        cli_surface.profiles,
        vec!["generic".to_string(), "agent_orchestrator".to_string()]
    );
    assert_eq!(cli_surface.evidence_mode, EvidenceMode::Hybrid);
    let ai_check = cli_surface.ai_check.as_ref().expect("ai check");
    assert_eq!(ai_check.prompt_template, "fluency-capability-scorer");
    assert_eq!(
        ai_check.requires,
        vec!["code_excerpt".to_string(), "runtime_surface".to_string()]
    );

    let docs = model
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.awareness.docs")
        .expect("docs criterion");
    assert_eq!(docs.capability_group, "collaboration");
    assert!(docs.profiles.is_empty());
}

#[test]
fn evaluates_snapshots_commands_and_manual_attestation() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join("docs/issues")).unwrap();
    create_dir_all(repo_root.join(".claude/skills")).unwrap();

    write(repo_root.join(".claude/skills/README.md"), "skill\n").unwrap();
    write(repo_root.join("docs/issues/one.md"), "# one\n").unwrap();
    write(repo_root.join("docs/issues/two.md"), "# two\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
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
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "assisted");
    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.assisted.command_exit"
            && criterion.status == CriterionStatus::Pass
    }));
    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.assisted.attestation"
            && criterion.status == CriterionStatus::Skipped
    }));
}

#[test]
fn ignores_generated_and_workspace_noise_in_glob_detectors() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join(".routa/repos/demo/tests")).unwrap();
    create_dir_all(repo_root.join(".next-page-snapshots/dev/server/chunks")).unwrap();
    create_dir_all(repo_root.join("frontend/_next/static/chunks")).unwrap();
    create_dir_all(repo_root.join(".worktrees/demo/tests")).unwrap();
    create_dir_all(repo_root.join("tests")).unwrap();

    write(repo_root.join("README.md"), "# repo\n").unwrap();
    write(
        repo_root.join(".routa/repos/demo/tests/fake.spec.ts"),
        "fake\n",
    )
    .unwrap();
    write(
        repo_root.join(".worktrees/demo/tests/fake.spec.ts"),
        "fake\n",
    )
    .unwrap();
    write(
        repo_root.join(".next-page-snapshots/dev/server/chunks/runtime.ts"),
        "export class RuntimeManager {}\n",
    )
    .unwrap();
    write(
        repo_root.join("frontend/_next/static/chunks/runtime.js"),
        "export class RuntimeManager {}\n",
    )
    .unwrap();
    write(repo_root.join("tests/app.spec.ts"), "real\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
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
        - .routa/**/*.spec.ts
        - .worktrees/**/*.spec.ts
      min: 2
  - id: collaboration.assisted.real_runtime
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: runtime
    recommended_action: runtime
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_contains_regex
      patterns:
        - tests/**/*.spec.ts
        - .next-page-snapshots/**/*.ts
        - frontend/_next/**/*.js
      pattern: RuntimeManager|real
      flags: i
      minMatches: 1
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let count = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.assisted.real_tests")
        .unwrap();
    assert_eq!(count.status, CriterionStatus::Fail);
    assert_eq!(count.detail, "matched 1 paths (min 2)");

    let regex = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.assisted.real_runtime")
        .unwrap();
    assert_eq!(regex.status, CriterionStatus::Pass);
    assert_eq!(regex.evidence, vec!["tests/app.spec.ts".to_string()]);
}

#[test]
fn compares_against_previous_snapshot() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
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
  - id: collaboration.assisted.script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: script
    recommended_action: script
    evidence_hint: package.json
    detector:
      type: file_exists
      path: package.json
  - id: collaboration.assisted.path
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: package.json
    detector:
      type: any_file_exists
      paths:
        - package.json
"#,
    )
    .unwrap();
    write_json(
        &snapshot_path,
        json!({
            "modelVersion": 1,
            "modelPath": model_path.display().to_string(),
            "profile": "generic",
            "repoRoot": repo_root.display().to_string(),
            "generatedAt": "2026-03-26T00:00:00.000Z",
            "snapshotPath": snapshot_path.display().to_string(),
            "overallLevel": "assisted",
            "overallLevelName": "Assisted",
            "currentLevelReadiness": 1.0,
            "nextLevel": null,
            "nextLevelName": null,
            "nextLevelReadiness": null,
            "blockingTargetLevel": null,
            "blockingTargetLevelName": null,
            "dimensions": {
                "collaboration": {
                    "dimension": "collaboration",
                    "name": "Collaboration",
                    "level": "assisted",
                    "levelName": "Assisted",
                    "levelIndex": 1,
                    "score": 1.0,
                    "nextLevel": null,
                    "nextLevelName": null,
                    "nextLevelProgress": null
                }
            },
            "cells": [],
            "criteria": [
                {
                    "id": "collaboration.awareness.file",
                    "level": "awareness",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": true,
                    "status": "pass",
                    "detectorType": "file_exists",
                    "detail": "found AGENTS.md",
                    "evidence": ["AGENTS.md"],
                    "whyItMatters": "file",
                    "recommendedAction": "file",
                    "evidenceHint": "AGENTS.md"
                },
                {
                    "id": "collaboration.awareness.path",
                    "level": "awareness",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": false,
                    "status": "pass",
                    "detectorType": "any_file_exists",
                    "detail": "found AGENTS.md",
                    "evidence": ["AGENTS.md"],
                    "whyItMatters": "path",
                    "recommendedAction": "path",
                    "evidenceHint": "AGENTS.md"
                },
                {
                    "id": "collaboration.assisted.path",
                    "level": "assisted",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": false,
                    "status": "pass",
                    "detectorType": "any_file_exists",
                    "detail": "found package.json",
                    "evidence": ["package.json"],
                    "whyItMatters": "path",
                    "recommendedAction": "path",
                    "evidenceHint": "package.json"
                },
                {
                    "id": "collaboration.assisted.script",
                    "level": "assisted",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": true,
                    "status": "pass",
                    "detectorType": "file_exists",
                    "detail": "found package.json",
                    "evidence": ["package.json"],
                    "whyItMatters": "script",
                    "recommendedAction": "script",
                    "evidenceHint": "package.json"
                }
            ],
            "blockingCriteria": [],
            "recommendations": [],
            "comparison": null
        }),
    );

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: true,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "awareness");
    assert_eq!(
        report.comparison.as_ref().unwrap().overall_change,
        LevelChange::Down
    );
    let text = format_text_report(&report);
    assert!(text.contains("HARNESS FLUENCY REPORT"));
    assert!(text.contains("Comparison To Last Snapshot:"));
}

#[test]
fn blocks_next_level_readiness_when_current_level_has_debt() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(repo_root.join("README.md"), "# contract\n").unwrap();
    write_json(
        &repo_root.join("package.json"),
        json!({
            "scripts": {
                "lint": "eslint .",
                "test:run": "vitest run"
            }
        }),
    );
    write(
        &model_path,
        r#"version: 1
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
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "awareness");
    assert_eq!(report.current_level_readiness, 0.5);
    assert_eq!(report.next_level.as_deref(), Some("assisted"));
    assert_eq!(report.next_level_readiness, None);
    assert_eq!(report.blocking_target_level.as_deref(), Some("awareness"));
    assert!(report.blocking_criteria.iter().any(|criterion| criterion.id
        == "collaboration.awareness.agent_doc"
        && criterion.status == CriterionStatus::Fail));

    let text = format_text_report(&report);
    assert!(text.contains("Current Level Readiness: 50%"));
    assert!(text.contains("Next Level Readiness: Blocked until Awareness is stable"));
    assert!(text.contains("Blocking Gaps To Stabilize Awareness"));
}

#[test]
fn reports_top_level_without_blockers() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();
    write_json(
        &repo_root.join("package.json"),
        json!({
            "scripts": {
                "lint": "eslint .",
                "test:run": "vitest run"
            }
        }),
    );
    write(
        &model_path,
        r#"version: 1
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
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "assisted");
    assert_eq!(report.current_level_readiness, 1.0);
    assert_eq!(report.next_level, None);
    assert_eq!(report.next_level_readiness, None);
    assert_eq!(report.blocking_target_level, None);
    assert!(report.blocking_criteria.is_empty());

    let text = format_text_report(&report);
    assert!(text.contains("Next Level: Reached top level"));
    assert!(text.contains("Blocking Gaps: none"));
}

#[test]
fn rejects_non_allowlisted_command_executables() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
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
      expected_exit_code: 0
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.awareness.command"
            && criterion.status == CriterionStatus::Fail
            && criterion
                .detail
                .contains("command executable \"bash\" is not allowed")
    }));
}

#[test]
fn rejects_path_based_command_executables_before_allowlist_checks() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
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
      expected_exit_code: 0
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.awareness.command"
            && criterion.status == CriterionStatus::Fail
            && criterion.detail.contains("must be a bare allowlisted name")
    }));
}

#[test]
fn evaluates_capability_group_summary_and_profile_filtering() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("README.md"), "# repo\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 3
capability_groups:
  - id: execution_surface
    name: Execution Surface
  - id: workflow_automation
    name: Workflow Automation
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.repo_docs
    level: awareness
    dimension: collaboration
    capability_group: execution_surface
    profiles: [generic]
    weight: 2
    critical: true
    why_it_matters: docs
    recommended_action: docs
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.workflow_docs
    level: awareness
    dimension: collaboration
    capability_group: workflow_automation
    profiles: [agent_orchestrator]
    weight: 1
    critical: false
    evidence_mode: ai
    why_it_matters: workflows
    recommended_action: workflows
    evidence_hint: .github/workflows
    ai_check:
      prompt_template: fluency-capability-scorer
    detector:
      type: file_exists
      path: .github/workflows/ci.yml
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.criteria.len(), 1);
    let criterion = report.criteria.first().expect("criterion");
    assert_eq!(
        criterion.capability_group.as_deref(),
        Some("execution_surface")
    );
    assert_eq!(
        criterion.capability_group_name.as_deref(),
        Some("Execution Surface")
    );
    assert_eq!(criterion.evidence_mode, super::types::EvidenceMode::Static);

    let execution_surface = report
        .capability_groups
        .get("execution_surface")
        .expect("execution surface");
    assert_eq!(execution_surface.name, "Execution Surface");
    assert_eq!(execution_surface.criterion_count, 1);
    assert_eq!(execution_surface.passing_criteria, 1);
    assert_eq!(execution_surface.failing_criteria, 0);
    assert_eq!(execution_surface.critical_failures, 0);
    assert_eq!(execution_surface.applicable_weight, 2);
    assert_eq!(execution_surface.passed_weight, 2);
    assert_eq!(execution_surface.score, 1.0);
    assert_eq!(
        execution_surface.evidence_modes.get("static").copied(),
        Some(1)
    );
    assert!(!report.capability_groups.contains_key("workflow_automation"));
}

#[test]
fn evaluates_all_of_detector() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("README.md"), "# repo\n").unwrap();
    write_json(
        &repo_root.join("package.json"),
        json!({
            "scripts": {
                "lint": "eslint ."
            }
        }),
    );

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.composite
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: all checks
    recommended_action: all checks
    evidence_hint: README.md + package.json scripts.lint
    detector:
      type: all_of
      detectors:
        - type: file_exists
          path: README.md
        - type: json_path_exists
          path: package.json
          jsonPath: [scripts, lint]
  - id: collaboration.awareness.docs
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: docs
    recommended_action: docs
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let criterion = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.awareness.composite")
        .expect("composite criterion");
    assert_eq!(criterion.status, CriterionStatus::Pass);
    assert_eq!(criterion.detector_type, "all_of");
    assert!(criterion.evidence.iter().any(|value| value == "README.md"));
    assert!(criterion
        .evidence
        .iter()
        .any(|value| value == "package.json"));
}

#[test]
fn evaluates_codeowners_routing_detector_failures() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join(".github")).unwrap();
    create_dir_all(repo_root.join("src/core")).unwrap();
    create_dir_all(repo_root.join("crates/routa-server/src/api")).unwrap();

    write(repo_root.join("README.md"), "# repo\n").unwrap();
    write(
        repo_root.join(".github/CODEOWNERS"),
        "src/** @web-team\ncrates/** @rust-team\ndocs/fitness/review-triggers.yaml @governance-team\n",
    )
    .unwrap();
    write(
        repo_root.join("src/core/review.ts"),
        "export const review = true;\n",
    )
    .unwrap();
    write(
        repo_root.join("crates/routa-server/src/api/handler.rs"),
        "pub fn handler() {}\n",
    )
    .unwrap();
    write(repo_root.join("api-contract.yaml"), "openapi: 3.0.0\n").unwrap();
    write(
        repo_root.join("docs/fitness/review-triggers.yaml"),
        [
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
        ]
        .join("\n"),
    )
    .unwrap();
    init_git_repo(repo_root);

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: governance
    name: Governance
criteria:
  - id: governance.awareness.readme
    level: awareness
    dimension: governance
    weight: 1
    critical: true
    why_it_matters: docs
    recommended_action: docs
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: governance.awareness.codeowners
    level: awareness
    dimension: governance
    weight: 1
    critical: false
    why_it_matters: ownership routing
    recommended_action: align CODEOWNERS with review triggers
    evidence_hint: .github/CODEOWNERS + docs/fitness/review-triggers.yaml
    detector:
      type: codeowners_routing
      requireCodeowners: true
      maxSensitiveUnownedFiles: 0
      requireTriggerAlignment: true
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let criterion = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "governance.awareness.codeowners")
        .expect("codeowners criterion");
    assert_eq!(criterion.status, CriterionStatus::Fail);
    assert_eq!(criterion.detector_type, "codeowners_routing");
    assert!(criterion.detail.contains("sensitive unowned files: 1 > 0"));
    assert!(criterion.detail.contains("trigger ownership gaps: 1"));
    assert!(criterion
        .evidence
        .iter()
        .any(|value| value == ".github/CODEOWNERS"));
    assert!(criterion
        .evidence
        .iter()
        .any(|value| value == "docs/fitness/review-triggers.yaml"));
    assert!(criterion
        .evidence
        .iter()
        .any(|value| value == "api-contract.yaml"));
    assert!(criterion
        .evidence
        .iter()
        .any(|value| value == "trigger:sensitive_contract_or_governance_change"));
}

#[test]
fn evaluates_codeowners_routing_detector_when_ownership_is_aligned() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join(".github")).unwrap();
    create_dir_all(repo_root.join("src/core")).unwrap();
    create_dir_all(repo_root.join("crates/routa-server/src/api")).unwrap();

    write(repo_root.join("README.md"), "# repo\n").unwrap();
    write(
        repo_root.join(".github/CODEOWNERS"),
        "src/** @web-team\ncrates/** @rust-team\napi-contract.yaml @api-team\ndocs/fitness/review-triggers.yaml @governance-team\n",
    )
    .unwrap();
    write(
        repo_root.join("src/core/review.ts"),
        "export const review = true;\n",
    )
    .unwrap();
    write(
        repo_root.join("crates/routa-server/src/api/handler.rs"),
        "pub fn handler() {}\n",
    )
    .unwrap();
    write(repo_root.join("api-contract.yaml"), "openapi: 3.0.0\n").unwrap();
    write(
        repo_root.join("docs/fitness/review-triggers.yaml"),
        [
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
        ]
        .join("\n"),
    )
    .unwrap();
    init_git_repo(repo_root);

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: governance
    name: Governance
criteria:
  - id: governance.awareness.readme
    level: awareness
    dimension: governance
    weight: 1
    critical: true
    why_it_matters: docs
    recommended_action: docs
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: governance.awareness.codeowners
    level: awareness
    dimension: governance
    weight: 1
    critical: false
    why_it_matters: ownership routing
    recommended_action: align CODEOWNERS with review triggers
    evidence_hint: .github/CODEOWNERS + docs/fitness/review-triggers.yaml
    detector:
      type: codeowners_routing
      requireCodeowners: true
      maxSensitiveUnownedFiles: 0
      requireTriggerAlignment: true
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let criterion = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "governance.awareness.codeowners")
        .expect("codeowners criterion");
    assert_eq!(criterion.status, CriterionStatus::Pass);
    assert_eq!(criterion.detector_type, "codeowners_routing");
    assert!(criterion.detail.contains("CODEOWNERS routing healthy"));
    assert!(criterion.detail.contains("0 sensitive gaps"));
    assert!(criterion.detail.contains("0 trigger gaps"));
    assert_eq!(
        criterion.evidence,
        vec![
            ".github/CODEOWNERS".to_string(),
            "docs/fitness/review-triggers.yaml".to_string()
        ]
    );
}

#[test]
fn hybrid_mode_prepares_evidence_packs() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("README.md"), "# repo\nline2\nline3\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.hybrid_signal
    level: awareness
    dimension: collaboration
    capability_group: collaboration
    weight: 1
    critical: true
    evidence_mode: hybrid
    why_it_matters: hybrid signal
    recommended_action: hybrid action
    evidence_hint: README.md
    ai_check:
      prompt_template: fluency-capability-scorer
      requires: [code_excerpt]
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.static_signal
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: static signal
    recommended_action: static action
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Hybrid,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.mode, FluencyMode::Hybrid);
    assert_eq!(report.evidence_packs.len(), 1);
    let pack = report.evidence_packs.first().expect("evidence pack");
    assert_eq!(pack.criterion_id, "collaboration.awareness.hybrid_signal");
    assert!(pack
        .selection_reasons
        .iter()
        .any(|reason| reason == "non_static_evidence"));
    assert!(pack
        .selection_reasons
        .iter()
        .any(|reason| reason == "ai_check_requested"));
    assert_eq!(
        pack.ai_prompt_template.as_deref(),
        Some("fluency-capability-scorer")
    );
    assert_eq!(pack.ai_requires, vec!["code_excerpt".to_string()]);
    assert_eq!(pack.excerpts.len(), 1);
    assert_eq!(pack.excerpts[0].path, "README.md");
    assert!(pack.excerpts[0].content.contains("# repo"));
}
