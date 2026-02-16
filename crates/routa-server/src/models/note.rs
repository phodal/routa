use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::task::TaskStatus;

pub const SPEC_NOTE_ID: &str = "spec";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NoteType {
    Spec,
    Task,
    General,
}

impl NoteType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Spec => "spec",
            Self::Task => "task",
            Self::General => "general",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "spec" => Self::Spec,
            "task" => Self::Task,
            _ => Self::General,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    #[serde(rename = "type")]
    pub note_type: NoteType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_agent_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_note_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<HashMap<String, String>>,
}

impl Default for NoteMetadata {
    fn default() -> Self {
        Self {
            note_type: NoteType::General,
            task_status: None,
            assigned_agent_ids: None,
            parent_note_id: None,
            linked_task_id: None,
            custom: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub workspace_id: String,
    pub metadata: NoteMetadata,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Note {
    pub fn new(
        id: String,
        title: String,
        content: String,
        workspace_id: String,
        metadata: Option<NoteMetadata>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id,
            title,
            content,
            workspace_id,
            metadata: metadata.unwrap_or_default(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_spec(workspace_id: String) -> Self {
        Self::new(
            SPEC_NOTE_ID.to_string(),
            "Spec".to_string(),
            String::new(),
            workspace_id,
            Some(NoteMetadata {
                note_type: NoteType::Spec,
                ..Default::default()
            }),
        )
    }
}
