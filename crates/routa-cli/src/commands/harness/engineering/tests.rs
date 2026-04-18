use super::{
    create_snapshot, evaluate_harness_engineering, rollback_snapshot, run_verification_plan,
    should_bootstrap, HarnessEngineeringOptions, HarnessEngineeringPatchCandidate,
    HarnessEngineeringVerificationStep, DEFAULT_REPORT_RELATIVE_PATH,
};
use std::fs;
use tempfile::tempdir;

fn write_fluency_snapshot(
    repo_root: &std::path::Path,
    relative_path: &str,
    profile: &str,
    overall_level: &str,
    overall_level_name: &str,
    baseline_score: f64,
) {
    let snapshot_path = repo_root.join(relative_path);
    fs::create_dir_all(snapshot_path.parent().expect("snapshot parent")).expect("snapshot dir");
    let snapshot = serde_json::json!({
        "modelVersion": 2,
        "modelPath": "docs/fitness/harness-fluency.model.yaml",
        "profile": profile,
        "mode": "deterministic",
        "framing": "fluency",
        "repoRoot": repo_root.display().to_string(),
        "generatedAt": "2026-04-06T00:00:00Z",
        "snapshotPath": snapshot_path.display().to_string(),
        "overallLevel": overall_level,
        "overallLevelName": overall_level_name,
        "currentLevelReadiness": 1.0,
        "nextLevel": serde_json::Value::Null,
        "nextLevelName": serde_json::Value::Null,
        "nextLevelReadiness": serde_json::Value::Null,
        "blockingTargetLevel": serde_json::Value::Null,
        "blockingTargetLevelName": serde_json::Value::Null,
        "dimensions": {},
        "capabilityGroups": {},
        "evidencePacks": [],
        "cells": [],
        "criteria": [],
        "blockingCriteria": [],
        "recommendations": [],
        "baseline": {
            "summary": {
                "score": baseline_score,
                "overallLevel": overall_level,
                "overallLevelName": overall_level_name,
                "currentReadiness": 1.0,
                "nextLevel": serde_json::Value::Null,
                "nextLevelName": serde_json::Value::Null
            },
            "dominantGaps": [],
            "topActions": [],
            "autonomyRecommendation": {
                "band": "high",
                "rationale": "test baseline"
            }
        },
        "comparison": serde_json::Value::Null
    });
    fs::write(
        snapshot_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&snapshot).expect("serialize snapshot")
        ),
    )
    .expect("write snapshot");
}

#[tokio::test]
async fn reports_missing_bootstrap_surfaces_for_weak_repo() {
    let temp = tempdir().expect("tempdir");
    fs::write(
        temp.path().join("package.json"),
        r#"{"name":"weak-repo","scripts":{"test":"vitest"}}"#,
    )
    .expect("package.json");

    let report = evaluate_harness_engineering(
        temp.path(),
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: true,
            bootstrap: false,
            apply: false,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
        None,
    )
    .await
    .expect("report");

    assert!(report
        .gaps
        .iter()
        .any(|gap| gap.id == "harness_surfaces.missing"));
    assert!(report
        .patch_candidates
        .iter()
        .any(|patch| patch.id == "patch.create_build_surface"));
    assert!(report
        .patch_candidates
        .iter()
        .any(|patch| patch.id == "patch.create_test_surface"));
}

#[tokio::test]
async fn classifies_fluency_blockers_into_harness_and_non_harness() {
    let temp = tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("docs/fitness/reports")).expect("reports");
    fs::write(
        temp.path().join("docs/fitness/manifest.yaml"),
        "schema: fitness-manifest-v1\n",
    )
    .expect("manifest");
    fs::write(
        temp.path().join("docs/fitness/reports/harness-fluency-latest.json"),
        r#"{
          "overallLevel": "agent_centric",
          "blockingCriteria": [
            {
              "id": "governance.agent_first.machine_readable_guardrails",
              "critical": true,
              "detail": "missing CODEOWNERS",
              "evidence": ["docs/fitness/review-triggers.yaml"],
              "whyItMatters": "guardrails",
              "recommendedAction": "Add CODEOWNERS",
              "evidenceHint": "docs/fitness/review-triggers.yaml plus CODEOWNERS / dependabot / renovate"
            },
            {
              "id": "context.agent_first.reference_and_runbook_depth",
              "critical": true,
              "detail": "missing layered references",
              "evidence": [],
              "whyItMatters": "runbooks",
              "recommendedAction": "Add more references",
              "evidenceHint": "docs/references/**/*.md + docs/issues/*.md"
            }
          ]
        }"#,
    )
    .expect("snapshot");

    let report = evaluate_harness_engineering(
        temp.path(),
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: true,
            bootstrap: false,
            apply: false,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
        None,
    )
    .await
    .expect("report");

    assert!(report.gaps.iter().any(|gap| {
        gap.id == "fluency.generic.governance.agent_first.machine_readable_guardrails"
            && gap.category == "missing_governance_gate"
            && gap.harness_mutation_candidate
    }));
    assert!(report.gaps.iter().any(|gap| {
        gap.id == "fluency.generic.context.agent_first.reference_and_runbook_depth"
            && gap.category == "non_harness_engineering_gap"
            && !gap.harness_mutation_candidate
    }));
}

#[tokio::test]
async fn detects_fluency_automation_target_mismatch() {
    let temp = tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("docs/harness")).expect("harness dir");
    fs::write(
        temp.path().join("docs/harness/automations.yml"),
        r#"schema: harness-automation-v1
definitions:
  - id: weekly-harness-fluency
    name: Weekly harness fluency
    description: Re-run the harness fluency specialist.
    source:
      type: schedule
      cron: "0 3 * * 1"
    target:
      type: specialist
      ref: harness-test
"#,
    )
    .expect("automations");

    let report = evaluate_harness_engineering(
        temp.path(),
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: true,
            bootstrap: false,
            apply: false,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
        None,
    )
    .await
    .expect("report");

    assert!(report
        .gaps
        .iter()
        .any(|gap| gap.id == "automation.weekly-harness-fluency.target_mismatch"));
    assert!(report
        .patch_candidates
        .iter()
        .any(|patch| patch.id == "patch.normalize_automation_target"));
}

#[test]
fn bootstrap_detects_weak_repo() {
    let temp = tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("src dir");
    fs::write(
        temp.path().join("package.json"),
        r#"{"name":"test","scripts":{"build":"tsc","test":"vitest"}}"#,
    )
    .expect("package.json");

    assert!(should_bootstrap(temp.path()));
}

#[test]
fn bootstrap_skips_repo_with_existing_harness() {
    let temp = tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("docs/harness")).expect("harness dir");
    fs::write(temp.path().join("docs/harness/build.yml"), "# stub").expect("build.yml");

    assert!(!should_bootstrap(temp.path()));
}

#[tokio::test]
async fn apply_mode_creates_harness_files() {
    let temp = tempdir().expect("tempdir");
    fs::write(
        temp.path().join("package.json"),
        r#"{"name":"test","scripts":{"compile":"tsc -b","spec":"vitest run"}}"#,
    )
    .expect("package.json");

    let report = evaluate_harness_engineering(
        temp.path(),
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: false,
            bootstrap: true,
            apply: true,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
        None,
    )
    .await
    .expect("report");

    assert!(temp.path().join("docs/harness/build.yml").exists());
    assert!(temp.path().join("docs/harness/test.yml").exists());
    assert!(temp
        .path()
        .join("docs/fitness/reports/harness-fluency-latest.json")
        .exists());
    assert!(temp
        .path()
        .join("docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json")
        .exists());
    assert!(report
        .ratchet
        .as_ref()
        .is_some_and(|ratchet| ratchet.enforced));
    assert!(report.ratchet.as_ref().is_some_and(|ratchet| ratchet
        .profiles
        .iter()
        .any(|profile| profile.status == "established")));

    let build_content =
        fs::read_to_string(temp.path().join("docs/harness/build.yml")).expect("build.yml content");
    assert!(build_content.contains("schema: harness-surface-v1"));
    assert!(build_content.contains("^compile$"));
    assert!(build_content.contains("npm run compile"));

    let test_content =
        fs::read_to_string(temp.path().join("docs/harness/test.yml")).expect("test.yml content");
    assert!(test_content.contains("schema: harness-surface-v1"));
    assert!(test_content.contains("^spec$"));
    assert!(test_content.contains("npm run spec"));
}

#[tokio::test]
async fn apply_mode_rolls_back_when_ratchet_regresses() {
    let temp = tempdir().expect("tempdir");
    fs::write(
        temp.path().join("package.json"),
        r#"{"name":"test","scripts":{"compile":"tsc -b","spec":"vitest run"}}"#,
    )
    .expect("package.json");
    write_fluency_snapshot(
        temp.path(),
        "docs/fitness/reports/harness-fluency-latest.json",
        "generic",
        "agent_first",
        "Agent-First",
        0.95,
    );
    write_fluency_snapshot(
        temp.path(),
        "docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json",
        "agent_orchestrator",
        "agent_first",
        "Agent-First",
        0.95,
    );

    let error = evaluate_harness_engineering(
        temp.path(),
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: false,
            bootstrap: true,
            apply: true,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
        None,
    )
    .await
    .expect_err("ratchet should reject regression");

    assert!(error.contains("Harness ratchet regressed"));
    assert!(!temp.path().join("docs/harness/build.yml").exists());
    assert!(!temp.path().join("docs/harness/test.yml").exists());
}

#[test]
fn rollback_snapshot_removes_newly_created_files() {
    let temp = tempdir().expect("tempdir");
    let patch = HarnessEngineeringPatchCandidate {
        id: "bootstrap.synthesize_build_yml".to_string(),
        risk: "low".to_string(),
        title: "create build".to_string(),
        rationale: "test".to_string(),
        targets: vec!["docs/harness/build.yml".to_string()],
        change_kind: "create".to_string(),
        script_name: Some("build".to_string()),
        script_command: Some("tsc".to_string()),
    };

    let snapshot =
        create_snapshot(temp.path(), std::slice::from_ref(&patch)).expect("create snapshot");
    let created = temp.path().join("docs/harness/build.yml");
    fs::create_dir_all(created.parent().expect("parent")).expect("create harness dir");
    fs::write(&created, "generated").expect("write generated file");

    rollback_snapshot(temp.path(), &snapshot).expect("rollback snapshot");

    assert!(!created.exists());
}

#[test]
fn verification_plan_executes_successfully() {
    let temp = tempdir().expect("tempdir");
    fs::write(temp.path().join("marker.txt"), "ok").expect("marker");
    let steps = vec![HarnessEngineeringVerificationStep {
        label: "Marker exists".to_string(),
        command: "test -f marker.txt".to_string(),
        proves: "The marker file is present.".to_string(),
    }];

    let results = run_verification_plan(
        temp.path(),
        &steps,
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: false,
            bootstrap: false,
            apply: true,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
    )
    .expect("verification succeeds");

    assert_eq!(results.len(), 1);
    assert!(results[0].success);
}

#[test]
fn verification_plan_reports_failures() {
    let temp = tempdir().expect("tempdir");
    let steps = vec![HarnessEngineeringVerificationStep {
        label: "Missing marker".to_string(),
        command: "test -f marker.txt".to_string(),
        proves: "The marker file is present.".to_string(),
    }];

    let error = run_verification_plan(
        temp.path(),
        &steps,
        &HarnessEngineeringOptions {
            output_path: temp.path().join(DEFAULT_REPORT_RELATIVE_PATH),
            dry_run: false,
            bootstrap: false,
            apply: true,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: false,
        },
    )
    .unwrap_err();

    assert!(error.contains("Missing marker"));
}
