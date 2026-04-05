use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use routa_core::harness::HarnessRepoSignalsReport;
use routa_core::harness_automation::detect_repo_automations;
use routa_core::harness_template::{DoctorReport, DriftLevel};
use routa_core::spec_detector::{detect_spec_sources, SpecDetectionReport};
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

#[derive(Debug, Clone)]
pub struct HarnessEngineeringOptions {
    pub output_path: PathBuf,
    pub dry_run: bool,
    pub bootstrap: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringReport {
    pub generated_at: String,
    pub repo_root: String,
    pub mode: String,
    pub report_path: String,
    pub summary: HarnessEngineeringSummary,
    pub inputs: HarnessEngineeringInputs,
    pub gaps: Vec<HarnessEngineeringGap>,
    pub recommended_actions: Vec<HarnessEngineeringAction>,
    pub patch_candidates: Vec<HarnessEngineeringPatchCandidate>,
    pub verification_plan: Vec<HarnessEngineeringVerificationStep>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringSummary {
    pub total_gaps: usize,
    pub blocking_gaps: usize,
    pub harness_mutation_candidates: usize,
    pub non_harness_gaps: usize,
    pub low_risk_patch_candidates: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringInputs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_signals: Option<RepoSignalsSummary>,
    pub templates: TemplateSummary,
    pub automations: AutomationSummary,
    pub specs: SpecSummary,
    pub fitness: FitnessSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSignalsSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
    pub lockfiles: Vec<String>,
    pub build_entrypoint_groups: usize,
    pub test_entrypoint_groups: usize,
    pub build_overview_items: usize,
    pub test_overview_items: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub templates_checked: usize,
    pub drift_error_count: usize,
    pub drift_warning_count: usize,
    pub missing_sensor_files: usize,
    pub missing_automation_refs: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSummary {
    pub definition_count: usize,
    pub pending_signal_count: usize,
    pub recent_run_count: usize,
    pub definition_only_count: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecSummary {
    pub source_count: usize,
    pub feature_count: usize,
    pub systems: Vec<String>,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessSummary {
    pub manifest_present: bool,
    pub fluency_snapshots_loaded: usize,
    pub blocking_criteria_count: usize,
    pub critical_blocking_criteria_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringGap {
    pub id: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub evidence: Vec<String>,
    pub suggested_fix: String,
    pub harness_mutation_candidate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringAction {
    pub gap_id: String,
    pub priority: usize,
    pub action: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringPatchCandidate {
    pub id: String,
    pub risk: String,
    pub title: String,
    pub rationale: String,
    pub targets: Vec<String>,
    pub change_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringVerificationStep {
    pub label: String,
    pub command: String,
    pub proves: String,
}

#[derive(Debug, Clone)]
struct LoadedFluencySnapshot {
    profile: String,
    overall_level: Option<String>,
    blocking_criteria: Vec<FluencyBlockingCriterion>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct FluencyBlockingCriterion {
    id: String,
    critical: bool,
    detail: String,
    evidence: Vec<String>,
    recommended_action: String,
    evidence_hint: String,
}

pub fn evaluate_harness_engineering(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringReport, String> {
    let mut warnings = Vec::new();

    // Bootstrap mode: detect weak repo and synthesize initial harness
    if options.bootstrap {
        if should_bootstrap(repo_root) {
            return bootstrap_weak_repository(repo_root, options);
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
        verification_plan: build_verification_plan(repo_root),
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

    if !report.verification_plan.is_empty() {
        lines.push(String::new());
        lines.push("verification:".to_string());
        for step in &report.verification_plan {
            lines.push(format!("  {} -> {}", step.label, step.command));
        }
    }

    lines.join("\n")
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
            },
        );
    }

    patches
}

fn build_verification_plan(repo_root: &Path) -> Vec<HarnessEngineeringVerificationStep> {
    let mut steps = vec![HarnessEngineeringVerificationStep {
        label: "Harness engineering dry-run".to_string(),
        command: format!(
            "cargo run -p routa-cli -- harness evolve --repo-root {} --dry-run --format json",
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

#[cfg(test)]
mod tests {
    use super::{
        evaluate_harness_engineering, should_bootstrap, HarnessEngineeringOptions,
        DEFAULT_REPORT_RELATIVE_PATH,
    };
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reports_missing_bootstrap_surfaces_for_weak_repo() {
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
            },
        )
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

    #[test]
    fn classifies_fluency_blockers_into_harness_and_non_harness() {
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
            },
        )
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

    #[test]
    fn detects_fluency_automation_target_mismatch() {
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
            },
        )
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
        fs::write(temp.path().join("docs/harness/build.yml"), "# stub")
            .expect("build.yml");

        assert!(!should_bootstrap(temp.path()));
    }
}

// Bootstrap Mode Implementation

fn should_bootstrap(repo_root: &Path) -> bool {
    let harness_dir = repo_root.join("docs/harness");
    let build_config = harness_dir.join("build.yml");
    let test_config = harness_dir.join("test.yml");

    // Bootstrap if harness dir doesn't exist or both build.yml and test.yml are missing
    !harness_dir.exists() || (!build_config.exists() && !test_config.exists())
}

fn bootstrap_weak_repository(
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
        let build_scripts = scripts
            .iter()
            .filter(|(name, _)| {
                name.contains("build") || name.contains("compile") || name.contains("bundle")
            })
            .collect::<Vec<_>>();
        let test_scripts = scripts
            .iter()
            .filter(|(name, _)| name.contains("test") || name.contains("spec"))
            .collect::<Vec<_>>();

        if !build_scripts.is_empty() {
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
            });
        }

        if !test_scripts.is_empty() {
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
        verification_plan: vec![HarnessEngineeringVerificationStep {
            label: "Verify harness directory created".to_string(),
            command: "test -d docs/harness".to_string(),
            proves: "Harness configuration directory exists".to_string(),
        }],
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
