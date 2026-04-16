use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CanvasType {
    #[serde(rename = "fitness_overview")]
    FitnessOverview,
}

impl CanvasType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FitnessOverview => "fitness_overview",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "fitness_overview" => Some(Self::FitnessOverview),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CanvasRenderMode {
    #[serde(rename = "dynamic")]
    Dynamic,
    #[serde(rename = "prebuilt")]
    Prebuilt,
}

impl CanvasRenderMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Dynamic => "dynamic",
            Self::Prebuilt => "prebuilt",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "dynamic" => Some(Self::Dynamic),
            "prebuilt" => Some(Self::Prebuilt),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasArtifactMetadata {
    pub render_mode: CanvasRenderMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_type: Option<CanvasType>,
    pub title: String,
    pub schema_version: u32,
    pub generated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codebase_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasArtifactPayload {
    pub metadata: CanvasArtifactMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}
