use crate::evaluate::gates::{
    assess_run_guardrails, EvidenceRequirementStatus, RunGuardrailsInput,
};
use crate::run::policy::{EffectClass, PolicyDecisionKind};
use crate::run::run::{Role, RunMode};
use crate::run::workspace::WorkspaceState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceType {
    Main,
    Linked,
    External,
}

impl WorkspaceType {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            WorkspaceType::Main => "main",
            WorkspaceType::Linked => "linked",
            WorkspaceType::External => "external",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunOrigin {
    HookBacked,
    ProcessScan,
    AttributionReview,
    McpService,
}

impl RunOrigin {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RunOrigin::HookBacked => "hook-backed",
            RunOrigin::ProcessScan => "process-scan",
            RunOrigin::AttributionReview => "attribution-review",
            RunOrigin::McpService => "mcp-service",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SemanticPlane {
    Observe,
    Attribute,
    Evaluate,
    Orchestrate,
    Constrain,
    Validate,
    Evidence,
    Contextualize,
    Operate,
    Reflect,
}

impl SemanticPlane {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SemanticPlane::Observe => "observe",
            SemanticPlane::Attribute => "attribute",
            SemanticPlane::Evaluate => "evaluate",
            SemanticPlane::Orchestrate => "orchestrate",
            SemanticPlane::Constrain => "constrain",
            SemanticPlane::Validate => "validate",
            SemanticPlane::Evidence => "evidence",
            SemanticPlane::Contextualize => "contextualize",
            SemanticPlane::Operate => "operate",
            SemanticPlane::Reflect => "reflect",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlaneStatus {
    Active,
    Ready,
    Attention,
    Blocked,
    Missing,
    Roadmap,
}

impl PlaneStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            PlaneStatus::Active => "active",
            PlaneStatus::Ready => "ready",
            PlaneStatus::Attention => "attention",
            PlaneStatus::Blocked => "blocked",
            PlaneStatus::Missing => "missing",
            PlaneStatus::Roadmap => "roadmap",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PlaneAssessment {
    pub(crate) plane: SemanticPlane,
    pub(crate) status: PlaneStatus,
    #[allow(dead_code)]
    pub(crate) summary: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RunAssessmentInput<'a> {
    pub(crate) run_id: &'a str,
    pub(crate) display_name: &'a str,
    pub(crate) client: &'a str,
    pub(crate) status: &'a str,
    pub(crate) last_event_name: Option<&'a str>,
    pub(crate) last_tool_name: Option<&'a str>,
    pub(crate) changed_files: &'a [String],
    pub(crate) touched_files_count: usize,
    pub(crate) exact_files_count: usize,
    pub(crate) inferred_files_count: usize,
    pub(crate) unknown_files_count: usize,
    pub(crate) is_unknown_bucket: bool,
    pub(crate) is_synthetic_run: bool,
    pub(crate) is_service_run: bool,
    pub(crate) workspace_path: &'a str,
    pub(crate) workspace_branch: Option<&'a str>,
    pub(crate) workspace_type: WorkspaceType,
    pub(crate) workspace_detached: bool,
    pub(crate) workspace_missing: bool,
    pub(crate) has_eval: bool,
    pub(crate) hard_gate_blocked: bool,
    pub(crate) score_blocked: bool,
    pub(crate) has_coverage: bool,
    pub(crate) api_contract_passed: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct RunAssessment {
    pub(crate) role: Role,
    pub(crate) mode: RunMode,
    pub(crate) origin: RunOrigin,
    pub(crate) operator_state: String,
    pub(crate) workspace_state: WorkspaceState,
    pub(crate) effect_classes: Vec<EffectClass>,
    pub(crate) policy_decision: PolicyDecisionKind,
    pub(crate) approval_label: String,
    pub(crate) block_reason: Option<String>,
    pub(crate) integrity_warning: Option<String>,
    pub(crate) next_action: String,
    pub(crate) handoff_summary: Option<String>,
    pub(crate) recovery_hints: Vec<String>,
    pub(crate) evidence: Vec<EvidenceRequirementStatus>,
    pub(crate) planes: Vec<PlaneAssessment>,
}

pub(crate) fn assess_run(input: &RunAssessmentInput<'_>) -> RunAssessment {
    let role = infer_role(input);
    let mode = RunMode::Unmanaged;
    let origin = infer_origin(input);
    let integrity_warning = infer_integrity_warning(input, origin);
    let workspace_state = infer_workspace_state(input);
    let guardrails = assess_run_guardrails(&RunGuardrailsInput {
        changed_files: input.changed_files,
        touched_files_count: input.touched_files_count,
        unknown_files_count: input.unknown_files_count,
        last_tool_name: input.last_tool_name,
        status: input.status,
        last_event_name: input.last_event_name,
        is_unknown_bucket: input.is_unknown_bucket,
        is_synthetic_run: input.is_synthetic_run,
        is_service_run: input.is_service_run,
        has_eval: input.has_eval,
        hard_gate_blocked: input.hard_gate_blocked,
        score_blocked: input.score_blocked,
        has_coverage: input.has_coverage,
        api_contract_passed: input.api_contract_passed,
        integrity_warning: integrity_warning.as_deref(),
    });
    let recovery_hints =
        infer_recovery_hints(input, &workspace_state, integrity_warning.as_deref());
    let handoff_summary = infer_handoff_summary(
        &role,
        guardrails.operator_state.as_str(),
        guardrails.block_reason.as_deref(),
        input,
    );
    let planes = build_planes(
        input,
        origin,
        workspace_state.clone(),
        &guardrails,
        integrity_warning.as_deref(),
    );

    RunAssessment {
        role,
        mode,
        origin,
        operator_state: guardrails.operator_state,
        workspace_state,
        effect_classes: guardrails.effect_classes,
        policy_decision: guardrails.policy_decision,
        approval_label: guardrails.approval_label,
        block_reason: guardrails.block_reason,
        integrity_warning,
        next_action: guardrails.next_action,
        handoff_summary,
        recovery_hints,
        evidence: guardrails.evidence,
        planes,
    }
}

pub(crate) fn summarize_planes(planes: &[PlaneAssessment]) -> String {
    planes
        .iter()
        .filter(|plane| plane.status != PlaneStatus::Roadmap)
        .map(|plane| format!("{}:{}", plane.plane.as_str(), plane.status.as_str()))
        .collect::<Vec<_>>()
        .join(", ")
}

fn infer_role(input: &RunAssessmentInput<'_>) -> Role {
    let mut haystack = input.display_name.to_ascii_lowercase();
    haystack.push(' ');
    haystack.push_str(&input.run_id.to_ascii_lowercase());
    haystack.push(' ');
    haystack.push_str(&input.client.to_ascii_lowercase());
    haystack.push(' ');
    haystack.push_str(&input.status.to_ascii_lowercase());
    if let Some(event) = input.last_event_name {
        haystack.push(' ');
        haystack.push_str(&event.to_ascii_lowercase());
    }

    if haystack.contains("planner") || haystack.contains("plan") {
        Role::Planner
    } else if haystack.contains("review") || haystack.contains("test") {
        Role::Reviewer
    } else if haystack.contains("fix") {
        Role::Fixer
    } else if haystack.contains("release") {
        Role::Release
    } else if haystack.contains("care") || haystack.contains("cleanup") {
        Role::Caretaker
    } else {
        Role::Builder
    }
}

fn infer_origin(input: &RunAssessmentInput<'_>) -> RunOrigin {
    if input.is_unknown_bucket {
        RunOrigin::AttributionReview
    } else if input.is_service_run {
        RunOrigin::McpService
    } else if input.is_synthetic_run {
        RunOrigin::ProcessScan
    } else {
        RunOrigin::HookBacked
    }
}

fn infer_integrity_warning(input: &RunAssessmentInput<'_>, origin: RunOrigin) -> Option<String> {
    if input.workspace_missing {
        Some("workspace path missing".to_string())
    } else if input.is_unknown_bucket {
        Some(format!(
            "{} dirty file(s) need ownership review",
            input.unknown_files_count.max(input.changed_files.len())
        ))
    } else if origin == RunOrigin::McpService {
        Some("workspace MCP service".to_string())
    } else if origin == RunOrigin::ProcessScan {
        Some("process detected without hook-backed session".to_string())
    } else if input.unknown_files_count > 0 {
        Some(format!(
            "{} file(s) lack confident attribution",
            input.unknown_files_count
        ))
    } else if input.workspace_detached {
        Some("workspace is on detached HEAD".to_string())
    } else {
        None
    }
}

fn infer_workspace_state(input: &RunAssessmentInput<'_>) -> WorkspaceState {
    if input.workspace_missing {
        WorkspaceState::Corrupted
    } else if !input.changed_files.is_empty()
        || input.touched_files_count > 0
        || input.is_unknown_bucket
        || input.unknown_files_count > 0
    {
        WorkspaceState::Dirty
    } else if input.has_eval && !input.hard_gate_blocked && !input.score_blocked {
        WorkspaceState::Validated
    } else {
        WorkspaceState::Ready
    }
}

fn infer_handoff_summary(
    role: &Role,
    operator_state: &str,
    block_reason: Option<&str>,
    input: &RunAssessmentInput<'_>,
) -> Option<String> {
    let next_role = if block_reason.is_some_and(|reason| {
        reason.contains("hard gate")
            || reason.contains("score")
            || reason.contains("ownership")
            || reason.contains("workspace")
    }) {
        Some(Role::Fixer)
    } else if matches!(operator_state, "evaluating" | "ready") {
        Some(Role::Reviewer)
    } else if matches!(role, Role::Planner) && operator_state == "executing" {
        Some(Role::Builder)
    } else {
        None
    }?;

    if next_role == *role {
        return None;
    }

    let mut parts = vec![format!(
        "handoff {} -> {}",
        role.as_str(),
        next_role.as_str()
    )];
    if input.workspace_detached {
        parts.push("(detached HEAD)".to_string());
    } else if let Some(branch) = input.workspace_branch {
        parts.push(format!("on {branch}"));
    }
    if input.workspace_type != WorkspaceType::Main {
        parts.push(format!("[{}]", input.workspace_type.as_str()));
    }
    Some(parts.join(" "))
}

fn infer_recovery_hints(
    input: &RunAssessmentInput<'_>,
    workspace_state: &WorkspaceState,
    integrity_warning: Option<&str>,
) -> Vec<String> {
    let mut hints = Vec::new();
    if input.workspace_missing {
        hints.push("repair or recreate the worktree path".to_string());
    }
    if input.workspace_detached {
        hints.push("reattach to a branch or validate before continuing".to_string());
    }
    if input.hard_gate_blocked {
        hints.push("fix hard-gate failures then re-run entrix fast".to_string());
    }
    if input.score_blocked {
        hints.push("improve fitness score above threshold".to_string());
    }
    if input.is_unknown_bucket {
        hints.push("assign ownership for unattributed files".to_string());
    } else if input.unknown_files_count > 0 {
        hints.push(format!(
            "review attribution for {} file(s)",
            input.unknown_files_count
        ));
    }
    if matches!(workspace_state, WorkspaceState::Dirty)
        && integrity_warning.is_none()
        && !input.has_eval
    {
        hints.push("run evaluation before handoff".to_string());
    }
    hints
}

fn build_planes(
    input: &RunAssessmentInput<'_>,
    origin: RunOrigin,
    workspace_state: WorkspaceState,
    guardrails: &crate::evaluate::gates::RunGuardrailsAssessment,
    integrity_warning: Option<&str>,
) -> Vec<PlaneAssessment> {
    let has_repo_changes = !input.changed_files.is_empty()
        || input.touched_files_count > 0
        || input.unknown_files_count > 0
        || input.is_unknown_bucket;
    let has_missing_required_evidence = guardrails
        .evidence
        .iter()
        .any(|item| item.requirement.required && !item.satisfied);

    vec![
        PlaneAssessment {
            plane: SemanticPlane::Observe,
            status: match origin {
                RunOrigin::AttributionReview => PlaneStatus::Attention,
                _ => PlaneStatus::Active,
            },
            summary: match origin {
                RunOrigin::HookBacked => "hook-backed session observed".to_string(),
                RunOrigin::ProcessScan => "process-scan fallback run observed".to_string(),
                RunOrigin::AttributionReview => {
                    "dirty files grouped into attribution review bucket".to_string()
                }
                RunOrigin::McpService => "MCP service observed as shared run surface".to_string(),
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Attribute,
            status: if input.is_unknown_bucket || input.unknown_files_count > 0 {
                PlaneStatus::Attention
            } else if input.exact_files_count > 0 {
                PlaneStatus::Ready
            } else if input.inferred_files_count > 0 {
                PlaneStatus::Active
            } else {
                PlaneStatus::Ready
            },
            summary: if input.is_unknown_bucket || input.unknown_files_count > 0 {
                format!(
                    "{} file(s) need attribution review",
                    input.unknown_files_count
                )
            } else if input.exact_files_count > 0 {
                format!("{} exact file attribution(s)", input.exact_files_count)
            } else if input.inferred_files_count > 0 {
                format!(
                    "{} inferred file attribution(s)",
                    input.inferred_files_count
                )
            } else {
                "no repo-local file attribution yet".to_string()
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Evaluate,
            status: if input.hard_gate_blocked || input.score_blocked {
                PlaneStatus::Blocked
            } else if input.has_eval {
                PlaneStatus::Ready
            } else if has_repo_changes {
                PlaneStatus::Missing
            } else {
                PlaneStatus::Active
            },
            summary: if input.hard_gate_blocked {
                "hard-gate evaluation failure".to_string()
            } else if input.score_blocked {
                "fitness score below threshold".to_string()
            } else if input.has_eval {
                "run-scoped evaluation evidence attached".to_string()
            } else if has_repo_changes {
                "evaluation evidence still missing".to_string()
            } else {
                "no evaluation required yet".to_string()
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Orchestrate,
            status: if input.workspace_missing {
                PlaneStatus::Blocked
            } else if (integrity_warning.is_some() && input.workspace_detached)
                || input.is_unknown_bucket
            {
                PlaneStatus::Attention
            } else {
                PlaneStatus::Active
            },
            summary: if input.workspace_missing {
                format!("workspace path missing: {}", input.workspace_path)
            } else {
                let branch_label = input.workspace_branch.unwrap_or("-");
                format!(
                    "{} {} on {} [{}]",
                    input.workspace_type.as_str(),
                    workspace_state.as_str(),
                    branch_label,
                    input.workspace_path,
                )
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Constrain,
            status: match guardrails.policy_decision {
                PolicyDecisionKind::Deny => PlaneStatus::Blocked,
                PolicyDecisionKind::RequireApproval => PlaneStatus::Attention,
                PolicyDecisionKind::AllowWithEvidence => PlaneStatus::Active,
                PolicyDecisionKind::Allow | PolicyDecisionKind::DryRunOnly => PlaneStatus::Ready,
            },
            summary: format!(
                "policy={} effects={}",
                guardrails.policy_decision.as_str(),
                guardrails
                    .effect_classes
                    .iter()
                    .map(EffectClass::as_str)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        },
        PlaneAssessment {
            plane: SemanticPlane::Validate,
            status: if input.hard_gate_blocked || input.score_blocked {
                PlaneStatus::Blocked
            } else if has_missing_required_evidence {
                PlaneStatus::Missing
            } else if input.has_eval {
                PlaneStatus::Ready
            } else if has_repo_changes {
                PlaneStatus::Missing
            } else {
                PlaneStatus::Ready
            },
            summary: if input.hard_gate_blocked {
                "validation blocked by hard gate".to_string()
            } else if input.score_blocked {
                "validation blocked by score gate".to_string()
            } else if has_missing_required_evidence {
                "required verification evidence still missing".to_string()
            } else if input.has_eval {
                "verification snapshot available".to_string()
            } else {
                "no explicit validation backlog".to_string()
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Evidence,
            status: if has_missing_required_evidence {
                PlaneStatus::Missing
            } else {
                PlaneStatus::Ready
            },
            summary: if has_missing_required_evidence {
                guardrails
                    .evidence
                    .iter()
                    .find(|item| item.requirement.required && !item.satisfied)
                    .map(|item| format!("missing {}", item.requirement.kind.as_str()))
                    .unwrap_or_else(|| "required evidence missing".to_string())
            } else if guardrails.evidence.is_empty() {
                "no evidence obligations yet".to_string()
            } else {
                format!("{} evidence item(s) satisfied", guardrails.evidence.len())
            },
        },
        PlaneAssessment {
            plane: SemanticPlane::Contextualize,
            status: PlaneStatus::Roadmap,
            summary: "context-pack assembly remains a roadmap plane".to_string(),
        },
        PlaneAssessment {
            plane: SemanticPlane::Operate,
            status: PlaneStatus::Roadmap,
            summary: "PR/merge/deploy flow remains outside Phase 1".to_string(),
        },
        PlaneAssessment {
            plane: SemanticPlane::Reflect,
            status: PlaneStatus::Roadmap,
            summary: "runtime learning loop remains outside Phase 1".to_string(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_process_scan_run_maps_to_operator_planes() {
        let changed_files = Vec::new();
        let assessment = assess_run(&RunAssessmentInput {
            run_id: "agent:codex:42",
            display_name: "Codex#42",
            client: "codex",
            status: "idle",
            last_event_name: Some("process-scan"),
            last_tool_name: None,
            changed_files: &changed_files,
            touched_files_count: 0,
            exact_files_count: 0,
            inferred_files_count: 0,
            unknown_files_count: 0,
            is_unknown_bucket: false,
            is_synthetic_run: true,
            is_service_run: false,
            workspace_path: "/repo",
            workspace_branch: None,
            workspace_type: WorkspaceType::Main,
            workspace_detached: false,
            workspace_missing: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
        });

        assert_eq!(assessment.origin.as_str(), "process-scan");
        assert_eq!(assessment.operator_state, "observing");
        assert_eq!(assessment.role.as_str(), "builder");
        assert_eq!(assessment.mode.as_str(), "unmanaged");
        assert_eq!(assessment.planes[0].plane.as_str(), "observe");
        assert_eq!(assessment.planes[0].status.as_str(), "active");
        assert!(assessment.recovery_hints.is_empty());
        assert!(assessment
            .planes
            .iter()
            .any(|plane| plane.plane == SemanticPlane::Contextualize
                && plane.status == PlaneStatus::Roadmap));
    }

    #[test]
    fn ownership_ambiguity_surfaces_attribute_attention() {
        let changed_files = vec!["src/lib.rs".to_string()];
        let assessment = assess_run(&RunAssessmentInput {
            run_id: "unknown",
            display_name: "Unknown / review",
            client: "unknown",
            status: "unknown",
            last_event_name: Some("review"),
            last_tool_name: None,
            changed_files: &changed_files,
            touched_files_count: 1,
            exact_files_count: 0,
            inferred_files_count: 0,
            unknown_files_count: 1,
            is_unknown_bucket: true,
            is_synthetic_run: false,
            is_service_run: false,
            workspace_path: "/repo",
            workspace_branch: None,
            workspace_type: WorkspaceType::Main,
            workspace_detached: false,
            workspace_missing: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
        });

        assert_eq!(assessment.origin.as_str(), "attribution-review");
        assert_eq!(
            assessment.block_reason.as_deref(),
            Some("ownership ambiguity")
        );
        assert_eq!(assessment.operator_state, "attention");
        assert_eq!(
            assessment.recovery_hints,
            vec!["assign ownership for unattributed files"]
        );
        assert!(assessment
            .planes
            .iter()
            .any(|plane| plane.plane == SemanticPlane::Attribute
                && plane.status == PlaneStatus::Attention));
        assert!(assessment
            .planes
            .iter()
            .any(|plane| plane.plane == SemanticPlane::Constrain
                && plane.status == PlaneStatus::Blocked));
    }
}
