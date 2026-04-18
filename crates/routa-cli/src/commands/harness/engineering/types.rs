//! Type definitions for Harness Engineering

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct HarnessEngineeringOptions {
    pub output_path: PathBuf,
    pub dry_run: bool,
    pub bootstrap: bool,
    pub apply: bool,
    pub force: bool,
    pub json_output: bool,
    pub use_ai_specialist: bool,
    pub ai_workspace_id: String,
    pub ai_provider: Option<String>,
    pub ai_provider_timeout_ms: Option<u64>,
    pub ai_provider_retries: u8,
    pub learn: bool, // Generate playbooks from evolution history
    pub speed_profile: bool, // Trigger single dry-run fitness speed experiment
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub verification_results: Vec<HarnessEngineeringVerificationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratchet: Option<HarnessEngineeringRatchetResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_assessment: Option<HarnessEngineeringAiAssessment>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringAiAssessment {
    pub specialist_id: String,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub payload: Value,
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

pub(super) struct HarnessEngineeringAiPromptContext<'a> {
    pub repo_root: &'a Path,
    pub gaps: &'a [HarnessEngineeringGap],
    pub recommended_actions: &'a [HarnessEngineeringAction],
    pub patch_candidates: &'a [HarnessEngineeringPatchCandidate],
    pub templates: &'a TemplateSummary,
    pub automations: &'a AutomationSummary,
    pub specs: &'a SpecSummary,
    pub fitness: &'a FitnessSummary,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringVerificationStep {
    pub label: String,
    pub command: String,
    pub proves: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringVerificationResult {
    pub label: String,
    pub command: String,
    pub proves: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringRatchetResult {
    pub enforced: bool,
    pub regressed: bool,
    pub profiles: Vec<HarnessEngineeringRatchetProfileResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEngineeringRatchetProfileResult {
    pub profile: String,
    pub snapshot_path: String,
    pub status: String,
    pub current_overall_level: String,
    pub current_baseline_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_generated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_overall_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_baseline_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_score_delta: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub regressed_criteria: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub improved_criteria: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct LoadedFluencySnapshot {
    pub profile: String,
    pub overall_level: Option<String>,
    pub blocking_criteria: Vec<FluencyBlockingCriterion>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct FluencyBlockingCriterion {
    pub id: String,
    pub critical: bool,
    pub detail: String,
    pub evidence: Vec<String>,
    pub recommended_action: String,
    pub evidence_hint: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub(super) struct EvolutionHistory {
    pub timestamp: String,
    pub repo_root: String,
    pub mode: String,

    // NEW: Link to agent traces
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,

    // NEW: Task fingerprint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,

    // NEW: Evidence bundle
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gaps_detected: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_categories: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_paths: Option<Vec<String>>,

    // Existing fields
    pub patches_applied: Vec<String>,
    pub patches_failed: Vec<String>,
    pub success_rate: f64,

    // NEW: Failure context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_messages: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub(super) struct Snapshot {
    pub timestamp: String,
    pub files: std::collections::BTreeMap<String, String>,
}

/// Context for evolution history recording
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(super) struct EvolutionContext {
    pub session_id: Option<String>,
    pub workflow: Option<String>,
    pub gaps_detected: usize,
    pub gap_categories: Vec<String>,
    pub rollback_reason: Option<String>,
    pub error_messages: Option<Vec<String>>,
}
