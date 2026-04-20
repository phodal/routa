use crate::govern::evidence::{EvidenceRequirement, EvidenceType};
use crate::run::policy::{EffectClass, PolicyDecisionKind};

#[derive(Debug, Clone)]
pub struct EvidenceRequirementStatus {
    pub(crate) requirement: EvidenceRequirement,
    pub(crate) satisfied: bool,
}

pub struct RunGuardrailsInput<'a> {
    pub(crate) changed_files: &'a [String],
    pub(crate) touched_files_count: usize,
    pub(crate) unknown_files_count: usize,
    pub(crate) last_tool_name: Option<&'a str>,
    pub(crate) status: &'a str,
    pub(crate) last_event_name: Option<&'a str>,
    pub(crate) is_unknown_bucket: bool,
    pub(crate) is_synthetic_run: bool,
    pub(crate) is_service_run: bool,
    pub(crate) has_eval: bool,
    pub(crate) hard_gate_blocked: bool,
    pub(crate) score_blocked: bool,
    pub(crate) has_coverage: bool,
    pub(crate) api_contract_passed: bool,
    pub(crate) integrity_warning: Option<&'a str>,
}

pub struct RunGuardrailsAssessment {
    pub(crate) effect_classes: Vec<EffectClass>,
    pub(crate) policy_decision: PolicyDecisionKind,
    pub(crate) approval_label: String,
    pub(crate) block_reason: Option<String>,
    pub(crate) operator_state: String,
    pub(crate) next_action: String,
    pub(crate) evidence: Vec<EvidenceRequirementStatus>,
}

pub fn assess_run_guardrails(input: &RunGuardrailsInput<'_>) -> RunGuardrailsAssessment {
    let effect_classes = infer_effect_classes(input);
    let policy_decision = infer_policy_decision(input.is_unknown_bucket, &effect_classes);
    let evidence = build_evidence_requirements(input, policy_decision.clone());
    let block_reason = infer_block_reason(input, policy_decision.clone(), &evidence);
    let operator_state = infer_operator_state(input, block_reason.as_deref());
    let approval_label = approval_label_for(policy_decision.clone(), &evidence);
    let next_action = next_action_for(input, policy_decision.clone(), block_reason.as_deref());

    RunGuardrailsAssessment {
        effect_classes,
        policy_decision,
        approval_label,
        block_reason,
        operator_state,
        next_action,
        evidence,
    }
}

pub(crate) fn evidence_inline_summary(evidence: &[EvidenceRequirementStatus]) -> String {
    if evidence.is_empty() {
        return "none".to_string();
    }
    evidence
        .iter()
        .map(|item| {
            let status = if item.satisfied { "ok" } else { "missing" };
            format!("{status}:{}", item.requirement.kind.as_str())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn effect_classes_summary(effect_classes: &[EffectClass]) -> String {
    effect_classes
        .iter()
        .map(EffectClass::as_str)
        .collect::<Vec<_>>()
        .join(",")
}

fn infer_effect_classes(input: &RunGuardrailsInput<'_>) -> Vec<EffectClass> {
    let mut effects = Vec::new();
    if !input.changed_files.is_empty()
        || input.touched_files_count > 0
        || input.unknown_files_count > 0
        || input.is_unknown_bucket
    {
        effects.push(EffectClass::RepoWrite);
    }

    match input.last_tool_name.map(|value| value.to_ascii_lowercase()) {
        Some(tool) if tool == "websearch" => effects.push(EffectClass::NetworkRead),
        Some(tool) if matches!(tool.as_str(), "write" | "edit" | "multiedit") => {
            effects.push(EffectClass::RepoWrite)
        }
        Some(tool) if tool == "bash" => effects.push(EffectClass::LocalWrite),
        Some(tool) if matches!(tool.as_str(), "read" | "search" | "grep" | "glob" | "ls") => {
            effects.push(EffectClass::ReadOnly)
        }
        _ => {}
    }

    if effects.is_empty() {
        effects.push(EffectClass::ReadOnly);
    }

    effects.sort();
    effects.dedup();
    effects
}

fn infer_policy_decision(
    is_unknown_bucket: bool,
    effect_classes: &[EffectClass],
) -> PolicyDecisionKind {
    if is_unknown_bucket {
        return PolicyDecisionKind::Deny;
    }
    if effect_classes
        .iter()
        .any(EffectClass::requires_explicit_allow)
    {
        PolicyDecisionKind::RequireApproval
    } else if effect_classes.iter().any(|effect| {
        matches!(
            effect,
            EffectClass::RepoWrite
                | EffectClass::GitWrite
                | EffectClass::PrCreate
                | EffectClass::Merge
                | EffectClass::Deploy
                | EffectClass::ProdWrite
        )
    }) {
        PolicyDecisionKind::AllowWithEvidence
    } else {
        PolicyDecisionKind::Allow
    }
}

fn build_evidence_requirements(
    input: &RunGuardrailsInput<'_>,
    policy_decision: PolicyDecisionKind,
) -> Vec<EvidenceRequirementStatus> {
    let mut evidence = Vec::new();
    let has_repo_changes = !input.changed_files.is_empty()
        || input.touched_files_count > 0
        || input.unknown_files_count > 0
        || input.is_unknown_bucket;

    if has_repo_changes {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::DiffSummary,
                description: "dirty diff recorded".to_string(),
                required: true,
            },
            satisfied: !input.changed_files.is_empty()
                || input.unknown_files_count > 0
                || input.is_unknown_bucket,
        });
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::TestReport,
                description: "fitness evidence attached".to_string(),
                required: true,
            },
            satisfied: input.has_eval,
        });
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::CoverageReport,
                description: "coverage evidence attached".to_string(),
                required: true,
            },
            satisfied: input.has_coverage,
        });
    }

    if input
        .changed_files
        .iter()
        .any(|path| path.contains("/api/"))
    {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::ContractReport,
                description: "API contract verified".to_string(),
                required: true,
            },
            satisfied: input.api_contract_passed,
        });
    }

    if matches!(
        policy_decision,
        PolicyDecisionKind::RequireApproval | PolicyDecisionKind::Deny
    ) {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::HumanApproval,
                description: "operator approval recorded".to_string(),
                required: true,
            },
            satisfied: false,
        });
    }

    evidence
}

fn infer_block_reason(
    input: &RunGuardrailsInput<'_>,
    policy_decision: PolicyDecisionKind,
    evidence: &[EvidenceRequirementStatus],
) -> Option<String> {
    if input.is_unknown_bucket || input.unknown_files_count > 0 {
        return Some("ownership ambiguity".to_string());
    }
    if input.is_service_run {
        return Some("background MCP service".to_string());
    }
    if input
        .integrity_warning
        .is_some_and(|warning| warning.contains("path missing"))
    {
        return Some("workspace path missing".to_string());
    }
    if input
        .integrity_warning
        .is_some_and(|warning| warning.contains("detached HEAD"))
    {
        return Some("workspace detached head".to_string());
    }
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        return Some("approval required".to_string());
    }
    if matches!(policy_decision, PolicyDecisionKind::Deny) {
        return Some("manual review required".to_string());
    }
    if input.hard_gate_blocked {
        return Some("hard gate failure".to_string());
    }
    if input.score_blocked {
        return Some("score threshold failed".to_string());
    }
    evidence
        .iter()
        .find(|item| item.requirement.required && !item.satisfied)
        .map(|item| format!("missing {}", item.requirement.kind.as_str()))
}

fn infer_operator_state(input: &RunGuardrailsInput<'_>, block_reason: Option<&str>) -> String {
    if input.is_service_run {
        return "service".to_string();
    }
    if input
        .last_event_name
        .is_some_and(|event| event.to_ascii_lowercase().contains("replay"))
    {
        return "replayed".to_string();
    }
    if block_reason.is_some_and(|reason| {
        reason.contains("ownership")
            || reason.contains("manual review")
            || reason.contains("workspace ")
    }) {
        return "attention".to_string();
    }
    if block_reason.is_some_and(|reason| reason.contains("approval")) {
        return "awaiting_approval".to_string();
    }
    if input.hard_gate_blocked || input.score_blocked {
        return "failed".to_string();
    }
    if input.status == "active" {
        return "executing".to_string();
    }
    if input.is_synthetic_run {
        return "observing".to_string();
    }
    if matches!(input.status, "idle" | "stopped" | "ended") {
        return "evaluating".to_string();
    }
    if input.has_eval {
        return "evaluating".to_string();
    }
    "ready".to_string()
}

fn approval_label_for(
    policy_decision: PolicyDecisionKind,
    evidence: &[EvidenceRequirementStatus],
) -> String {
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        "required".to_string()
    } else if evidence
        .iter()
        .any(|item| item.requirement.required && !item.satisfied)
    {
        "waiting_on_evidence".to_string()
    } else if matches!(policy_decision, PolicyDecisionKind::Deny) {
        "blocked".to_string()
    } else {
        "not_required".to_string()
    }
}

fn next_action_for(
    input: &RunGuardrailsInput<'_>,
    policy_decision: PolicyDecisionKind,
    block_reason: Option<&str>,
) -> String {
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        "grant approval or reduce effect scope".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("hard gate")) {
        "fix failing hard gates and rerun fast eval".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("score")) {
        "improve fitness score before continuing".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("test_report")) {
        "run fast eval and attach test evidence".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("coverage")) {
        "generate coverage evidence".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("contract_report")) {
        "verify API contract changes".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("diff_summary")) {
        "record dirty diff before continuing".to_string()
    } else if input
        .integrity_warning
        .is_some_and(|warning| warning.contains("detached HEAD"))
    {
        "inspect worktree branch/head before continuing".to_string()
    } else if input
        .integrity_warning
        .is_some_and(|warning| warning.contains("path missing"))
    {
        "repair or recreate the workspace path".to_string()
    } else if input.is_synthetic_run {
        "attach hooks or keep observing unmanaged run".to_string()
    } else if input.is_unknown_bucket || input.unknown_files_count > 0 {
        "resolve file ownership before continuing".to_string()
    } else {
        "handoff to reviewer or continue execution".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_write_requires_eval_and_coverage_evidence() {
        let changed_files = vec!["src/api/tasks.rs".to_string()];
        let assessment = assess_run_guardrails(&RunGuardrailsInput {
            changed_files: &changed_files,
            touched_files_count: 1,
            unknown_files_count: 0,
            last_tool_name: Some("write"),
            status: "idle",
            last_event_name: None,
            is_unknown_bucket: false,
            is_synthetic_run: false,
            is_service_run: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
            integrity_warning: None,
        });

        assert_eq!(
            effect_classes_summary(&assessment.effect_classes),
            "repo_write"
        );
        assert_eq!(assessment.policy_decision.as_str(), "allow_with_evidence");
        assert_eq!(assessment.approval_label, "waiting_on_evidence");
        assert_eq!(
            assessment.block_reason.as_deref(),
            Some("missing test_report")
        );
        assert_eq!(
            assessment.next_action,
            "run fast eval and attach test evidence"
        );
    }

    #[test]
    fn unknown_bucket_blocks_with_manual_review() {
        let changed_files = vec!["src/lib.rs".to_string()];
        let assessment = assess_run_guardrails(&RunGuardrailsInput {
            changed_files: &changed_files,
            touched_files_count: 1,
            unknown_files_count: 1,
            last_tool_name: None,
            status: "idle",
            last_event_name: None,
            is_unknown_bucket: true,
            is_synthetic_run: false,
            is_service_run: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
            integrity_warning: None,
        });

        assert_eq!(assessment.policy_decision.as_str(), "deny");
        assert_eq!(
            assessment.block_reason.as_deref(),
            Some("ownership ambiguity")
        );
        assert_eq!(assessment.operator_state, "attention");
        assert_eq!(
            assessment.next_action,
            "resolve file ownership before continuing"
        );
    }

    #[test]
    fn synthetic_process_scan_run_stays_observing_without_blockers() {
        let changed_files = Vec::new();
        let assessment = assess_run_guardrails(&RunGuardrailsInput {
            changed_files: &changed_files,
            touched_files_count: 0,
            unknown_files_count: 0,
            last_tool_name: None,
            status: "idle",
            last_event_name: Some("process-scan"),
            is_unknown_bucket: false,
            is_synthetic_run: true,
            is_service_run: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
            integrity_warning: Some("process detected without hook-backed session"),
        });

        assert_eq!(assessment.policy_decision.as_str(), "allow");
        assert_eq!(assessment.operator_state, "observing");
        assert_eq!(assessment.block_reason, None);
        assert_eq!(
            assessment.next_action,
            "attach hooks or keep observing unmanaged run"
        );
        assert_eq!(evidence_inline_summary(&assessment.evidence), "none");
    }
}
