use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageRole {
    #[serde(rename = "SYSTEM")]
    System,
    #[serde(rename = "USER")]
    User,
    #[serde(rename = "ASSISTANT")]
    Assistant,
    #[serde(rename = "TOOL")]
    Tool,
}

impl MessageRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "SYSTEM",
            Self::User => "USER",
            Self::Assistant => "ASSISTANT",
            Self::Tool => "TOOL",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "SYSTEM" => Some(Self::System),
            "USER" => Some(Self::User),
            "ASSISTANT" => Some(Self::Assistant),
            "TOOL" => Some(Self::Tool),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub agent_id: String,
    pub role: MessageRole,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn: Option<i32>,
}

impl Message {
    pub fn new(
        id: String,
        agent_id: String,
        role: MessageRole,
        content: String,
        tool_name: Option<String>,
        tool_args: Option<String>,
        turn: Option<i32>,
    ) -> Self {
        Self {
            id,
            agent_id,
            role,
            content,
            timestamp: Utc::now(),
            tool_name,
            tool_args,
            turn,
        }
    }
}
