use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ArtifactType {
    #[serde(rename = "screenshot")]
    Screenshot,
    #[serde(rename = "test_results")]
    TestResults,
    #[serde(rename = "code_diff")]
    CodeDiff,
    #[serde(rename = "logs")]
    Logs,
    #[serde(rename = "canvas")]
    Canvas,
}

impl ArtifactType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Screenshot => "screenshot",
            Self::TestResults => "test_results",
            Self::CodeDiff => "code_diff",
            Self::Logs => "logs",
            Self::Canvas => "canvas",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "screenshot" => Some(Self::Screenshot),
            "test_results" => Some(Self::TestResults),
            "code_diff" => Some(Self::CodeDiff),
            "logs" => Some(Self::Logs),
            "canvas" => Some(Self::Canvas),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ArtifactStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "provided")]
    Provided,
    #[serde(rename = "expired")]
    Expired,
}

impl ArtifactStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Provided => "provided",
            Self::Expired => "expired",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "provided" => Some(Self::Provided),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    #[serde(rename = "type")]
    pub artifact_type: ArtifactType,
    pub task_id: String,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provided_by_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_by_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    pub status: ArtifactStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
