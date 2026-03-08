use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub codebase_id: String,
    pub workspace_id: String,
    pub worktree_path: String,
    pub branch: String,
    pub base_branch: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Worktree {
    pub fn new(
        id: String,
        codebase_id: String,
        workspace_id: String,
        worktree_path: String,
        branch: String,
        base_branch: String,
        label: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            codebase_id,
            workspace_id,
            worktree_path,
            branch,
            base_branch,
            status: "creating".to_string(),
            session_id: None,
            label,
            error_message: None,
            created_at: now,
            updated_at: now,
        }
    }
}
