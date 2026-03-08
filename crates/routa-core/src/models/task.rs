use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "APPROVED" => Some(Self::Approved),
            "NOT_APPROVED" => Some(Self::NotApproved),
            "BLOCKED" => Some(Self::Blocked),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub objective: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_commands: Option<Vec<String>>,
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
    pub fn new(
        id: String,
        title: String,
        objective: String,
        workspace_id: String,
        session_id: Option<String>,
        scope: Option<String>,
        acceptance_criteria: Option<Vec<String>>,
        verification_commands: Option<Vec<String>>,
        dependencies: Option<Vec<String>>,
        parallel_group: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            title,
            objective,
            scope,
            acceptance_criteria,
            verification_commands,
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
            created_at: now,
            updated_at: now,
            completion_summary: None,
            verification_verdict: None,
            verification_report: None,
        }
    }
}
