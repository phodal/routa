use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::artifact::Artifact;

/// Transport protocol for task sessions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskSessionTransport {
    /// Agent Chat Protocol
    Acp,
    /// Agent-to-Agent protocol
    A2a,
}

/// Status of a task lane session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneSessionStatus {
    Running,
    Completed,
    Failed,
    TimedOut,
    Transitioned,
}

/// Loop mode for task lane session recovery
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneSessionLoopMode {
    WatchdogRetry,
    RalphLoop,
}

/// Completion requirement for task lane session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneSessionCompletionRequirement {
    TurnComplete,
    CompletionSummary,
    VerificationReport,
}

/// Recovery reason for task lane session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneSessionRecoveryReason {
    WatchdogInactivity,
    AgentFailed,
    CompletionCriteriaNotMet,
}

/// Session associated with a task lane transition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLaneSession {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routa_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_index: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_name: Option<String>,
    /// Transport protocol used for this session
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    /// A2A-specific: External task ID from the agent system
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_task_id: Option<String>,
    /// A2A-specific: Context ID for tracking the conversation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_mode: Option<TaskLaneSessionLoopMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_requirement: Option<TaskLaneSessionCompletionRequirement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovered_from_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_reason: Option<TaskLaneSessionRecoveryReason>,
    pub status: TaskLaneSessionStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Handoff request type for task lane transitions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneHandoffRequestType {
    EnvironmentPreparation,
    RuntimeContext,
    Clarification,
    RerunCommand,
}

/// Handoff status for task lane transitions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskLaneHandoffStatus {
    Requested,
    Delivered,
    Completed,
    Blocked,
    Failed,
}

/// Handoff between adjacent lane sessions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLaneHandoff {
    pub id: String,
    pub from_session_id: String,
    pub to_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_column_id: Option<String>,
    pub request_type: TaskLaneHandoffRequestType,
    pub request: String,
    pub status: TaskLaneHandoffStatus,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responded_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskPriority {
    #[serde(rename = "low")]
    Low,
    #[serde(rename = "medium")]
    Medium,
    #[serde(rename = "high")]
    High,
    #[serde(rename = "urgent")]
    Urgent,
}

impl TaskPriority {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    #[serde(rename = "PENDING")]
    Pending,
    #[serde(rename = "IN_PROGRESS")]
    InProgress,
    #[serde(rename = "REVIEW_REQUIRED")]
    ReviewRequired,
    #[serde(rename = "COMPLETED")]
    Completed,
    #[serde(rename = "NEEDS_FIX")]
    NeedsFix,
    #[serde(rename = "BLOCKED")]
    Blocked,
    #[serde(rename = "CANCELLED")]
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::InProgress => "IN_PROGRESS",
            Self::ReviewRequired => "REVIEW_REQUIRED",
            Self::Completed => "COMPLETED",
            Self::NeedsFix => "NEEDS_FIX",
            Self::Blocked => "BLOCKED",
            Self::Cancelled => "CANCELLED",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "PENDING" => Some(Self::Pending),
            "IN_PROGRESS" => Some(Self::InProgress),
            "REVIEW_REQUIRED" => Some(Self::ReviewRequired),
            "COMPLETED" => Some(Self::Completed),
            "NEEDS_FIX" => Some(Self::NeedsFix),
            "BLOCKED" => Some(Self::Blocked),
            "CANCELLED" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VerificationVerdict {
    #[serde(rename = "APPROVED")]
    Approved,
    #[serde(rename = "NOT_APPROVED")]
    NotApproved,
    #[serde(rename = "BLOCKED")]
    Blocked,
}

impl VerificationVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Approved => "APPROVED",
            Self::NotApproved => "NOT_APPROVED",
            Self::Blocked => "BLOCKED",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "APPROVED" => Some(Self::Approved),
            "NOT_APPROVED" => Some(Self::NotApproved),
            "BLOCKED" => Some(Self::Blocked),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskAnalysisStatus {
    Pass,
    Warning,
    Fail,
}

impl TaskAnalysisStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Warning => "warning",
            Self::Fail => "fail",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "pass" => Some(Self::Pass),
            "warning" => Some(Self::Warning),
            "fail" => Some(Self::Fail),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskInvestCheckSummary {
    pub status: TaskAnalysisStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskInvestValidationChecks {
    pub independent: TaskInvestCheckSummary,
    pub negotiable: TaskInvestCheckSummary,
    pub valuable: TaskInvestCheckSummary,
    pub estimable: TaskInvestCheckSummary,
    pub small: TaskInvestCheckSummary,
    pub testable: TaskInvestCheckSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskInvestValidation {
    pub source: String,
    pub overall_status: TaskAnalysisStatus,
    pub checks: TaskInvestValidationChecks,
    #[serde(default)]
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskStoryReadinessChecks {
    pub scope: bool,
    pub acceptance_criteria: bool,
    pub verification_commands: bool,
    pub test_cases: bool,
    pub verification_plan: bool,
    pub dependencies_declared: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskStoryReadiness {
    pub ready: bool,
    #[serde(default)]
    pub missing: Vec<String>,
    #[serde(default)]
    pub required_task_fields: Vec<String>,
    pub checks: TaskStoryReadinessChecks,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifactSummary {
    pub total: usize,
    #[serde(default)]
    pub by_type: BTreeMap<String, usize>,
    pub required_satisfied: bool,
    #[serde(default)]
    pub missing_required: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskVerificationSummary {
    pub has_verdict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    pub has_report: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletionSummary {
    pub has_summary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunSummary {
    pub total: usize,
    pub latest_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvidenceSummary {
    pub artifact: TaskArtifactSummary,
    pub verification: TaskVerificationSummary,
    pub completion: TaskCompletionSummary,
    pub runs: TaskRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub objective: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_commands: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_cases: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_to: Option<String>,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    #[serde(default)]
    pub position: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_specialist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_specialist_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_synced_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_error: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_group: Option<String>,
    pub workspace_id: String,
    /// Session ID that created this task (for session-scoped filtering)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Codebase IDs linked to this task
    #[serde(default)]
    pub codebase_ids: Vec<String>,
    /// Worktree ID assigned to this task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    /// All session IDs that have been associated with this task (history)
    #[serde(default)]
    pub session_ids: Vec<String>,
    /// Durable per-lane session history for Kanban workflow handoff
    #[serde(default)]
    pub lane_sessions: Vec<TaskLaneSession>,
    /// Adjacent-lane handoff requests and responses
    #[serde(default)]
    pub lane_handoffs: Vec<TaskLaneHandoff>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_verdict: Option<VerificationVerdict>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_report: Option<String>,
}

impl Task {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        title: String,
        objective: String,
        workspace_id: String,
        session_id: Option<String>,
        scope: Option<String>,
        acceptance_criteria: Option<Vec<String>>,
        verification_commands: Option<Vec<String>>,
        test_cases: Option<Vec<String>>,
        dependencies: Option<Vec<String>>,
        parallel_group: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            title,
            objective,
            comment: None,
            scope,
            acceptance_criteria,
            verification_commands,
            test_cases,
            assigned_to: None,
            status: TaskStatus::Pending,
            board_id: None,
            column_id: Some("backlog".to_string()),
            position: 0,
            priority: None,
            labels: Vec::new(),
            assignee: None,
            assigned_provider: None,
            assigned_role: None,
            assigned_specialist_id: None,
            assigned_specialist_name: None,
            trigger_session_id: None,
            github_id: None,
            github_number: None,
            github_url: None,
            github_repo: None,
            github_state: None,
            github_synced_at: None,
            last_sync_error: None,
            dependencies: dependencies.unwrap_or_default(),
            parallel_group,
            workspace_id,
            session_id,
            codebase_ids: Vec::new(),
            worktree_id: None,
            session_ids: Vec::new(),
            lane_sessions: Vec::new(),
            lane_handoffs: Vec::new(),
            created_at: now,
            updated_at: now,
            completion_summary: None,
            verification_verdict: None,
            verification_report: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct CanonicalStoryEnvelope {
    story: CanonicalStoryDocument,
}

#[derive(Debug, Deserialize)]
struct CanonicalStoryDocument {
    invest: Option<CanonicalStoryInvest>,
    dependencies_and_sequencing: Option<CanonicalStoryDependencies>,
}

#[derive(Debug, Deserialize)]
struct CanonicalStoryInvest {
    independent: Option<CanonicalStoryInvestCheck>,
    negotiable: Option<CanonicalStoryInvestCheck>,
    valuable: Option<CanonicalStoryInvestCheck>,
    estimable: Option<CanonicalStoryInvestCheck>,
    small: Option<CanonicalStoryInvestCheck>,
    testable: Option<CanonicalStoryInvestCheck>,
}

#[derive(Debug, Deserialize)]
struct CanonicalStoryInvestCheck {
    status: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CanonicalStoryDependencies {
    depends_on: Option<Vec<String>>,
    unblock_condition: Option<String>,
}

fn normalize_text(value: Option<&str>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn normalize_items(values: Option<&Vec<String>>) -> Vec<String> {
    values
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn summarize_statuses(statuses: &[TaskAnalysisStatus]) -> TaskAnalysisStatus {
    if statuses.contains(&TaskAnalysisStatus::Fail) {
        TaskAnalysisStatus::Fail
    } else if statuses.contains(&TaskAnalysisStatus::Warning) {
        TaskAnalysisStatus::Warning
    } else {
        TaskAnalysisStatus::Pass
    }
}

fn extract_canonical_story_yaml(content: &str) -> Option<String> {
    let start = content.find("```yaml")?;
    let remainder = &content[start + "```yaml".len()..];
    let end = remainder.find("```")?;
    Some(remainder[..end].trim().to_string())
}

fn parse_canonical_story(content: &str) -> Result<Option<CanonicalStoryEnvelope>, String> {
    let Some(raw_yaml) = extract_canonical_story_yaml(content) else {
        return Ok(None);
    };

    serde_yaml::from_str::<CanonicalStoryEnvelope>(&raw_yaml)
        .map(Some)
        .map_err(|error| format!("Failed to parse canonical story YAML: {error}"))
}

fn contains_dependency_signal(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "depends on",
        "blocked by",
        "dependency plan",
        "execution order",
        "ready now",
        "no dependencies",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub fn build_task_invest_validation(task: &Task) -> TaskInvestValidation {
    let mut issues = Vec::new();
    if let Ok(Some(canonical_story)) = parse_canonical_story(&task.objective) {
        if let Some(invest) = canonical_story.story.invest {
            let build_check =
                |check: Option<CanonicalStoryInvestCheck>| -> Option<TaskInvestCheckSummary> {
                    let check = check?;
                    Some(TaskInvestCheckSummary {
                        status: TaskAnalysisStatus::from_str(
                            check.status.as_deref().unwrap_or_default(),
                        )?,
                        reason: normalize_text(check.reason.as_deref()),
                    })
                };

            if let (
                Some(independent),
                Some(negotiable),
                Some(valuable),
                Some(estimable),
                Some(small),
                Some(testable),
            ) = (
                build_check(invest.independent),
                build_check(invest.negotiable),
                build_check(invest.valuable),
                build_check(invest.estimable),
                build_check(invest.small),
                build_check(invest.testable),
            ) {
                let checks = TaskInvestValidationChecks {
                    independent,
                    negotiable,
                    valuable,
                    estimable,
                    small,
                    testable,
                };
                let statuses = [
                    checks.independent.status.clone(),
                    checks.negotiable.status.clone(),
                    checks.valuable.status.clone(),
                    checks.estimable.status.clone(),
                    checks.small.status.clone(),
                    checks.testable.status.clone(),
                ];
                return TaskInvestValidation {
                    source: "canonical_story".to_string(),
                    overall_status: summarize_statuses(&statuses),
                    checks,
                    issues,
                };
            }

            issues.push("Canonical story YAML is missing one or more INVEST checks.".to_string());
        }
    } else if let Err(error) = parse_canonical_story(&task.objective) {
        issues.push(error);
    }

    let scope = normalize_text(task.scope.as_deref());
    let objective = normalize_text(Some(task.objective.as_str()));
    let comment = normalize_text(task.comment.as_deref());
    let acceptance_criteria = normalize_items(task.acceptance_criteria.as_ref());
    let verification_commands = normalize_items(task.verification_commands.as_ref());
    let test_cases = normalize_items(task.test_cases.as_ref());
    let dependencies = normalize_items(Some(&task.dependencies));
    let dependency_narrative = format!("{objective}\n{comment}");
    let declares_dependencies =
        !dependencies.is_empty() || contains_dependency_signal(&dependency_narrative);
    let has_verification_plan = !verification_commands.is_empty() || !test_cases.is_empty();

    let checks = TaskInvestValidationChecks {
        independent: if !dependencies.is_empty() {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Fail,
                reason: format!(
                    "Depends on {} and should likely be split or explicitly sequenced.",
                    dependencies.join(", ")
                ),
            }
        } else {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Pass,
                reason: if declares_dependencies {
                    "Dependency declaration is present and does not list blocking prerequisites."
                        .to_string()
                } else {
                    "No blocking prerequisite was detected.".to_string()
                },
            }
        },
        negotiable: TaskInvestCheckSummary {
            status: TaskAnalysisStatus::Warning,
            reason:
                "Negotiability is a human judgment call when no canonical story contract is present."
                    .to_string(),
        },
        valuable: if objective.len() >= 24 {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Pass,
                reason: "Objective contains enough detail to express user or delivery value."
                    .to_string(),
            }
        } else {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Fail,
                reason: "Objective is too thin to explain why this story matters.".to_string(),
            }
        },
        estimable: if !scope.is_empty() && !acceptance_criteria.is_empty() {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Pass,
                reason: "Scope and acceptance criteria provide enough context to estimate work."
                    .to_string(),
            }
        } else if !scope.is_empty() || !acceptance_criteria.is_empty() {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Warning,
                reason:
                    "Some sizing context exists, but either scope or acceptance criteria is still missing."
                        .to_string(),
            }
        } else {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Fail,
                reason: "Missing scope and acceptance criteria leaves the story hard to estimate."
                    .to_string(),
            }
        },
        small: if acceptance_criteria.len() >= 6 || dependencies.len() >= 2 {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Warning,
                reason:
                    "The story may be too broad because it carries many acceptance criteria or dependencies."
                        .to_string(),
            }
        } else {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Pass,
                reason: "The story looks narrow enough for a single implementation pass."
                    .to_string(),
            }
        },
        testable: if acceptance_criteria.len() >= 2 || has_verification_plan {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Pass,
                reason:
                    "Acceptance criteria or an explicit verification plan makes the outcome testable."
                        .to_string(),
            }
        } else if acceptance_criteria.len() == 1 {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Warning,
                reason: "A single acceptance criterion exists, but verification is still thin."
                    .to_string(),
            }
        } else {
            TaskInvestCheckSummary {
                status: TaskAnalysisStatus::Fail,
                reason: "No acceptance criteria or verification plan was provided.".to_string(),
            }
        },
    };

    let statuses = [
        checks.independent.status.clone(),
        checks.negotiable.status.clone(),
        checks.valuable.status.clone(),
        checks.estimable.status.clone(),
        checks.small.status.clone(),
        checks.testable.status.clone(),
    ];

    TaskInvestValidation {
        source: "heuristic".to_string(),
        overall_status: summarize_statuses(&statuses),
        checks,
        issues,
    }
}

pub fn build_task_story_readiness_checks(task: &Task) -> TaskStoryReadinessChecks {
    let canonical_dependencies = parse_canonical_story(&task.objective)
        .ok()
        .flatten()
        .and_then(|story| story.story.dependencies_and_sequencing)
        .is_some_and(|dependencies| {
            !normalize_text(dependencies.unblock_condition.as_deref()).is_empty()
                && dependencies.depends_on.is_some()
        });
    let objective = format!(
        "{}\n{}",
        normalize_text(Some(task.objective.as_str())),
        normalize_text(task.comment.as_deref())
    );
    let scope = normalize_text(task.scope.as_deref());
    let acceptance_criteria = normalize_items(task.acceptance_criteria.as_ref());
    let verification_commands = normalize_items(task.verification_commands.as_ref());
    let test_cases = normalize_items(task.test_cases.as_ref());

    TaskStoryReadinessChecks {
        scope: !scope.is_empty(),
        acceptance_criteria: !acceptance_criteria.is_empty(),
        verification_commands: !verification_commands.is_empty(),
        test_cases: !test_cases.is_empty(),
        verification_plan: !verification_commands.is_empty() || !test_cases.is_empty(),
        dependencies_declared: canonical_dependencies
            || !task.dependencies.is_empty()
            || !normalize_text(task.parallel_group.as_deref()).is_empty()
            || contains_dependency_signal(&objective),
    }
}

pub fn build_task_story_readiness(
    task: &Task,
    required_task_fields: &[String],
) -> TaskStoryReadiness {
    let checks = build_task_story_readiness_checks(task);
    let missing = required_task_fields
        .iter()
        .filter(|field| match field.as_str() {
            "scope" => !checks.scope,
            "acceptance_criteria" => !checks.acceptance_criteria,
            "verification_commands" => !checks.verification_commands,
            "test_cases" => !checks.test_cases,
            "verification_plan" => !checks.verification_plan,
            "dependencies_declared" => !checks.dependencies_declared,
            _ => false,
        })
        .cloned()
        .collect::<Vec<_>>();

    TaskStoryReadiness {
        ready: missing.is_empty(),
        missing,
        required_task_fields: required_task_fields.to_vec(),
        checks,
    }
}

pub fn build_task_evidence_summary(
    task: &Task,
    artifacts: &[Artifact],
    required_artifacts: &[String],
) -> TaskEvidenceSummary {
    let mut by_type = BTreeMap::new();
    for artifact in artifacts {
        let key = artifact.artifact_type.as_str().to_string();
        *by_type.entry(key).or_insert(0) += 1;
    }

    let missing_required = required_artifacts
        .iter()
        .filter(|artifact| !by_type.contains_key(*artifact))
        .cloned()
        .collect::<Vec<_>>();
    let latest_status = task
        .lane_sessions
        .last()
        .map(|session| task_lane_session_status_as_str(&session.status).to_string())
        .unwrap_or_else(|| {
            if task.session_ids.is_empty() {
                "idle".to_string()
            } else {
                "unknown".to_string()
            }
        });

    TaskEvidenceSummary {
        artifact: TaskArtifactSummary {
            total: artifacts.len(),
            by_type,
            required_satisfied: missing_required.is_empty(),
            missing_required,
        },
        verification: TaskVerificationSummary {
            has_verdict: task.verification_verdict.is_some(),
            verdict: task
                .verification_verdict
                .as_ref()
                .map(|verdict| verdict.as_str().to_string()),
            has_report: task
                .verification_report
                .as_ref()
                .is_some_and(|report| !report.trim().is_empty()),
        },
        completion: TaskCompletionSummary {
            has_summary: task
                .completion_summary
                .as_ref()
                .is_some_and(|summary| !summary.trim().is_empty()),
        },
        runs: TaskRunSummary {
            total: task.session_ids.len(),
            latest_status,
        },
    }
}

pub fn task_lane_session_status_as_str(status: &TaskLaneSessionStatus) -> &'static str {
    match status {
        TaskLaneSessionStatus::Running => "running",
        TaskLaneSessionStatus::Completed => "completed",
        TaskLaneSessionStatus::Failed => "failed",
        TaskLaneSessionStatus::TimedOut => "timed_out",
        TaskLaneSessionStatus::Transitioned => "transitioned",
    }
}
