use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

fn deserialize_explicit_nullable_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(Some(None)),
        serde_json::Value::String(value) => Ok(Some(Some(value))),
        other => Err(serde::de::Error::custom(format!(
            "expected string or null, received {other}"
        ))),
    }
}

/// Task artifact summary for evidence aggregation
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifactSummary {
    pub total: usize,
    pub by_type: BTreeMap<String, usize>,
    pub required_satisfied: bool,
    pub missing_required: Vec<String>,
}

/// Task verification summary
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskVerificationSummary {
    pub has_verdict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    pub has_report: bool,
}

/// Task completion summary
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletionSummary {
    pub has_summary: bool,
}

/// Task run summary
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunSummary {
    pub total: usize,
    pub latest_status: String,
}

/// Combined task evidence summary
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvidenceSummary {
    pub artifact: TaskArtifactSummary,
    pub verification: TaskVerificationSummary,
    pub completion: TaskCompletionSummary,
    pub runs: TaskRunSummary,
}

/// Task run resume target
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunResumeTarget {
    pub r#type: String,
    pub id: String,
}

/// Task run ledger entry
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunLedgerEntry {
    pub id: String,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_target: Option<TaskRunResumeTarget>,
}

/// Request to create a task artifact
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskArtifactRequest {
    pub agent_id: Option<String>,
    #[serde(rename = "type")]
    pub artifact_type: Option<String>,
    pub content: Option<String>,
    pub context: Option<String>,
    pub request_id: Option<String>,
    pub metadata: Option<std::collections::BTreeMap<String, String>>,
}

/// Query params for listing tasks
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksQuery {
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
}

/// Query params for task file change
#[derive(Debug, Deserialize)]
pub struct TaskChangeFileQuery {
    pub path: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "previousPath")]
    pub previous_path: Option<String>,
}

/// Query params for task commit change
#[derive(Debug, Deserialize)]
pub struct TaskChangeCommitQuery {
    pub sha: Option<String>,
}

/// Query params for task change stats
#[derive(Debug, Deserialize)]
pub struct TaskChangeStatsQuery {
    pub paths: Option<String>,
    pub statuses: Option<String>,
}

/// Request to update task status
#[derive(Debug, Deserialize)]
pub struct UpdateStatusRequest {
    pub status: String,
}

/// Request to create a new task
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    pub objective: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub position: Option<i64>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_role: Option<String>,
    pub assigned_specialist_id: Option<String>,
    pub assigned_specialist_name: Option<String>,
    pub create_github_issue: Option<bool>,
    pub repo_path: Option<String>,
    pub codebase_ids: Option<Vec<String>>,
    pub worktree_id: Option<serde_json::Value>,
    pub github_id: Option<String>,
    pub github_number: Option<i64>,
    pub github_url: Option<String>,
    pub github_repo: Option<String>,
    pub github_state: Option<String>,
}

/// Request to update an existing task
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub comment: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub assigned_to: Option<String>,
    pub status: Option<String>,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub position: Option<i64>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_role: Option<String>,
    pub assigned_specialist_id: Option<String>,
    pub assigned_specialist_name: Option<String>,
    pub trigger_session_id: Option<String>,
    pub codebase_ids: Option<Vec<String>>,
    pub verification_plan: Option<String>,
    pub verification_verdict: Option<String>,
    pub github_id: Option<String>,
    pub github_number: Option<i64>,
    pub github_url: Option<String>,
    pub github_repo: Option<String>,
    pub github_state: Option<String>,
    pub last_sync_error: Option<String>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
    pub completion_summary: Option<String>,
    pub verification_report: Option<String>,
    pub sync_to_github: Option<bool>,
    pub retry_trigger: Option<bool>,
    pub repo_path: Option<String>,
    #[serde(default, deserialize_with = "deserialize_explicit_nullable_string")]
    pub worktree_id: Option<Option<String>>,
}
