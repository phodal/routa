use std::fs;
use std::io::Write;
use std::path::Path;

use chrono::Utc;

use super::learning::{
    detect_common_patterns, generate_playbook_candidates, load_evolution_history, save_playbook,
};
use super::{
    AutomationSummary, EvolutionContext, EvolutionHistory, FitnessSummary,
    HarnessEngineeringAction, HarnessEngineeringGap, HarnessEngineeringInputs,
    HarnessEngineeringOptions, HarnessEngineeringPatchCandidate, HarnessEngineeringReport,
    HarnessEngineeringSummary, SpecSummary, TemplateSummary,
};
use routa_core::state::AppState;

pub(super) fn generate_playbooks_from_history(
    repo_root: &Path,
    _options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringReport, String> {
    println!("📊 Harness Evolution - Learning Mode");
    println!("  Loading evolution history...");

    let history = load_evolution_history(repo_root)?;

    if history.is_empty() {
        return Err(
            "No evolution history found. Run `harness evolve --apply` first to generate data."
                .to_string(),
        );
    }

    println!("  Found {} evolution runs", history.len());

    let patterns = detect_common_patterns(&history, 0.8);

    if patterns.is_empty() {
        println!("  ⚠️  No patterns detected (need 3+ successful runs with same gap combination)");
        println!("\nℹ️  Run `harness evolve --apply` multiple times to generate learning data.");
        return Err("Not enough data for pattern extraction. Need 3+ successful runs with matching gap patterns.".to_string());
    }

    println!("  Detected {} common patterns:", patterns.len());
    for pattern in &patterns {
        println!(
            "    - Gap pattern: {:?} (seen {} times, avg success: {:.1}%)",
            pattern.gap_categories,
            pattern.occurrence_count,
            pattern.avg_success_rate * 100.0
        );
    }

    let playbooks = generate_playbook_candidates(repo_root, &patterns)?;

    println!("  Generated {} playbook candidates:", playbooks.len());

    for playbook in &playbooks {
        save_playbook(repo_root, playbook)?;
        println!(
            "    ✓ {}.json (confidence: {:.1}%, evidence: {} runs)",
            playbook.id,
            playbook.confidence * 100.0,
            playbook.provenance.evidence_count
        );
    }

    let playbook_dir = repo_root.join("docs/fitness/playbooks");
    println!("\n✅ Playbooks saved to {}", playbook_dir.display());

    let default_inputs = HarnessEngineeringInputs {
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
            systems: vec![],
            warnings: 0,
        },
        fitness: FitnessSummary {
            manifest_present: false,
            fluency_snapshots_loaded: 0,
            blocking_criteria_count: 0,
            critical_blocking_criteria_count: 0,
        },
    };

    Ok(HarnessEngineeringReport {
        generated_at: Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: "learn".to_string(),
        report_path: playbook_dir.display().to_string(),
        summary: HarnessEngineeringSummary {
            total_gaps: 0,
            blocking_gaps: 0,
            harness_mutation_candidates: playbooks.len(),
            non_harness_gaps: 0,
            low_risk_patch_candidates: playbooks.len(),
        },
        inputs: default_inputs,
        gaps: vec![],
        recommended_actions: playbooks
            .iter()
            .enumerate()
            .map(|(idx, p)| HarnessEngineeringAction {
                gap_id: format!("playbook-{idx}"),
                priority: 1,
                action: format!("Review playbook: {}", p.id),
                rationale: format!(
                    "Generated from {} successful runs with {:.0}% confidence",
                    p.provenance.evidence_count,
                    p.confidence * 100.0
                ),
            })
            .collect(),
        patch_candidates: vec![],
        verification_plan: vec![],
        verification_results: vec![],
        ratchet: None,
        ai_assessment: None,
        warnings: vec![],
    })
}

pub(super) fn build_evolution_context(
    state: Option<&AppState>,
    gaps: &[HarnessEngineeringGap],
    options: &HarnessEngineeringOptions,
) -> EvolutionContext {
    let session_id: Option<String> = state.and(None);

    let workflow = if options.bootstrap {
        Some("bootstrap".to_string())
    } else if options.apply {
        Some("auto-apply".to_string())
    } else {
        Some("evaluation".to_string())
    };

    let mut gap_categories: Vec<String> = gaps.iter().map(|gap| gap.category.clone()).collect();
    gap_categories.sort();
    gap_categories.dedup();

    EvolutionContext {
        session_id,
        workflow,
        gaps_detected: gaps.len(),
        gap_categories,
        rollback_reason: None,
        error_messages: None,
    }
}

pub(super) fn record_evolution_outcome(
    repo_root: &Path,
    applied: &[&HarnessEngineeringPatchCandidate],
    failed: &[&HarnessEngineeringPatchCandidate],
    context: Option<&EvolutionContext>,
) -> Result<(), String> {
    let history_dir = repo_root.join("docs/fitness/evolution");
    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create evolution history dir: {e}"))?;

    let history_file = history_dir.join("history.jsonl");

    let record = EvolutionHistory {
        timestamp: Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: "auto-apply".to_string(),
        session_id: context.and_then(|ctx| ctx.session_id.clone()),
        task_type: Some("harness_evolution".to_string()),
        workflow: context.and_then(|ctx| ctx.workflow.clone()),
        trigger: Some(
            if context.is_some() {
                "manual"
            } else {
                "unknown"
            }
            .to_string(),
        ),
        gaps_detected: context.map(|ctx| ctx.gaps_detected),
        gap_categories: context.map(|ctx| ctx.gap_categories.clone()),
        changed_paths: context.and_then(|_ctx| {
            if applied.is_empty() {
                None
            } else {
                Some(
                    applied
                        .iter()
                        .flat_map(|p| p.targets.iter().cloned())
                        .collect(),
                )
            }
        }),
        patches_applied: applied.iter().map(|p| p.id.clone()).collect(),
        patches_failed: failed.iter().map(|p| p.id.clone()).collect(),
        success_rate: if applied.is_empty() && failed.is_empty() {
            0.0
        } else {
            applied.len() as f64 / (applied.len() + failed.len()) as f64
        },
        rollback_reason: context.and_then(|ctx| ctx.rollback_reason.clone()),
        error_messages: context.and_then(|ctx| ctx.error_messages.clone()),
    };

    let json_line =
        serde_json::to_string(&record).map_err(|e| format!("Failed to serialize history: {e}"))?;

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history_file)
        .map_err(|e| format!("Failed to open history file: {e}"))?;

    writeln!(file, "{json_line}").map_err(|e| format!("Failed to write history: {e}"))?;

    Ok(())
}
