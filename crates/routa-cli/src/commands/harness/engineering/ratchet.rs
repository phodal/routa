use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::fitness::{
    evaluate_harness_fluency, CriterionStatus, EvaluateOptions, FluencyMode, HarnessFluencyReport,
    LevelChange, ReportFraming,
};

use super::{
    emit_apply_progress, HarnessEngineeringOptions, HarnessEngineeringRatchetProfileResult,
    HarnessEngineeringRatchetResult, HarnessEngineeringVerificationResult,
    GENERIC_FLUENCY_SNAPSHOT_RELATIVE_PATH, ORCHESTRATOR_FLUENCY_SNAPSHOT_RELATIVE_PATH,
};

const GENERIC_FLUENCY_MODEL_RELATIVE_PATH: &str = "docs/fitness/harness-fluency.model.yaml";
const ORCHESTRATOR_FLUENCY_MODEL_RELATIVE_PATH: &str =
    "docs/fitness/harness-fluency.profile.agent_orchestrator.yaml";
const BASELINE_SCORE_EPSILON: f64 = 0.001;

pub(super) struct ApplyOutcome {
    pub verification_results: Vec<HarnessEngineeringVerificationResult>,
    pub ratchet: HarnessEngineeringRatchetResult,
}

struct RatchetProfileSpec {
    profile: &'static str,
    model_relative_path: &'static str,
    snapshot_relative_path: &'static str,
}

struct PendingRatchetSnapshot {
    snapshot_path: PathBuf,
    report: HarnessFluencyReport,
}

pub(super) fn run_ratchet_loop(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringRatchetResult, String> {
    emit_apply_progress(options, "");
    emit_apply_progress(options, "📈 Harness Evolution - Ratchet");
    emit_apply_progress(options, "────────────────────────────");

    let workspace_root = resolve_routa_workspace_root()?;
    let profile_specs = [
        RatchetProfileSpec {
            profile: "generic",
            model_relative_path: GENERIC_FLUENCY_MODEL_RELATIVE_PATH,
            snapshot_relative_path: GENERIC_FLUENCY_SNAPSHOT_RELATIVE_PATH,
        },
        RatchetProfileSpec {
            profile: "agent_orchestrator",
            model_relative_path: ORCHESTRATOR_FLUENCY_MODEL_RELATIVE_PATH,
            snapshot_relative_path: ORCHESTRATOR_FLUENCY_SNAPSHOT_RELATIVE_PATH,
        },
    ];

    let mut profiles = Vec::new();
    let mut pending_snapshots = Vec::new();
    let mut regressed_profiles = Vec::new();

    for spec in profile_specs {
        let model_path = resolve_fluency_model_path(repo_root, &workspace_root, &spec)?;
        let snapshot_path = repo_root.join(spec.snapshot_relative_path);
        let previous_report = load_harness_fluency_report(&snapshot_path)?;
        let compare_last = previous_report.is_some();
        let current_report = evaluate_harness_fluency(&EvaluateOptions {
            repo_root: repo_root.to_path_buf(),
            model_path,
            profile: spec.profile.to_string(),
            mode: FluencyMode::Deterministic,
            framing: ReportFraming::Fluency,
            snapshot_path: snapshot_path.clone(),
            compare_last,
            save: false,
        })?;

        let ratchet_profile = build_ratchet_profile_result(
            spec.profile,
            &snapshot_path,
            previous_report.as_ref(),
            &current_report,
        );
        if ratchet_profile.status == "regressed" {
            regressed_profiles.push(ratchet_profile.profile.clone());
        }
        emit_apply_progress(
            options,
            format!(
                "  [{}] {} -> {}",
                ratchet_profile.status,
                ratchet_profile.profile,
                ratchet_profile.current_overall_level
            ),
        );
        if let Some(delta) = ratchet_profile.baseline_score_delta {
            emit_apply_progress(options, format!("    baseline delta: {delta:+.3}"));
        }
        if !ratchet_profile.regressed_criteria.is_empty() {
            emit_apply_progress(
                options,
                format!(
                    "    regressed criteria: {}",
                    ratchet_profile.regressed_criteria.join(", ")
                ),
            );
        }

        profiles.push(ratchet_profile);
        pending_snapshots.push(PendingRatchetSnapshot {
            snapshot_path,
            report: current_report,
        });
    }

    if profiles.is_empty() {
        return Err(
            "Harness ratchet could not evaluate any fluency profiles; no baseline was enforced."
                .to_string(),
        );
    }

    if !regressed_profiles.is_empty() {
        return Err(format!(
            "Harness ratchet regressed for profile(s): {}",
            regressed_profiles.join(", ")
        ));
    }

    persist_ratchet_snapshots(&pending_snapshots)?;

    Ok(HarnessEngineeringRatchetResult {
        enforced: true,
        regressed: false,
        profiles,
    })
}

fn resolve_routa_workspace_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "failed to resolve Routa workspace root".to_string())
}

fn resolve_fluency_model_path(
    repo_root: &Path,
    workspace_root: &Path,
    spec: &RatchetProfileSpec,
) -> Result<PathBuf, String> {
    let repo_model = repo_root.join(spec.model_relative_path);
    if repo_model.exists() {
        return Ok(repo_model);
    }

    let bundled_model = workspace_root.join(spec.model_relative_path);
    if bundled_model.exists() {
        return Ok(bundled_model);
    }

    Err(format!(
        "missing fluency model for profile {}: {}",
        spec.profile, spec.model_relative_path
    ))
}

fn load_harness_fluency_report(
    snapshot_path: &Path,
) -> Result<Option<HarnessFluencyReport>, String> {
    if !snapshot_path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(snapshot_path).map_err(|error| {
        format!(
            "failed to read fluency snapshot {}: {error}",
            snapshot_path.display()
        )
    })?;
    let report = serde_json::from_str::<HarnessFluencyReport>(&raw).map_err(|error| {
        format!(
            "failed to parse fluency snapshot {}: {error}",
            snapshot_path.display()
        )
    })?;
    Ok(Some(report))
}

fn build_ratchet_profile_result(
    profile: &str,
    snapshot_path: &Path,
    previous_report: Option<&HarnessFluencyReport>,
    current_report: &HarnessFluencyReport,
) -> HarnessEngineeringRatchetProfileResult {
    let previous_generated_at = previous_report.map(|report| report.generated_at.clone());
    let previous_overall_level = previous_report.map(|report| report.overall_level.clone());
    let previous_baseline_score = previous_report.map(|report| report.baseline.summary.score);
    let baseline_score_delta = previous_report
        .map(|report| current_report.baseline.summary.score - report.baseline.summary.score);

    let mut regressed_criteria = Vec::new();
    let mut improved_criteria = Vec::new();
    let mut level_regressed = false;
    let mut level_improved = false;
    let mut warning_messages = Vec::new();

    if let Some(comparison) = &current_report.comparison {
        level_regressed = comparison.overall_change == LevelChange::Down
            || comparison
                .dimension_changes
                .iter()
                .any(|change| change.change == LevelChange::Down);
        level_improved = comparison.overall_change == LevelChange::Up
            || comparison
                .dimension_changes
                .iter()
                .any(|change| change.change == LevelChange::Up);
        for change in &comparison.criteria_changes {
            let previous_failed = matches!(change.previous_status, Some(CriterionStatus::Fail));
            let current_failed = matches!(change.current_status, Some(CriterionStatus::Fail));
            let previous_passed = matches!(change.previous_status, Some(CriterionStatus::Pass));
            let current_passed = matches!(change.current_status, Some(CriterionStatus::Pass));
            if current_failed && !previous_failed {
                regressed_criteria.push(change.id.clone());
            } else if previous_failed && current_passed {
                improved_criteria.push(change.id.clone());
            } else if previous_passed
                && matches!(change.current_status, Some(CriterionStatus::Skipped))
            {
                warning_messages.push(format!(
                    "criterion {} moved from pass to skipped during ratchet evaluation",
                    change.id
                ));
            }
        }
    } else if previous_report.is_some() {
        warning_messages.push(
            "comparison was unavailable, likely because the persisted fluency baseline changed schema or model version"
                .to_string(),
        );
    }

    let score_regressed = baseline_score_delta
        .map(|delta| delta < -BASELINE_SCORE_EPSILON)
        .unwrap_or(false);
    let score_improved = baseline_score_delta
        .map(|delta| delta > BASELINE_SCORE_EPSILON)
        .unwrap_or(false);
    let regressed = level_regressed || score_regressed || !regressed_criteria.is_empty();
    let status = if regressed {
        "regressed"
    } else if previous_report.is_none() {
        "established"
    } else if level_improved || score_improved || !improved_criteria.is_empty() {
        "improved"
    } else if current_report.comparison.is_none() {
        "rebaselined"
    } else {
        "stable"
    };

    HarnessEngineeringRatchetProfileResult {
        profile: profile.to_string(),
        snapshot_path: snapshot_path.display().to_string(),
        status: status.to_string(),
        current_overall_level: current_report.overall_level.clone(),
        current_baseline_score: current_report.baseline.summary.score,
        previous_generated_at,
        previous_overall_level,
        previous_baseline_score,
        baseline_score_delta,
        regressed_criteria,
        improved_criteria,
        warnings: warning_messages,
    }
}

fn persist_ratchet_snapshots(snapshots: &[PendingRatchetSnapshot]) -> Result<(), String> {
    let original_contents = snapshots
        .iter()
        .map(|entry| {
            let prior = if entry.snapshot_path.exists() {
                Some(fs::read_to_string(&entry.snapshot_path).map_err(|error| {
                    format!(
                        "failed to read existing fluency snapshot {}: {error}",
                        entry.snapshot_path.display()
                    )
                })?)
            } else {
                None
            };
            Ok((entry.snapshot_path.clone(), prior))
        })
        .collect::<Result<Vec<_>, String>>()?;

    for entry in snapshots {
        if let Some(parent) = entry.snapshot_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create fluency snapshot directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let serialized = serde_json::to_string_pretty(&entry.report)
            .map_err(|error| format!("failed to serialize fluency snapshot: {error}"))?;
        if let Err(error) = fs::write(&entry.snapshot_path, format!("{serialized}\n")) {
            restore_ratchet_snapshots(&original_contents)?;
            return Err(format!(
                "failed to write fluency snapshot {}: {error}",
                entry.snapshot_path.display()
            ));
        }
    }

    Ok(())
}

fn restore_ratchet_snapshots(originals: &[(PathBuf, Option<String>)]) -> Result<(), String> {
    for (path, content) in originals {
        match content {
            Some(content) => fs::write(path, content).map_err(|error| {
                format!(
                    "failed to restore fluency snapshot {}: {error}",
                    path.display()
                )
            })?,
            None if path.exists() => fs::remove_file(path).map_err(|error| {
                format!(
                    "failed to remove fluency snapshot {} during rollback: {error}",
                    path.display()
                )
            })?,
            None => {}
        }
    }
    Ok(())
}
