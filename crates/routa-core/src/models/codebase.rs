use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodebaseSourceType {
    Local,
    Github,
}

impl CodebaseSourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Github => "github",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "local" => Some(Self::Local),
            "github" => Some(Self::Github),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Codebase {
    pub id: String,
    pub workspace_id: String,
    pub repo_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<CodebaseSourceType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Codebase {
    pub fn new(
        id: String,
        workspace_id: String,
        repo_path: String,
        branch: Option<String>,
        label: Option<String>,
        is_default: bool,
        source_type: Option<CodebaseSourceType>,
        source_url: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            workspace_id,
            repo_path,
            branch,
            label,
            is_default,
            source_type,
            source_url,
            created_at: now,
            updated_at: now,
        }
    }
}
