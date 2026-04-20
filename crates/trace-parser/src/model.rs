use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderKey {
    Codex,
    Named(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PromptRole {
    User,
    Assistant,
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolCallStatus {
    Requested,
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileOperationKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileEvidenceKind {
    ApplyPatch,
    GitAdd,
    GitStatus,
    GitDiff,
    Tool,
    Adapter(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSourceRef {
    pub path: Option<PathBuf>,
    pub provider_hint: Option<String>,
}

impl SessionSourceRef {
    pub fn from_path(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            provider_hint: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizedPrompt {
    pub timestamp: Option<String>,
    pub turn_id: Option<String>,
    pub role: PromptRole,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizedToolCall {
    pub timestamp: Option<String>,
    pub turn_id: Option<String>,
    pub tool_name: String,
    pub command_text: Option<String>,
    pub raw_arguments: Option<Value>,
    pub status: ToolCallStatus,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizedFileEvent {
    pub timestamp: Option<String>,
    pub turn_id: Option<String>,
    pub path: String,
    pub operation: FileOperationKind,
    pub evidence: FileEvidenceKind,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizedSession {
    pub session_id: String,
    pub provider: ProviderKey,
    pub started_at: Option<String>,
    pub source: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub prompts: Vec<NormalizedPrompt>,
    pub tool_calls: Vec<NormalizedToolCall>,
    pub file_events: Vec<NormalizedFileEvent>,
    pub metadata: BTreeMap<String, Value>,
}

impl NormalizedSession {
    pub fn new(session_id: String, provider: ProviderKey) -> Self {
        Self {
            session_id,
            provider,
            started_at: None,
            source: None,
            cwd: None,
            model: None,
            prompts: Vec::new(),
            tool_calls: Vec::new(),
            file_events: Vec::new(),
            metadata: BTreeMap::new(),
        }
    }
}
