//! Harness Engineering Evolution
//!
//! Self-bootstrapping harness engineering agent with evaluation, patch generation,
//! and controlled auto-evolution capabilities.

mod ratchet;
#[cfg(test)]
mod tests;
mod types;

use self::ratchet::{run_ratchet_loop, ApplyOutcome};
pub use types::*;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::commands::specialist;
use chrono::Utc;
use routa_core::harness::HarnessRepoSignalsReport;
use routa_core::harness_automation::detect_repo_automations;
use routa_core::harness_template::{DoctorReport, DriftLevel};
use routa_core::spec_detector::{detect_spec_sources, SpecDetectionReport};
use routa_core::state::AppState;
use serde::Serialize;
use serde_json::Value;

pub const DEFAULT_REPORT_RELATIVE_PATH: &str =
    "docs/fitness/reports/harness-engineering-latest.json";
const FITNESS_MANIFEST_RELATIVE_PATH: &str = "docs/fitness/manifest.yaml";
const GENERIC_FLUENCY_SNAPSHOT_RELATIVE_PATH: &str =
    "docs/fitness/reports/harness-fluency-latest.json";
const ORCHESTRATOR_FLUENCY_SNAPSHOT_RELATIVE_PATH: &str =
    "docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json";
const HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH: &str =
    "resources/specialists/tools/harness-engineering-evolution.yaml";

pub async fn evaluate_harness_engineering(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
    state: Option<&AppState>,
) -> Result<HarnessEngineeringReport, String> {
    let mut warnings = Vec::new();

    // Bootstrap mode: detect weak repo and synthesize initial harness
    if options.bootstrap {
        if should_bootstrap(repo_root) {
            return bootstrap_weak_repository(repo_root, options).await;
        } else {
            warnings.push("Bootstrap mode requested but repository already has harness surfaces. Proceeding with normal evaluation.".to_string());
        }
    }

    let repo_signals = match routa_core::harness::detect_repo_signals(repo_root) {
        Ok(report) => Some(report),
        Err(error) => {
            warnings.push(format!("Repo signal detection unavailable: {error}"));
            None
        }
    };
    let template_doctor = routa_core::harness_template::doctor(repo_root)?;
    let automations = detect_repo_automations(repo_root, &[])?;
    let specs = detect_spec_sources(repo_root)?;
    let fluency_snapshots = load_fluency_snapshots(repo_root, &mut warnings);

    let mut gaps = Vec::new();
    classify_repo_signals(repo_root, repo_signals.as_ref(), &mut gaps);
    classify_templates(&template_doctor, &mut gaps);
    classify_automations(&automations, &mut gaps);
    classify_specs(&specs, &mut gaps);
    classify_fitness(repo_root, &fluency_snapshots, &mut gaps);

    let mut recommended_actions = build_recommended_actions(&gaps);
    let mut patch_candidates = build_patch_candidates(repo_root, repo_signals.as_ref(), &gaps);
    patch_candidates.sort_by(|left, right| left.id.cmp(&right.id));
    let verification_plan = build_verification_plan(repo_root);

    let summary = HarnessEngineeringSummary {
        total_gaps: gaps.len(),
        blocking_gaps: gaps.iter().filter(|gap| gap.severity == "high").count(),
        harness_mutation_candidates: gaps
            .iter()
            .filter(|gap| gap.harness_mutation_candidate)
            .count(),
        non_harness_gaps: gaps
            .iter()
            .filter(|gap| gap.category == "non_harness_engineering_gap")
            .count(),
        low_risk_patch_candidates: patch_candidates
            .iter()
            .filter(|patch| patch.risk == "low")
            .count(),
    };

    warnings.extend(template_doctor.warnings.clone());
    warnings.extend(automations.warnings.clone());
    warnings.extend(specs.warnings.clone());
    warnings.sort();
    warnings.dedup();

    recommended_actions.sort_by_key(|action| action.priority);

    let mut ai_assessment = None;
    if options.use_ai_specialist {
        let repo_root_string = repo_root.display().to_string();
        match state {
            Some(state) => {
                let templates_summary = summarize_templates(&template_doctor);
                let automations_summary = summarize_automations(&automations);
                let specs_summary = summarize_specs(&specs);
                let fitness_summary = summarize_fitness(repo_root, &fluency_snapshots);
                let prompt = build_ai_specialist_prompt(&HarnessEngineeringAiPromptContext {
                    repo_root,
                    gaps: &gaps,
                    recommended_actions: &recommended_actions,
                    patch_candidates: &patch_candidates,
                    templates: &templates_summary,
                    automations: &automations_summary,
                    specs: &specs_summary,
                    fitness: &fitness_summary,
                })?;
                let specialist_path = resolve_harness_engineering_specialist_path(repo_root)?;
                let specialist_path = specialist_path.display().to_string();
                match specialist::run_for_json(
                    state,
                    specialist::RunArgs {
                        specialist_target: specialist_path.as_str(),
                        prompt: Some(prompt.as_str()),
                        workspace_id: &options.ai_workspace_id,
                        provider: options.ai_provider.as_deref(),
                        output_json: true,
                        cwd_override: Some(repo_root_string.as_str()),
                        provider_timeout_ms: options.ai_provider_timeout_ms,
                        provider_retries: options.ai_provider_retries,
                        repeat_count: 1,
                    },
                )
                .await
                {
                    Ok(payload) => {
                        ai_assessment = Some(HarnessEngineeringAiAssessment {
                            specialist_id: "harness-engineering-evolution".to_string(),
                            workspace_id: options.ai_workspace_id.clone(),
                            provider: options.ai_provider.clone(),
                            payload,
                        });
                    }
                    Err(error) => warnings.push(format!(
                        "AI specialist execution failed; using deterministic evaluation only: {error}"
                    )),
                }
            }
            None => warnings.push(
                "AI specialist requested but no AppState was provided; using deterministic evaluation only."
                    .to_string(),
            ),
        }
    }

    let apply_outcome = if options.apply && !patch_candidates.is_empty() {
        Some(apply_patches(
            repo_root,
            &patch_candidates,
            &verification_plan,
            options,
        )?)
    } else {
        None
    };

    Ok(HarnessEngineeringReport {
        generated_at: Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: if options.dry_run {
            "dry-run".to_string()
        } else {
            "evaluation".to_string()
        },
        report_path: options.output_path.display().to_string(),
        summary,
        inputs: HarnessEngineeringInputs {
            repo_signals: repo_signals.as_ref().map(summarize_repo_signals),
            templates: summarize_templates(&template_doctor),
            automations: summarize_automations(&automations),
            specs: summarize_specs(&specs),
            fitness: summarize_fitness(repo_root, &fluency_snapshots),
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
        ai_assessment,
        warnings,
    })
}

pub fn persist_harness_engineering_report(
    report: &HarnessEngineeringReport,
    output_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create harness engineering report directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let serialized = serde_json::to_string_pretty(report)
        .map_err(|error| format!("failed to serialize harness engineering report: {error}"))?;
    fs::write(output_path, serialized).map_err(|error| {
        format!(
            "failed to write harness engineering report {}: {error}",
            output_path.display()
        )
    })
}

pub fn format_harness_engineering_report(report: &HarnessEngineeringReport) -> String {
    let mut lines = Vec::new();
    lines.push(format!("repo: {}", report.repo_root));
    lines.push(format!("mode: {}", report.mode));
    lines.push(format!(
        "summary: {} gaps, {} blocking, {} low-risk patch candidates",
        report.summary.total_gaps,
        report.summary.blocking_gaps,
        report.summary.low_risk_patch_candidates
    ));

    lines.push(String::new());
    lines.push("inputs:".to_string());
    if let Some(repo_signals) = &report.inputs.repo_signals {
        lines.push(format!(
            "  repo signals: build groups {}, test groups {}",
            repo_signals.build_entrypoint_groups, repo_signals.test_entrypoint_groups
        ));
    } else {
        lines.push("  repo signals: unavailable".to_string());
    }
    lines.push(format!(
        "  templates: {} checked, {} drift errors",
        report.inputs.templates.templates_checked, report.inputs.templates.drift_error_count
    ));
    lines.push(format!(
        "  automations: {} definitions, {} pending signals",
        report.inputs.automations.definition_count, report.inputs.automations.pending_signal_count
    ));
    lines.push(format!(
        "  specs: {} sources across {} systems",
        report.inputs.specs.source_count,
        report.inputs.specs.systems.len()
    ));
    lines.push(format!(
        "  fitness: manifest {}, {} fluency snapshots",
        if report.inputs.fitness.manifest_present {
            "present"
        } else {
            "missing"
        },
        report.inputs.fitness.fluency_snapshots_loaded
    ));

    if !report.gaps.is_empty() {
        lines.push(String::new());
        lines.push("gaps:".to_string());
        for gap in &report.gaps {
            lines.push(format!(
                "  [{}:{}] {}",
                gap.severity, gap.category, gap.title
            ));
            lines.push(format!("    {}", gap.detail));
        }
    }

    if !report.patch_candidates.is_empty() {
        lines.push(String::new());
        lines.push("patch candidates:".to_string());
        for patch in &report.patch_candidates {
            lines.push(format!(
                "  [{}] {} -> {}",
                patch.risk,
                patch.title,
                patch.targets.join(", ")
            ));
        }
    }

    if let Some(ai_assessment) = &report.ai_assessment {
        lines.push(String::new());
        lines.push("ai assessment:".to_string());
        lines.push(format!(
            "  specialist: {} ({})",
            ai_assessment.specialist_id, ai_assessment.workspace_id
        ));
    }

    if !report.verification_plan.is_empty() {
        lines.push(String::new());
        lines.push("verification:".to_string());
        for step in &report.verification_plan {
            lines.push(format!("  {} -> {}", step.label, step.command));
        }
    }

    if !report.verification_results.is_empty() {
        lines.push(String::new());
        lines.push("verification results:".to_string());
        for result in &report.verification_results {
            let status = if result.success { "PASS" } else { "FAIL" };
            lines.push(format!("  [{}] {}", status, result.label));
            if let Some(excerpt) = &result.output_excerpt {
                lines.push(format!("    {}", excerpt.replace('\n', " | ")));
            }
        }
    }

    if let Some(ratchet) = &report.ratchet {
        lines.push(String::new());
        lines.push("ratchet:".to_string());
        lines.push(format!(
            "  enforced: {}, regressed: {}",
            ratchet.enforced, ratchet.regressed
        ));
        for profile in &ratchet.profiles {
            lines.push(format!(
                "  [{}] {} -> {}",
                profile.status, profile.profile, profile.current_overall_level
            ));
            if let Some(delta) = profile.baseline_score_delta {
                lines.push(format!("    baseline delta: {delta:+.3}"));
            }
            if !profile.regressed_criteria.is_empty() {
                lines.push(format!(
                    "    regressed criteria: {}",
                    profile.regressed_criteria.join(", ")
                ));
            }
        }
    }

    lines.join("\n")
}

fn build_ai_specialist_prompt(
    prompt_context: &HarnessEngineeringAiPromptContext<'_>,
) -> Result<String, String> {
    let context = serde_json::json!({
        "repoRoot": prompt_context.repo_root.display().to_string(),
        "inputs": {
            "templates": prompt_context.templates,
            "automations": prompt_context.automations,
            "specs": prompt_context.specs,
            "fitness": prompt_context.fitness,
        },
        "deterministicReport": {
            "gaps": prompt_context.gaps,
            "recommendedActions": prompt_context.recommended_actions,
            "patchCandidates": prompt_context.patch_candidates,
        },
        "instructions": {
            "mode": "dry-run",
            "task": "Review the deterministic harness-engineering assessment and produce a stricter JSON evaluation. Reclassify gaps if needed, keep non-harness engineering gaps separate, and only emit low-risk patch candidates for config/templates/automation/specialist/report scaffolding.",
            "deterministicContextAuthoritative": true,
            "additionalToolCallsDefault": "forbidden",
            "whenToInspectRepo": "Only inspect the repository if the supplied context is internally inconsistent or clearly insufficient to classify a gap.",
        }
    });

    serde_json::to_string_pretty(&context)
        .map_err(|error| format!("failed to serialize AI specialist prompt context: {error}"))
}

fn summarize_repo_signals(report: &HarnessRepoSignalsReport) -> RepoSignalsSummary {
    RepoSignalsSummary {
        package_manager: report.package_manager.clone(),
        lockfiles: report.lockfiles.clone(),
        build_entrypoint_groups: report.build.entrypoint_groups.len(),
        test_entrypoint_groups: report.test.entrypoint_groups.len(),
        build_overview_items: report
            .build
            .overview_rows
            .iter()
            .map(|row| row.items.len())
            .sum(),
        test_overview_items: report
            .test
            .overview_rows
            .iter()
            .map(|row| row.items.len())
            .sum(),
    }
}

fn summarize_templates(report: &DoctorReport) -> TemplateSummary {
    let drift_error_count = report
        .template_reports
        .iter()
        .flat_map(|template| template.drift_findings.iter())
        .filter(|finding| finding.level == DriftLevel::Error)
        .count();
    let drift_warning_count = report
        .template_reports
        .iter()
        .flat_map(|template| template.drift_findings.iter())
        .filter(|finding| finding.level == DriftLevel::Warning)
        .count();
    let missing_sensor_files = report
        .template_reports
        .iter()
        .flat_map(|template| template.sensor_files.iter())
        .filter(|status| !status.present)
        .count();
    let missing_automation_refs = report
        .template_reports
        .iter()
        .filter_map(|template| template.automation_ref.as_ref())
        .filter(|status| !status.present)
        .count();

    TemplateSummary {
        templates_checked: report.template_reports.len(),
        drift_error_count,
        drift_warning_count,
        missing_sensor_files,
        missing_automation_refs,
        warnings: report.warnings.len(),
    }
}

fn summarize_automations(
    report: &routa_core::harness_automation::HarnessAutomationReport,
) -> AutomationSummary {
    AutomationSummary {
        definition_count: report.definitions.len(),
        pending_signal_count: report.pending_signals.len(),
        recent_run_count: report.recent_runs.len(),
        definition_only_count: report
            .definitions
            .iter()
            .filter(|definition| definition.runtime_status == "definition-only")
            .count(),
        warnings: report.warnings.len(),
    }
}

fn summarize_specs(report: &SpecDetectionReport) -> SpecSummary {
    let mut systems = report
        .sources
        .iter()
        .map(|source| source.system.clone())
        .collect::<Vec<_>>();
    systems.sort();
    systems.dedup();

    SpecSummary {
        source_count: report.sources.len(),
        feature_count: report
            .sources
            .iter()
            .map(|source| {
                source
                    .features
                    .as_ref()
                    .map(|features| features.len())
                    .unwrap_or(0)
            })
            .sum(),
        systems,
        warnings: report.warnings.len(),
    }
}

fn summarize_fitness(
    repo_root: &Path,
    fluency_snapshots: &[LoadedFluencySnapshot],
) -> FitnessSummary {
    FitnessSummary {
        manifest_present: repo_root.join(FITNESS_MANIFEST_RELATIVE_PATH).exists(),
        fluency_snapshots_loaded: fluency_snapshots.len(),
        blocking_criteria_count: fluency_snapshots
            .iter()
            .map(|snapshot| snapshot.blocking_criteria.len())
            .sum(),
        critical_blocking_criteria_count: fluency_snapshots
            .iter()
            .flat_map(|snapshot| snapshot.blocking_criteria.iter())
            .filter(|criterion| criterion.critical)
            .count(),
    }
}

fn classify_repo_signals(
    repo_root: &Path,
    report: Option<&HarnessRepoSignalsReport>,
    gaps: &mut Vec<HarnessEngineeringGap>,
) {
    if report.is_none() {
        let mut evidence = Vec::new();
        if !repo_root.join("docs/harness/build.yml").exists() {
            evidence.push("docs/harness/build.yml".to_string());
        }
        if !repo_root.join("docs/harness/test.yml").exists() {
            evidence.push("docs/harness/test.yml".to_string());
        }
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "harness_surfaces.missing".to_string(),
                category: "missing_execution_surface".to_string(),
                severity: "high".to_string(),
                title: "Harness build/test surfaces are missing or unreadable".to_string(),
                detail: "Harness repo-signal detection could not load docs/harness/build.yml and docs/harness/test.yml as a stable execution surface.".to_string(),
                evidence,
                suggested_fix: "Create or repair docs/harness/build.yml and docs/harness/test.yml before attempting automated harness evolution.".to_string(),
                harness_mutation_candidate: true,
            },
        );
        return;
    }

    let report = report.expect("checked above");
    if report.build.entrypoint_groups.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "build.entrypoints.missing".to_string(),
                category: "missing_execution_surface".to_string(),
                severity: "high".to_string(),
                title: "Build surface has no detected entrypoints".to_string(),
                detail: "The build harness surface exists, but it does not expose any detected scripts for dev/build/bundle flows.".to_string(),
                evidence: vec![report.build.config_path.clone()],
                suggested_fix: "Expand docs/harness/build.yml rules or normalize package scripts so build entrypoints become inspectable.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }
    if report.test.entrypoint_groups.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "test.entrypoints.missing".to_string(),
                category: "missing_verification_surface".to_string(),
                severity: "high".to_string(),
                title: "Test surface has no detected entrypoints".to_string(),
                detail: "The test harness surface exists, but it does not expose executable unit/e2e/quality entrypoints.".to_string(),
                evidence: vec![report.test.config_path.clone()],
                suggested_fix: "Expand docs/harness/test.yml rules or normalize package scripts so verification entrypoints are machine-discoverable.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }
}

fn classify_templates(report: &DoctorReport, gaps: &mut Vec<HarnessEngineeringGap>) {
    if report.template_reports.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "templates.bootstrap.missing".to_string(),
                category: "missing_execution_surface".to_string(),
                severity: "medium".to_string(),
                title: "No harness templates are available".to_string(),
                detail: "The repository has no docs/harness/templates baseline, so bootstrap mode has no reusable harness starting point.".to_string(),
                evidence: vec!["docs/harness/templates".to_string()],
                suggested_fix: "Add at least one harness-template-v1 baseline so weak repositories can bootstrap into a known shape.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }

    for template in &report.template_reports {
        for finding in &template.drift_findings {
            let category = match finding.kind.as_str() {
                "sensor_file_missing" => "missing_verification_surface",
                "guide_missing" => "missing_evidence",
                _ => "missing_execution_surface",
            };
            push_gap(
                gaps,
                HarnessEngineeringGap {
                    id: format!("template.{}.{}", template.template_id, finding.kind),
                    category: category.to_string(),
                    severity: drift_level_label(&finding.level).to_string(),
                    title: format!("Template drift in {}", template.template_id),
                    detail: finding.message.clone(),
                    evidence: vec![template.config_path.clone(), finding.path.clone()],
                    suggested_fix: format!(
                        "Repair the {} template so its declared guides, sensors, and boundaries match the repository.",
                        template.template_id
                    ),
                    harness_mutation_candidate: true,
                },
            );
        }

        if let Some(automation_ref) = &template.automation_ref {
            if !automation_ref.present {
                push_gap(
                    gaps,
                    HarnessEngineeringGap {
                        id: format!("template.{}.automation_ref_missing", template.template_id),
                        category: "missing_automation".to_string(),
                        severity: "medium".to_string(),
                        title: format!("Template {} references missing automation config", template.template_id),
                        detail: format!(
                            "{} expects {}, but the automation file is missing.",
                            template.template_id, automation_ref.path
                        ),
                        evidence: vec![automation_ref.path.clone()],
                        suggested_fix: "Create the referenced docs/harness/automations.yml or update the template reference.".to_string(),
                        harness_mutation_candidate: true,
                    },
                );
            }
        }
    }
}

fn classify_automations(
    report: &routa_core::harness_automation::HarnessAutomationReport,
    gaps: &mut Vec<HarnessEngineeringGap>,
) {
    if report.config_file.is_none() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "automations.config.missing".to_string(),
                category: "missing_automation".to_string(),
                severity: "medium".to_string(),
                title: "Harness automation config is missing".to_string(),
                detail: "No docs/harness/automations.yml file was loaded, so scheduled and finding-driven harness loops cannot run.".to_string(),
                evidence: vec!["docs/harness/automations.yml".to_string()],
                suggested_fix: "Add a minimal harness-automation-v1 config with at least one scheduled evaluation loop.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }

    if report.definitions.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "automations.definitions.empty".to_string(),
                category: "missing_automation".to_string(),
                severity: "medium".to_string(),
                title: "Harness automation config has no executable definitions".to_string(),
                detail: "Automation wiring exists only as an empty shell, so harness findings cannot feed a scheduled or event-driven loop.".to_string(),
                evidence: vec!["docs/harness/automations.yml".to_string()],
                suggested_fix: "Add a low-risk dry-run automation that re-runs harness evaluation on a schedule.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }

    for definition in &report.definitions {
        if definition.runtime_status == "definition-only" {
            push_gap(
                gaps,
                HarnessEngineeringGap {
                    id: format!("automation.{}.definition_only", definition.id),
                    category: "missing_automation".to_string(),
                    severity: "low".to_string(),
                    title: format!("Automation {} is not runtime-bound", definition.id),
                    detail: format!(
                        "{} exists in config but has no active runtime binding or schedule linkage.",
                        definition.name
                    ),
                    evidence: vec![definition.config_path.clone()],
                    suggested_fix: "Bind the automation to a runtime schedule or make its inactive status explicit in governance docs.".to_string(),
                    harness_mutation_candidate: true,
                },
            );
        }

        let looks_like_fluency = [
            definition.id.as_str(),
            definition.name.as_str(),
            definition.description.as_str(),
        ]
        .iter()
        .any(|value| value.to_ascii_lowercase().contains("fluency"));
        let target_mentions_fluency = definition
            .target_label
            .to_ascii_lowercase()
            .contains("fluency");
        if looks_like_fluency && !target_mentions_fluency {
            push_gap(
                gaps,
                HarnessEngineeringGap {
                    id: format!("automation.{}.target_mismatch", definition.id),
                    category: "missing_automation".to_string(),
                    severity: "medium".to_string(),
                    title: format!("Automation {} points at a mismatched target", definition.id),
                    detail: format!(
                        "{} describes a fluency loop, but the bound target is {}.",
                        definition.name, definition.target_label
                    ),
                    evidence: vec![definition.config_path.clone(), definition.target_label.clone()],
                    suggested_fix: "Normalize the automation target so the scheduled task points at the intended fluency or harness-engineering specialist.".to_string(),
                    harness_mutation_candidate: true,
                },
            );
        }
    }
}

fn classify_specs(report: &SpecDetectionReport, gaps: &mut Vec<HarnessEngineeringGap>) {
    if report.sources.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "spec_sources.missing".to_string(),
                category: "missing_evidence".to_string(),
                severity: "medium".to_string(),
                title: "No structured spec sources were detected".to_string(),
                detail: "Harness evolution can still inspect code and scripts, but it lacks spec artifacts or tool-native design context to explain why the repo exists.".to_string(),
                evidence: vec![".kiro/specs".to_string(), ".qoder/specs".to_string()],
                suggested_fix: "Add a minimal issue/design/exec-plan trail or integrate a supported spec source for stronger bootstrap context.".to_string(),
                harness_mutation_candidate: false,
            },
        );
    }
}

fn classify_fitness(
    repo_root: &Path,
    fluency_snapshots: &[LoadedFluencySnapshot],
    gaps: &mut Vec<HarnessEngineeringGap>,
) {
    if !repo_root.join(FITNESS_MANIFEST_RELATIVE_PATH).exists() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "fitness.manifest.missing".to_string(),
                category: "missing_evidence".to_string(),
                severity: "high".to_string(),
                title: "Fitness manifest is missing".to_string(),
                detail: "Harness evolution has no stable manifest of evidence files to interpret as the repository rulebook.".to_string(),
                evidence: vec![FITNESS_MANIFEST_RELATIVE_PATH.to_string()],
                suggested_fix: "Add docs/fitness/manifest.yaml so fitness evidence remains machine-readable and durable.".to_string(),
                harness_mutation_candidate: true,
            },
        );
    }

    if fluency_snapshots.is_empty() {
        push_gap(
            gaps,
            HarnessEngineeringGap {
                id: "fluency.snapshots.missing".to_string(),
                category: "missing_verification_surface".to_string(),
                severity: "medium".to_string(),
                title: "No harness fluency snapshots were loaded".to_string(),
                detail: "Harness engineering has no persisted maturity baseline to compare against, so ratcheting cannot happen yet.".to_string(),
                evidence: vec![
                    GENERIC_FLUENCY_SNAPSHOT_RELATIVE_PATH.to_string(),
                    ORCHESTRATOR_FLUENCY_SNAPSHOT_RELATIVE_PATH.to_string(),
                ],
                suggested_fix: "Run `routa fitness fluency --compare-last` and persist the resulting snapshots before evolving the harness.".to_string(),
                harness_mutation_candidate: false,
            },
        );
        return;
    }

    for snapshot in fluency_snapshots {
        for criterion in &snapshot.blocking_criteria {
            let (category, harness_mutation_candidate) =
                classify_fluency_blocker(&criterion.id, &criterion.evidence_hint);
            push_gap(
                gaps,
                HarnessEngineeringGap {
                    id: format!("fluency.{}.{}", snapshot.profile, criterion.id),
                    category: category.to_string(),
                    severity: if criterion.critical {
                        "high".to_string()
                    } else {
                        "medium".to_string()
                    },
                    title: format!(
                        "Fluency blocker in {}{}",
                        snapshot.profile,
                        snapshot
                            .overall_level
                            .as_ref()
                            .map(|level| format!(" ({level})"))
                            .unwrap_or_default()
                    ),
                    detail: criterion.detail.clone(),
                    evidence: criterion.evidence.clone(),
                    suggested_fix: criterion.recommended_action.clone(),
                    harness_mutation_candidate,
                },
            );
        }
        for warning in &snapshot.warnings {
            push_gap(
                gaps,
                HarnessEngineeringGap {
                    id: format!("fluency.{}.warning", snapshot.profile),
                    category: "missing_verification_surface".to_string(),
                    severity: "low".to_string(),
                    title: format!("Fluency snapshot warning for {}", snapshot.profile),
                    detail: warning.clone(),
                    evidence: vec![],
                    suggested_fix: "Repair the fluency snapshot generation path before relying on it for harness ratchets.".to_string(),
                    harness_mutation_candidate: false,
                },
            );
        }
    }
}

fn classify_fluency_blocker(id: &str, evidence_hint: &str) -> (&'static str, bool) {
    let haystack = format!("{id} {evidence_hint}").to_ascii_lowercase();
    if haystack.contains("codeowners")
        || haystack.contains("dependabot")
        || haystack.contains("renovate")
        || haystack.contains("review-trigger")
        || haystack.contains("review_triggers")
    {
        return ("missing_governance_gate", true);
    }
    if haystack.contains("harness")
        || haystack.contains("automation")
        || haystack.contains("surface")
        || haystack.contains("entrypoint")
        || haystack.contains("fitness")
    {
        return ("missing_verification_surface", true);
    }
    ("non_harness_engineering_gap", false)
}

fn drift_level_label(level: &DriftLevel) -> &'static str {
    match level {
        DriftLevel::Healthy => "low",
        DriftLevel::Warning => "medium",
        DriftLevel::Error => "high",
    }
}

fn build_recommended_actions(gaps: &[HarnessEngineeringGap]) -> Vec<HarnessEngineeringAction> {
    let mut actions = gaps
        .iter()
        .enumerate()
        .map(|(index, gap)| HarnessEngineeringAction {
            gap_id: gap.id.clone(),
            priority: index + 1,
            action: gap.suggested_fix.clone(),
            rationale: gap.title.clone(),
        })
        .collect::<Vec<_>>();
    actions.truncate(6);
    actions
}

fn build_patch_candidates(
    repo_root: &Path,
    repo_signals: Option<&HarnessRepoSignalsReport>,
    gaps: &[HarnessEngineeringGap],
) -> Vec<HarnessEngineeringPatchCandidate> {
    let mut patches = Vec::new();
    let mut seen = BTreeMap::<String, ()>::new();

    if repo_signals.is_none() || !repo_root.join("docs/harness/build.yml").exists() {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.create_build_surface".to_string(),
                risk: "low".to_string(),
                title: "Create or repair docs/harness/build.yml".to_string(),
                rationale: "The repository needs a stable build surface before automation can reason about execution targets.".to_string(),
                targets: vec!["docs/harness/build.yml".to_string()],
                change_kind: "config_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    if repo_signals.is_none() || !repo_root.join("docs/harness/test.yml").exists() {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.create_test_surface".to_string(),
                risk: "low".to_string(),
                title: "Create or repair docs/harness/test.yml".to_string(),
                rationale: "The repository needs a stable verification surface before fitness-driven evolution can close the loop.".to_string(),
                targets: vec!["docs/harness/test.yml".to_string()],
                change_kind: "config_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    if !repo_root.join("docs/harness/templates").exists() {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.add_harness_template".to_string(),
                risk: "low".to_string(),
                title: "Add a baseline harness template".to_string(),
                rationale: "A template provides a low-risk bootstrap target when the repository is weak or incomplete.".to_string(),
                targets: vec!["docs/harness/templates".to_string()],
                change_kind: "template_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    if !repo_root.join("docs/harness/automations.yml").exists() {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.add_automation_config".to_string(),
                risk: "low".to_string(),
                title: "Add docs/harness/automations.yml".to_string(),
                rationale: "Dry-run evolution needs at least one visible automation loop to stay in front of developers.".to_string(),
                targets: vec!["docs/harness/automations.yml".to_string()],
                change_kind: "config_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    if !repo_root
        .join(HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH)
        .exists()
    {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.add_harness_engineering_specialist".to_string(),
                risk: "low".to_string(),
                title: "Add a Harness Engineering specialist definition".to_string(),
                rationale: "A dedicated specialist makes the evaluation loop reusable from automation and review flows.".to_string(),
                targets: vec![HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH.to_string()],
                change_kind: "specialist_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    if gaps.iter().any(|gap| gap.id.contains("target_mismatch")) {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.normalize_automation_target".to_string(),
                risk: "low".to_string(),
                title: "Normalize mismatched harness automation targets".to_string(),
                rationale: "Automation descriptions and runtime targets should describe the same loop; otherwise the harness surface drifts.".to_string(),
                targets: vec!["docs/harness/automations.yml".to_string()],
                change_kind: "config_normalization".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    // Check for missing governance gates (CODEOWNERS, Dependabot, Renovate)
    let has_governance_gap = gaps.iter().any(|gap| {
        gap.category == "missing_governance_gate"
            && (gap.detail.contains("CODEOWNERS")
                || gap.detail.contains("dependabot")
                || gap.detail.contains("renovate"))
    });

    if has_governance_gap {
        if !repo_root.join(".github/CODEOWNERS").exists() {
            insert_patch_candidate(
                &mut patches,
                &mut seen,
                HarnessEngineeringPatchCandidate {
                    id: "patch.create_codeowners".to_string(),
                    risk: "low".to_string(),
                    title: "Create .github/CODEOWNERS for code review automation".to_string(),
                    rationale: "CODEOWNERS enables automatic reviewer assignment and governance visibility.".to_string(),
                    targets: vec![".github/CODEOWNERS".to_string()],
                    change_kind: "governance_bootstrap".to_string(),
                    script_name: None,
                    script_command: None,
                },
            );
        }

        if !repo_root.join(".github/dependabot.yml").exists()
            && !repo_root.join("renovate.json").exists()
        {
            insert_patch_candidate(
                &mut patches,
                &mut seen,
                HarnessEngineeringPatchCandidate {
                    id: "patch.create_dependabot".to_string(),
                    risk: "low".to_string(),
                    title: "Create .github/dependabot.yml for dependency updates".to_string(),
                    rationale:
                        "Dependabot automates security updates and reduces maintenance debt."
                            .to_string(),
                    targets: vec![".github/dependabot.yml".to_string()],
                    change_kind: "governance_bootstrap".to_string(),
                    script_name: None,
                    script_command: None,
                },
            );
        }
    }

    // Check for missing operational documentation
    let has_doc_gaps = gaps.iter().any(|gap| {
        gap.category == "non_harness_engineering_gap"
            && (gap.detail.contains("glob_count failed") || gap.detail.contains("operational"))
    });

    if has_doc_gaps && !repo_root.join("docs/operational").exists() {
        insert_patch_candidate(
            &mut patches,
            &mut seen,
            HarnessEngineeringPatchCandidate {
                id: "patch.create_operational_docs".to_string(),
                risk: "low".to_string(),
                title: "Create placeholder operational documentation".to_string(),
                rationale: "Operational history improves agent fluency and context awareness."
                    .to_string(),
                targets: vec!["docs/operational".to_string()],
                change_kind: "doc_bootstrap".to_string(),
                script_name: None,
                script_command: None,
            },
        );
    }

    // Check for test surface without coverage tracking
    if repo_root.join("docs/harness/test.yml").exists() {
        let test_yml = repo_root.join("docs/harness/test.yml");
        if let Ok(content) = fs::read_to_string(&test_yml) {
            if !content.contains("coverage") && !content.contains("threshold") {
                insert_patch_candidate(
                    &mut patches,
                    &mut seen,
                    HarnessEngineeringPatchCandidate {
                        id: "patch.update_coverage_threshold".to_string(),
                        risk: "low".to_string(),
                        title: "Add coverage tracking to test.yml".to_string(),
                        rationale:
                            "Coverage thresholds enable ratcheting quality upward over time."
                                .to_string(),
                        targets: vec!["docs/harness/test.yml".to_string()],
                        change_kind: "config_enhancement".to_string(),
                        script_name: None,
                        script_command: None,
                    },
                );
            }
        }
    }

    patches
}

fn build_verification_plan(repo_root: &Path) -> Vec<HarnessEngineeringVerificationStep> {
    let mut steps = vec![HarnessEngineeringVerificationStep {
        label: "Harness engineering dry-run".to_string(),
        command: format!(
            "cargo run -p routa-cli -- harness evolve --repo-root {} --dry-run --format json --no-save",
            repo_root.display()
        ),
        proves: "The repository can be assessed and a structured evolution report can be emitted."
            .to_string(),
    }];

    if repo_root.join("docs/harness/build.yml").exists()
        && repo_root.join("docs/harness/test.yml").exists()
    {
        steps.push(HarnessEngineeringVerificationStep {
            label: "Harness surface detection".to_string(),
            command: format!(
                "cargo run -p routa-cli -- harness detect --repo-root {} --format json",
                repo_root.display()
            ),
            proves: "Build and test surfaces remain machine-readable after the change.".to_string(),
        });
    }

    if repo_root.join("docs/harness/templates").exists() {
        steps.push(HarnessEngineeringVerificationStep {
            label: "Template drift doctor".to_string(),
            command: format!(
                "cargo run -p routa-cli -- harness template doctor --repo-root {} --format json",
                repo_root.display()
            ),
            proves:
                "Harness templates and their declared sensors stay aligned with the repository."
                    .to_string(),
        });
    }

    if repo_root.join(FITNESS_MANIFEST_RELATIVE_PATH).exists() {
        steps.push(HarnessEngineeringVerificationStep {
            label: "Fitness rulebook dry-run".to_string(),
            command: format!("cd {} && entrix run --dry-run", repo_root.display()),
            proves:
                "The fitness rulebook remains executable and still exposes a stable evidence plan."
                    .to_string(),
        });
    }

    steps
}

fn resolve_harness_engineering_specialist_path(repo_root: &Path) -> Result<PathBuf, String> {
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "failed to resolve Routa workspace root".to_string())?;
    let current_dir = std::env::current_dir()
        .map_err(|error| format!("failed to determine cwd for specialist lookup: {error}"))?;

    [
        repo_root.join(HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH),
        workspace_root.join(HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH),
        current_dir.join(HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| {
        format!(
            "failed to locate harness engineering specialist definition: {}",
            HARNESS_ENGINEERING_SPECIALIST_RELATIVE_PATH
        )
    })
}

fn push_gap(gaps: &mut Vec<HarnessEngineeringGap>, gap: HarnessEngineeringGap) {
    if gaps.iter().any(|existing| existing.id == gap.id) {
        return;
    }
    gaps.push(gap);
}

fn insert_patch_candidate(
    patches: &mut Vec<HarnessEngineeringPatchCandidate>,
    seen: &mut BTreeMap<String, ()>,
    patch: HarnessEngineeringPatchCandidate,
) {
    if seen.contains_key(&patch.id) {
        return;
    }
    seen.insert(patch.id.clone(), ());
    patches.push(patch);
}

fn load_fluency_snapshots(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> Vec<LoadedFluencySnapshot> {
    let candidates = [
        ("generic", GENERIC_FLUENCY_SNAPSHOT_RELATIVE_PATH),
        (
            "agent_orchestrator",
            ORCHESTRATOR_FLUENCY_SNAPSHOT_RELATIVE_PATH,
        ),
    ];

    let mut snapshots = Vec::new();
    for (profile, relative_path) in candidates {
        let path = repo_root.join(relative_path);
        if !path.exists() {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(raw) => match parse_fluency_snapshot(profile, &raw) {
                Ok(snapshot) => snapshots.push(snapshot),
                Err(error) => warnings.push(format!(
                    "Failed to parse fluency snapshot {}: {error}",
                    path.display()
                )),
            },
            Err(error) => warnings.push(format!(
                "Failed to read fluency snapshot {}: {error}",
                path.display()
            )),
        }
    }

    snapshots
}

fn parse_fluency_snapshot(profile: &str, raw: &str) -> Result<LoadedFluencySnapshot, String> {
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid JSON snapshot: {error}"))?;
    let blocking_criteria = value
        .get("blockingCriteria")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(parse_blocking_criterion)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();

    Ok(LoadedFluencySnapshot {
        profile: profile.to_string(),
        overall_level: value
            .get("overallLevel")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        blocking_criteria,
        warnings: Vec::new(),
    })
}

fn parse_blocking_criterion(value: &Value) -> Result<FluencyBlockingCriterion, String> {
    Ok(FluencyBlockingCriterion {
        id: required_string(value, "id")?,
        critical: value
            .get("critical")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        detail: value
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("missing detail")
            .to_string(),
        evidence: value
            .get("evidence")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        recommended_action: value
            .get("recommendedAction")
            .and_then(Value::as_str)
            .unwrap_or("Repair the reported blocker before ratcheting the harness.")
            .to_string(),
        evidence_hint: value
            .get("evidenceHint")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("missing string field {key}"))
}

// Bootstrap Mode Implementation

fn should_bootstrap(repo_root: &Path) -> bool {
    let harness_dir = repo_root.join("docs/harness");
    let build_config = harness_dir.join("build.yml");
    let test_config = harness_dir.join("test.yml");

    // Bootstrap if harness dir doesn't exist or both build.yml and test.yml are missing
    !harness_dir.exists() || (!build_config.exists() && !test_config.exists())
}

async fn bootstrap_weak_repository(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringReport, String> {
    let mut warnings = Vec::new();
    let mut gaps = Vec::new();
    let mut recommended_actions = Vec::new();
    let mut patch_candidates = Vec::new();

    // Detect available scripts from package.json
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

    // Classify as bootstrap gaps
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
        Some(apply_patches(
            repo_root,
            &patch_candidates,
            &verification_plan,
            options,
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

fn format_script_invocation(
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

// Phase 3: Controlled Auto-Evolution Implementation

#[derive(Debug, Serialize)]
struct Snapshot {
    timestamp: String,
    files: BTreeMap<String, SnapshotFileState>,
}

#[derive(Debug, Serialize)]
struct SnapshotFileState {
    existed: bool,
    content: Option<String>,
}

fn create_snapshot(
    repo_root: &Path,
    patches: &[HarnessEngineeringPatchCandidate],
) -> Result<Snapshot, String> {
    let mut files = BTreeMap::new();

    for patch in patches {
        for target in &patch.targets {
            let path = repo_root.join(target);
            let existed = path.exists();
            let content = if existed {
                Some(
                    fs::read_to_string(&path)
                        .map_err(|e| format!("Failed to read {}: {}", target, e))?,
                )
            } else {
                None
            };
            files.insert(target.clone(), SnapshotFileState { existed, content });
        }
    }

    Ok(Snapshot {
        timestamp: Utc::now().to_rfc3339(),
        files,
    })
}

fn rollback_snapshot(repo_root: &Path, snapshot: &Snapshot) -> Result<(), String> {
    for (path_str, state) in &snapshot.files {
        let path = repo_root.join(path_str);
        if state.existed {
            let content = state.content.as_deref().ok_or_else(|| {
                format!("Snapshot missing original contents for {}", path.display())
            })?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory {}: {}", parent.display(), e)
                })?;
            }
            fs::write(&path, content)
                .map_err(|e| format!("Failed to rollback {}: {}", path_str, e))?;
        } else if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| format!("Failed to remove {} during rollback: {}", path_str, e))?;
            } else {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove {} during rollback: {}", path_str, e))?;
            }
            remove_empty_parent_dirs(repo_root, path.parent())?;
        }
    }
    Ok(())
}

fn remove_empty_parent_dirs(repo_root: &Path, mut current: Option<&Path>) -> Result<(), String> {
    while let Some(path) = current {
        if path == repo_root {
            break;
        }

        match fs::remove_dir(path) {
            Ok(()) => current = path.parent(),
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = path.parent();
            }
            Err(error) => {
                return Err(format!(
                    "Failed to clean up rollback directory {}: {}",
                    path.display(),
                    error
                ));
            }
        }
    }

    Ok(())
}

fn emit_apply_progress(options: &HarnessEngineeringOptions, message: impl AsRef<str>) {
    if options.json_output {
        eprintln!("{}", message.as_ref());
    } else {
        println!("{}", message.as_ref());
    }
}

fn build_verification_output_excerpt(stdout: &str, stderr: &str) -> Option<String> {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    if stdout.is_empty() && stderr.is_empty() {
        return None;
    }

    let mut combined = String::new();
    if !stdout.is_empty() {
        combined.push_str(stdout);
    }
    if !stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(stderr);
    }

    let excerpt = combined
        .lines()
        .take(8)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(600)
        .collect::<String>();
    Some(excerpt)
}

fn run_verification_plan(
    repo_root: &Path,
    steps: &[HarnessEngineeringVerificationStep],
    options: &HarnessEngineeringOptions,
) -> Result<Vec<HarnessEngineeringVerificationResult>, String> {
    if steps.is_empty() {
        return Ok(Vec::new());
    }

    emit_apply_progress(
        options,
        format!("🧪 Running {} verification steps...", steps.len()),
    );

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut results = Vec::with_capacity(steps.len());

    for step in steps {
        emit_apply_progress(options, format!("  → {}", step.label));
        let output = Command::new(&shell)
            .arg("-lc")
            .arg(&step.command)
            .current_dir(repo_root)
            .env("PATH", routa_core::shell_env::full_path())
            .output()
            .map_err(|error| {
                format!(
                    "Failed to execute verification step '{}' with shell {}: {}",
                    step.label, shell, error
                )
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let success = output.status.success();
        let result = HarnessEngineeringVerificationResult {
            label: step.label.clone(),
            command: step.command.clone(),
            proves: step.proves.clone(),
            success,
            exit_code: output.status.code(),
            output_excerpt: build_verification_output_excerpt(&stdout, &stderr),
        };

        if success {
            emit_apply_progress(options, format!("    ✓ {}", step.proves));
            results.push(result);
            continue;
        }

        let failure_detail = result
            .output_excerpt
            .clone()
            .unwrap_or_else(|| "no output captured".to_string());
        results.push(result);
        return Err(format!(
            "Verification failed at '{}': {}",
            step.label, failure_detail
        ));
    }

    Ok(results)
}

fn apply_patches(
    repo_root: &Path,
    patches: &[HarnessEngineeringPatchCandidate],
    verification_plan: &[HarnessEngineeringVerificationStep],
    options: &HarnessEngineeringOptions,
) -> Result<ApplyOutcome, String> {
    // Separate patches by risk level
    let low_risk: Vec<_> = patches.iter().filter(|p| p.risk == "low").collect();
    let medium_risk: Vec<_> = patches.iter().filter(|p| p.risk == "medium").collect();
    let high_risk: Vec<_> = patches.iter().filter(|p| p.risk == "high").collect();

    emit_apply_progress(options, "\n🔧 Harness Evolution - Apply Mode");
    emit_apply_progress(options, "─────────────────────────────────");
    emit_apply_progress(
        options,
        format!("  Low risk patches:    {}", low_risk.len()),
    );
    emit_apply_progress(
        options,
        format!("  Medium risk patches: {}", medium_risk.len()),
    );
    emit_apply_progress(
        options,
        format!("  High risk patches:   {}", high_risk.len()),
    );
    emit_apply_progress(options, "");

    let mut selected_for_apply: Vec<&HarnessEngineeringPatchCandidate> = low_risk.clone();
    let risky_patches_refs: Vec<&HarnessEngineeringPatchCandidate> = medium_risk
        .iter()
        .chain(high_risk.iter())
        .copied()
        .collect();

    if !risky_patches_refs.is_empty() {
        if options.force {
            emit_apply_progress(
                options,
                format!(
                    "⚠️  Applying {} medium/high-risk patches with --force...",
                    risky_patches_refs.len()
                ),
            );
            selected_for_apply.extend(risky_patches_refs.iter().copied());
        } else {
            emit_apply_progress(
                options,
                format!(
                    "⏸  {} medium/high-risk patches require review",
                    risky_patches_refs.len()
                ),
            );
            emit_apply_progress(
                options,
                "   Run with --force to apply them (use with caution)",
            );
            for patch in &risky_patches_refs {
                emit_apply_progress(options, format!("   - [{}] {}", patch.risk, patch.title));
            }
        }
    }

    if selected_for_apply.is_empty() {
        return Ok(ApplyOutcome {
            verification_results: Vec::new(),
            ratchet: HarnessEngineeringRatchetResult {
                enforced: false,
                regressed: false,
                profiles: Vec::new(),
            },
        });
    }

    let selected_owned = selected_for_apply
        .iter()
        .map(|patch| (*patch).clone())
        .collect::<Vec<_>>();
    let snapshot = create_snapshot(repo_root, &selected_owned)?;

    if !low_risk.is_empty() {
        emit_apply_progress(
            options,
            format!(
                "✓ Applying {} low-risk patches automatically...",
                low_risk.len()
            ),
        );
        if let Err(error) = apply_patch_batch(repo_root, &low_risk, options) {
            eprintln!("  ✗ Failed to apply low-risk patches: {}", error);
            eprintln!("  ↻ Rolling back changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply)
            {
                eprintln!(
                    "  ⚠️  Warning: Failed to record evolution history: {}",
                    history_error
                );
            }
            return Err(format!("Low-risk patch application failed: {}", error));
        }
        emit_apply_progress(options, "  ✓ Low-risk patches applied successfully");
    }

    if options.force && !risky_patches_refs.is_empty() {
        if let Err(error) = apply_patch_batch(repo_root, &risky_patches_refs, options) {
            eprintln!("  ✗ Failed: {}", error);
            eprintln!("  ↻ Rolling back...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply)
            {
                eprintln!(
                    "  ⚠️  Warning: Failed to record evolution history: {}",
                    history_error
                );
            }
            return Err(error);
        }
        emit_apply_progress(options, "  ✓ Medium/high-risk patches applied");
    }

    let verification_results = match run_verification_plan(repo_root, verification_plan, options) {
        Ok(results) => results,
        Err(error) => {
            eprintln!("  ✗ Verification failed: {}", error);
            eprintln!("  ↻ Rolling back verified changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply)
            {
                eprintln!(
                    "  ⚠️  Warning: Failed to record evolution history: {}",
                    history_error
                );
            }
            return Err(error);
        }
    };

    let ratchet = match run_ratchet_loop(repo_root, options) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("  ✗ Ratchet failed: {}", error);
            eprintln!("  ↻ Rolling back verified changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply)
            {
                eprintln!(
                    "  ⚠️  Warning: Failed to record evolution history: {}",
                    history_error
                );
            }
            return Err(error);
        }
    };

    if let Err(error) = record_evolution_outcome(repo_root, &selected_for_apply, &[]) {
        eprintln!(
            "  ⚠️  Warning: Failed to record evolution history: {}",
            error
        );
    }

    Ok(ApplyOutcome {
        verification_results,
        ratchet,
    })
}

fn apply_patch_batch(
    repo_root: &Path,
    patches: &[&HarnessEngineeringPatchCandidate],
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    for patch in patches {
        apply_single_patch(repo_root, patch, options)?;
    }
    Ok(())
}

fn apply_single_patch(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    match patch.id.as_str() {
        "bootstrap.synthesize_build_yml" => {
            synthesize_build_yml(repo_root, patch, options)?;
        }
        "bootstrap.synthesize_test_yml" => {
            synthesize_test_yml(repo_root, patch, options)?;
        }
        "patch.normalize_automation_target" => {
            normalize_automation_target(repo_root, patch, options)?;
        }
        "patch.create_codeowners" => {
            create_codeowners(repo_root, patch, options)?;
        }
        "patch.create_dependabot" => {
            create_dependabot(repo_root, patch, options)?;
        }
        "patch.update_coverage_threshold" => {
            update_coverage_threshold(repo_root, patch, options)?;
        }
        "patch.create_operational_docs" => {
            create_operational_docs(repo_root, patch, options)?;
        }
        _ => return Err(format!("Patch {} is not implemented", patch.id)),
    }
    Ok(())
}

fn synthesize_build_yml(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let harness_dir = repo_root.join("docs/harness");
    fs::create_dir_all(&harness_dir)
        .map_err(|e| format!("Failed to create docs/harness: {}", e))?;

    let build_yml = harness_dir.join("build.yml");
    let build_script_name = patch.script_name.as_deref().unwrap_or("build");
    let build_command = format_script_invocation(
        repo_root,
        build_script_name,
        patch.script_command.as_deref(),
    );
    let build_pattern = regex::escape(build_script_name);

    let content = format!(
        r#"schema: harness-surface-v1
surface: build
title: Build feedback
summary: Auto-generated bootstrap surface anchored to the detected `{}` script.
overview:
  - id: repository-shape
    label: Repository shape
    source: files
    paths:
      - package.json
      - pnpm-lock.yaml
      - package-lock.json
      - yarn.lock
      - Cargo.toml
    limit: 5
  - id: outputs
    label: Outputs
    source: files
    paths:
      - dist
      - build
      - out
      - target
    limit: 4
entrypointGroups:
  - id: bootstrap-build
    label: Build flow
    category: build
    scriptNamePatterns:
      - "^{}$"
# detectedCommand: {}
"#,
        build_script_name, build_pattern, build_command
    );

    fs::write(&build_yml, content).map_err(|e| format!("Failed to write build.yml: {}", e))?;

    emit_apply_progress(options, "  ✓ Created docs/harness/build.yml");
    Ok(())
}

fn synthesize_test_yml(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let harness_dir = repo_root.join("docs/harness");
    fs::create_dir_all(&harness_dir)
        .map_err(|e| format!("Failed to create docs/harness: {}", e))?;

    let test_yml = harness_dir.join("test.yml");
    let test_script_name = patch.script_name.as_deref().unwrap_or("test");
    let test_command =
        format_script_invocation(repo_root, test_script_name, patch.script_command.as_deref());
    let test_pattern = regex::escape(test_script_name);

    let content = format!(
        r#"schema: harness-surface-v1
surface: test
title: Test feedback
summary: Auto-generated bootstrap surface anchored to the detected `{}` script.
overview:
  - id: repository-shape
    label: Repository shape
    source: files
    paths:
      - package.json
      - pnpm-lock.yaml
      - package-lock.json
      - yarn.lock
      - Cargo.toml
    limit: 5
  - id: artifacts
    label: Artifacts
    source: files
    paths:
      - coverage
      - test-results
      - docs/fitness/reports
    limit: 4
entrypointGroups:
  - id: bootstrap-test
    label: Test flow
    category: unit
    scriptNamePatterns:
      - "^{}$"
# detectedCommand: {}
"#,
        test_script_name, test_pattern, test_command
    );

    fs::write(&test_yml, content).map_err(|e| format!("Failed to write test.yml: {}", e))?;

    emit_apply_progress(options, "  ✓ Created docs/harness/test.yml");
    Ok(())
}

// Phase 3: Feedback Learning Loop (Foundation)

#[derive(Debug, Serialize)]
struct EvolutionHistory {
    timestamp: String,
    repo_root: String,
    mode: String,
    patches_applied: Vec<String>,
    patches_failed: Vec<String>,
    success_rate: f64,
}

fn record_evolution_outcome(
    repo_root: &Path,
    applied: &[&HarnessEngineeringPatchCandidate],
    failed: &[&HarnessEngineeringPatchCandidate],
) -> Result<(), String> {
    let history_dir = repo_root.join("docs/fitness/evolution");
    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create evolution history dir: {}", e))?;

    let history_file = history_dir.join("history.jsonl");

    let record = EvolutionHistory {
        timestamp: Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: "auto-apply".to_string(),
        patches_applied: applied.iter().map(|p| p.id.clone()).collect(),
        patches_failed: failed.iter().map(|p| p.id.clone()).collect(),
        success_rate: if applied.is_empty() && failed.is_empty() {
            0.0
        } else {
            applied.len() as f64 / (applied.len() + failed.len()) as f64
        },
    };

    let json_line = serde_json::to_string(&record)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history_file)
        .map_err(|e| format!("Failed to open history file: {}", e))?;

    use std::io::Write;
    writeln!(file, "{}", json_line).map_err(|e| format!("Failed to write history: {}", e))?;

    Ok(())
}

fn normalize_automation_target(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let automations_path = repo_root.join("docs/harness/automations.yml");

    if !automations_path.exists() {
        return Err("docs/harness/automations.yml not found".to_string());
    }

    let content = fs::read_to_string(&automations_path)
        .map_err(|e| format!("Failed to read automations.yml: {}", e))?;

    // Fix: weekly-harness-fluency should point to harness-fluency specialist, not harness-test
    // Line 24: ref: harness-test -> ref: harness-fluency
    let fixed_content = content.replace(
        "    target:\n      type: specialist\n      ref: harness-test",
        "    target:\n      type: specialist\n      ref: harness-fluency",
    );

    if fixed_content == content {
        emit_apply_progress(options, "  ℹ️  No changes needed in automations.yml");
        return Ok(());
    }

    fs::write(&automations_path, fixed_content)
        .map_err(|e| format!("Failed to write automations.yml: {}", e))?;

    emit_apply_progress(
        options,
        "  ✓ Normalized automation target: weekly-harness-fluency now points to harness-fluency",
    );

    Ok(())
}

fn create_codeowners(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let github_dir = repo_root.join(".github");
    fs::create_dir_all(&github_dir)
        .map_err(|e| format!("Failed to create .github directory: {}", e))?;

    let codeowners_path = github_dir.join("CODEOWNERS");

    if codeowners_path.exists() {
        emit_apply_progress(options, "  ℹ️  CODEOWNERS already exists");
        return Ok(());
    }

    // Generate basic CODEOWNERS based on git history
    let content = generate_codeowners_content(repo_root)?;

    fs::write(&codeowners_path, content)
        .map_err(|e| format!("Failed to write CODEOWNERS: {}", e))?;

    emit_apply_progress(
        options,
        "  ✓ Created .github/CODEOWNERS with automatic reviewer assignments",
    );

    Ok(())
}

fn generate_codeowners_content(repo_root: &Path) -> Result<String, String> {
    // Try to detect main contributors from git log
    let output = std::process::Command::new("git")
        .args(["log", "--format=%ae", "--all"])
        .current_dir(repo_root)
        .output();

    let primary_owner = if let Ok(output) = output {
        let emails = String::from_utf8_lossy(&output.stdout);
        let mut email_counts: BTreeMap<String, usize> = BTreeMap::new();
        for email in emails.lines() {
            *email_counts.entry(email.to_string()).or_insert(0) += 1;
        }
        email_counts
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(email, _)| email)
            .unwrap_or_else(|| "@phodal".to_string())
    } else {
        "@phodal".to_string()
    };

    Ok(format!(
        r#"# CODEOWNERS - Automatic reviewer assignment
# Auto-generated by routa harness evolve --apply

# Global owner
* {}

# Critical paths require review
/docs/fitness/ {}
/docs/harness/ {}
/resources/specialists/ {}

# Infrastructure
/.github/ {}
/crates/routa-core/ {}
"#,
        primary_owner, primary_owner, primary_owner, primary_owner, primary_owner, primary_owner
    ))
}

fn create_dependabot(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let github_dir = repo_root.join(".github");
    fs::create_dir_all(&github_dir)
        .map_err(|e| format!("Failed to create .github directory: {}", e))?;

    let dependabot_path = github_dir.join("dependabot.yml");

    if dependabot_path.exists() {
        emit_apply_progress(options, "  ℹ️  dependabot.yml already exists");
        return Ok(());
    }

    // Detect package managers in use
    let has_cargo = repo_root.join("Cargo.toml").exists();
    let has_npm = repo_root.join("package.json").exists();
    let has_github_actions = repo_root.join(".github/workflows").exists();

    let mut ecosystems = Vec::new();

    if has_cargo {
        ecosystems.push(
            r#"  - package-ecosystem: "cargo"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10"#,
        );
    }

    if has_npm {
        ecosystems.push(
            r#"  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10"#,
        );
    }

    if has_github_actions {
        ecosystems.push(
            r#"  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly""#,
        );
    }

    let content = format!(
        r#"# Dependabot configuration - Automatic dependency updates
# Auto-generated by routa harness evolve --apply

version: 2
updates:
{}
"#,
        ecosystems.join("\n")
    );

    fs::write(&dependabot_path, content)
        .map_err(|e| format!("Failed to write dependabot.yml: {}", e))?;

    let message = format!(
        "  ✓ Created .github/dependabot.yml with {} ecosystem(s)",
        ecosystems.len()
    );
    emit_apply_progress(options, &message);

    Ok(())
}

fn update_coverage_threshold(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let test_yml_path = repo_root.join("docs/harness/test.yml");

    if !test_yml_path.exists() {
        return Err("docs/harness/test.yml not found".to_string());
    }

    let content = fs::read_to_string(&test_yml_path)
        .map_err(|e| format!("Failed to read test.yml: {}", e))?;

    // Check if already has coverage configuration
    if content.contains("coverage:") {
        emit_apply_progress(options, "  ℹ️  Coverage tracking already configured");
        return Ok(());
    }

    // Add coverage section at the end
    let coverage_section = r#"
# Coverage tracking - automatically added by harness evolution
coverage:
  enabled: true
  threshold:
    lines: 0      # Will ratchet up as coverage improves
    branches: 0
    functions: 0
    statements: 0
  report_dir: coverage
"#;

    let updated_content = format!("{}{}", content.trim_end(), coverage_section);

    fs::write(&test_yml_path, updated_content)
        .map_err(|e| format!("Failed to write test.yml: {}", e))?;

    emit_apply_progress(
        options,
        "  ✓ Added coverage tracking to docs/harness/test.yml (threshold: 0%, ready for ratcheting)"
    );

    Ok(())
}

fn create_operational_docs(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let operational_dir = repo_root.join("docs/operational");

    // Create operational docs if missing
    if !operational_dir.exists() {
        fs::create_dir_all(&operational_dir)
            .map_err(|e| format!("Failed to create operational dir: {}", e))?;

        // Create placeholder operational history
        let placeholder_content = r#"# Operational History

This directory tracks operational decisions, incidents, and runbooks.

## Purpose

- **Decisions**: Key operational choices and their rationale
- **Incidents**: Post-mortems and learnings
- **Runbooks**: Standard operating procedures
- **Changes**: Deployment and configuration history

## Structure

```
operational/
├── decisions/        # ADR-style operational decisions
├── incidents/        # Incident reports and post-mortems
├── runbooks/         # Step-by-step procedures
└── changes/          # Deployment and config change log
```

## Getting Started

Add operational documentation as the system evolves. Start with:

1. Create `decisions/001-initial-setup.md` for first major operational choice
2. Add runbooks for common tasks (deployment, rollback, troubleshooting)
3. Document incidents to prevent recurrence

---

*Auto-generated by routa harness evolve --apply*
"#;

        fs::write(operational_dir.join("README.md"), placeholder_content)
            .map_err(|e| format!("Failed to write operational README: {}", e))?;

        // Create subdirectories
        for subdir in &["decisions", "incidents", "runbooks", "changes"] {
            let dir = operational_dir.join(subdir);
            fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", subdir, e))?;
            fs::write(
                dir.join(".gitkeep"),
                "# Placeholder for operational documentation\n",
            )
            .map_err(|e| format!("Failed to write .gitkeep: {}", e))?;
        }

        emit_apply_progress(
            options,
            "  ✓ Created docs/operational with placeholder structure",
        );
    } else {
        emit_apply_progress(
            options,
            "  ℹ️  Operational documentation directory already exists",
        );
    }

    Ok(())
}
