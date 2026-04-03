use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
pub enum InvestValidationStatus {
    #[serde(rename = "pass")]
    Pass,
    #[serde(rename = "fail")]
    Fail,
    #[serde(rename = "warning")]
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestValidation {
    pub independent: InvestValidationPrinciple,
    pub negotiable: InvestValidationPrinciple,
    pub valuable: InvestValidationPrinciple,
    pub estimable: InvestValidationPrinciple,
    pub small: InvestValidationPrinciple,
    pub testable: InvestValidationPrinciple,
    pub overall: InvestValidationStatus,
    pub validated_at: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestValidationPrinciple {
    pub status: InvestValidationStatus,
    pub reason: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invest_validation: Option<InvestValidation>,
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
            invest_validation: None,
        }
    }
}
