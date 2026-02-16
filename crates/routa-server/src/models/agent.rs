use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentRole {
    #[serde(rename = "ROUTA")]
    Routa,
    #[serde(rename = "CRAFTER")]
    Crafter,
    #[serde(rename = "GATE")]
    Gate,
    #[serde(rename = "DEVELOPER")]
    Developer,
}

impl AgentRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Routa => "ROUTA",
            Self::Crafter => "CRAFTER",
            Self::Gate => "GATE",
            Self::Developer => "DEVELOPER",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "ROUTA" => Some(Self::Routa),
            "CRAFTER" => Some(Self::Crafter),
            "GATE" => Some(Self::Gate),
            "DEVELOPER" => Some(Self::Developer),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ModelTier {
    #[serde(rename = "SMART")]
    Smart,
    #[serde(rename = "BALANCED")]
    Balanced,
    #[serde(rename = "FAST")]
    Fast,
}

impl ModelTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Smart => "SMART",
            Self::Balanced => "BALANCED",
            Self::Fast => "FAST",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "SMART" => Some(Self::Smart),
            "BALANCED" => Some(Self::Balanced),
            "FAST" => Some(Self::Fast),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    #[serde(rename = "PENDING")]
    Pending,
    #[serde(rename = "ACTIVE")]
    Active,
    #[serde(rename = "COMPLETED")]
    Completed,
    #[serde(rename = "ERROR")]
    Error,
    #[serde(rename = "CANCELLED")]
    Cancelled,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Active => "ACTIVE",
            Self::Completed => "COMPLETED",
            Self::Error => "ERROR",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "PENDING" => Some(Self::Pending),
            "ACTIVE" => Some(Self::Active),
            "COMPLETED" => Some(Self::Completed),
            "ERROR" => Some(Self::Error),
            "CANCELLED" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: AgentRole,
    pub model_tier: ModelTier,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub status: AgentStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

impl Agent {
    pub fn new(
        id: String,
        name: String,
        role: AgentRole,
        workspace_id: String,
        parent_id: Option<String>,
        model_tier: Option<ModelTier>,
        metadata: Option<HashMap<String, String>>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            name,
            role,
            model_tier: model_tier.unwrap_or(ModelTier::Smart),
            workspace_id,
            parent_id,
            status: AgentStatus::Pending,
            created_at: now,
            updated_at: now,
            metadata: metadata.unwrap_or_default(),
        }
    }
}
