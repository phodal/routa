use std::fs;
use std::path::Path;

use chrono::Utc;

use super::{
    apply_patches, AutomationSummary, EvolutionContext, FitnessSummary, HarnessEngineeringAction,
    HarnessEngineeringGap, HarnessEngineeringInputs, HarnessEngineeringOptions,
    HarnessEngineeringPatchCandidate, HarnessEngineeringReport, HarnessEngineeringSummary,
    HarnessEngineeringVerificationStep, SpecSummary, TemplateSummary,
};

pub(super) fn should_bootstrap(repo_root: &Path) -> bool {
    let harness_dir = repo_root.join("docs/harness");
    let build_config = harness_dir.join("build.yml");
    let test_config = harness_dir.join("test.yml");

    !harness_dir.exists() || (!build_config.exists() && !test_config.exists())
}

pub(super) async fn bootstrap_weak_repository(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringReport, String> {
    let mut warnings = Vec::new();
    let mut gaps = Vec::new();
    let mut recommended_actions = Vec::new();
    let mut patch_candidates = Vec::new();

    let package_json_path = repo_root.join("package.json");
    let scripts = if package_json_path.exists() {
        match fs::read_to_string(&package_json_path) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => extract_scripts_from_package_json(&json),
                Err(e) => {
                    warnings.push(format!("Failed to parse package.json: {e}"));
                    Vec::new()
                }
            },
            Err(e) => {
                warnings.push(format!("Failed to read package.json: {e}"));
                Vec::new()
            }
        }
    } else {
        warnings.push("No package.json found. Bootstrap requires package.json.".to_string());
        Vec::new()
    };

    gaps.push(HarnessEngineeringGap {
        id: "bootstrap.missing_harness_directory".to_string(),
        category: "missing_execution_surface".to_string(),
        severity: "high".to_string(),
        harness_mutation_candidate: true,
        title: "Missing docs/harness directory".to_string(),
        detail: "Repository has no harness configuration. Bootstrap mode will synthesize initial surfaces.".to_string(),
        evidence: Vec::new(),
        suggested_fix: "Create docs/harness/ with build.yml and test.yml".to_string(),
    });

    if !scripts.is_empty() {
        let build_scripts =
            collect_bootstrap_script_matches(&scripts, &["build", "compile", "bundle"]);
        let test_scripts = collect_bootstrap_script_matches(&scripts, &["test", "spec"]);

        if let Some((script_name, script_command)) =
            select_preferred_bootstrap_script(&build_scripts, "build")
        {
            patch_candidates.push(HarnessEngineeringPatchCandidate {
                id: "bootstrap.synthesize_build_yml".to_string(),
                risk: "low".to_string(),
                title: "Synthesize build.yml from detected scripts".to_string(),
                targets: vec!["docs/harness/build.yml".to_string()],
                change_kind: "create".to_string(),
                rationale: format!(
                    "Detected {} build-related scripts: {}",
                    build_scripts.len(),
                    build_scripts
                        .iter()
                        .map(|(name, _)| name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                script_name: Some(script_name.to_string()),
                script_command: Some(script_command.to_string()),
            });
        }

        if let Some((script_name, script_command)) =
            select_preferred_bootstrap_script(&test_scripts, "test")
        {
            patch_candidates.push(HarnessEngineeringPatchCandidate {
                id: "bootstrap.synthesize_test_yml".to_string(),
                risk: "low".to_string(),
                title: "Synthesize test.yml from detected scripts".to_string(),
                targets: vec!["docs/harness/test.yml".to_string()],
                change_kind: "create".to_string(),
                rationale: format!(
                    "Detected {} test-related scripts: {}",
                    test_scripts.len(),
                    test_scripts
                        .iter()
                        .map(|(name, _)| name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                script_name: Some(script_name.to_string()),
                script_command: Some(script_command.to_string()),
            });
        }
    }

    recommended_actions.push(HarnessEngineeringAction {
        gap_id: "bootstrap.missing_harness_directory".to_string(),
        priority: 1,
        action: "Create docs/harness/ directory and initialize build.yml and test.yml".to_string(),
        rationale: "Required for harness surface definitions".to_string(),
    });

    recommended_actions.push(HarnessEngineeringAction {
        gap_id: "bootstrap.missing_harness_directory".to_string(),
        priority: 2,
        action: "Run initial fluency evaluation to establish baseline snapshot".to_string(),
        rationale: "Creates first reference point for harness maturity tracking".to_string(),
    });

    let summary = HarnessEngineeringSummary {
        total_gaps: gaps.len(),
        blocking_gaps: gaps.iter().filter(|gap| gap.severity == "high").count(),
        harness_mutation_candidates: gaps
            .iter()
            .filter(|gap| gap.harness_mutation_candidate)
            .count(),
        non_harness_gaps: 0,
        low_risk_patch_candidates: patch_candidates.len(),
    };
    let verification_plan = vec![HarnessEngineeringVerificationStep {
        label: "Verify harness directory created".to_string(),
        command: "test -d docs/harness".to_string(),
        proves: "Harness configuration directory exists".to_string(),
    }];

    let apply_outcome = if options.apply && !patch_candidates.is_empty() {
        let evolution_context = EvolutionContext {
            session_id: None,
            workflow: Some("bootstrap".to_string()),
            gaps_detected: gaps.len(),
            gap_categories: gaps.iter().map(|g| g.category.clone()).collect(),
            rollback_reason: None,
            error_messages: None,
        };

        Some(apply_patches(
            repo_root,
            &patch_candidates,
            &verification_plan,
            options,
            Some(&evolution_context),
        )?)
    } else {
        None
    };

    Ok(HarnessEngineeringReport {
        generated_at: Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: "bootstrap".to_string(),
        report_path: options.output_path.display().to_string(),
        summary,
        inputs: HarnessEngineeringInputs {
            repo_signals: None,
            templates: TemplateSummary {
                templates_checked: 0,
                drift_error_count: 0,
                drift_warning_count: 0,
                missing_sensor_files: 0,
                missing_automation_refs: 0,
                warnings: 0,
            },
            automations: AutomationSummary {
                definition_count: 0,
                pending_signal_count: 0,
                recent_run_count: 0,
                definition_only_count: 0,
                warnings: 0,
            },
            specs: SpecSummary {
                source_count: 0,
                feature_count: 0,
                systems: Vec::new(),
                warnings: 0,
            },
            fitness: FitnessSummary {
                manifest_present: false,
                fluency_snapshots_loaded: 0,
                blocking_criteria_count: 0,
                critical_blocking_criteria_count: 0,
            },
        },
        gaps,
        recommended_actions,
        patch_candidates,
        verification_plan,
        verification_results: apply_outcome
            .as_ref()
            .map(|outcome| outcome.verification_results.clone())
            .unwrap_or_default(),
        ratchet: apply_outcome.map(|outcome| outcome.ratchet),
        ai_assessment: None,
        warnings,
    })
}

fn extract_scripts_from_package_json(json: &serde_json::Value) -> Vec<(String, String)> {
    json.get("scripts")
        .and_then(|s| s.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, value)| {
                    value
                        .as_str()
                        .map(|command| (key.clone(), command.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn collect_bootstrap_script_matches<'a>(
    scripts: &'a [(String, String)],
    terms: &[&str],
) -> Vec<&'a (String, String)> {
    scripts
        .iter()
        .filter(|(name, _)| terms.iter().any(|term| name.contains(term)))
        .collect()
}

fn select_preferred_bootstrap_script<'a>(
    matches: &'a [&'a (String, String)],
    preferred_name: &str,
) -> Option<(&'a str, &'a str)> {
    matches
        .iter()
        .find(|(name, _)| name == preferred_name)
        .or_else(|| matches.first())
        .map(|(name, command)| (name.as_str(), command.as_str()))
}

fn detect_package_manager(repo_root: &Path) -> &'static str {
    if repo_root.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if repo_root.join("yarn.lock").exists() {
        "yarn"
    } else if repo_root.join("bun.lockb").exists() || repo_root.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

pub(super) fn format_script_invocation(
    repo_root: &Path,
    script_name: &str,
    script_command: Option<&str>,
) -> String {
    match detect_package_manager(repo_root) {
        "pnpm" => format!("pnpm run {script_name}"),
        "yarn" => format!("yarn {script_name}"),
        "bun" => format!("bun run {script_name}"),
        "npm" => format!("npm run {script_name}"),
        _ => script_command.unwrap_or(script_name).to_string(),
    }
}
