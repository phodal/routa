use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_group: Option<String>,
    pub workspace_id: String,
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
            dependencies: dependencies.unwrap_or_default(),
            parallel_group,
            workspace_id,
            created_at: now,
            updated_at: now,
            completion_summary: None,
            verification_verdict: None,
            verification_report: None,
        }
    }
}
