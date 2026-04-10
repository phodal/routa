use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy)]
pub enum AttributionConfidence {
    Exact,
    Inferred,
    Unknown,
}

impl AttributionConfidence {
    pub fn as_str(self) -> &'static str {
        match self {
            AttributionConfidence::Exact => "exact",
            AttributionConfidence::Inferred => "inferred",
            AttributionConfidence::Unknown => "unknown",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "exact" => AttributionConfidence::Exact,
            "inferred" => AttributionConfidence::Inferred,
            _ => AttributionConfidence::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum HookClient {
    Codex,
    Claude,
    Unknown,
}

impl HookClient {
    pub fn from_str(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "codex" => HookClient::Codex,
            "claude" => HookClient::Claude,
            _ => HookClient::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            HookClient::Codex => "codex",
            HookClient::Claude => "claude",
            HookClient::Unknown => "unknown",
        }
    }
}

impl RuntimeMessage {
    pub fn observed_at_ms(&self) -> i64 {
        match self {
            RuntimeMessage::Hook(event) => event.observed_at_ms,
            RuntimeMessage::Git(event) => event.observed_at_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub session_id: String,
    pub repo_root: String,
    pub client: String,
    pub cwd: String,
    pub model: Option<String>,
    pub started_at_ms: i64,
    pub last_seen_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub status: String,
    pub tmux_session: Option<String>,
    pub tmux_window: Option<String>,
    pub tmux_pane: Option<String>,
    pub metadata_json: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct FileEventRecord {
    pub id: Option<i64>,
    pub repo_root: String,
    pub rel_path: String,
    pub event_kind: String,
    pub observed_at_ms: i64,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub confidence: AttributionConfidence,
    pub source: String,
    pub metadata_json: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct FileStateRow {
    pub rel_path: String,
    pub is_dirty: bool,
    pub state_code: String,
    pub mtime_ms: Option<i64>,
    pub size_bytes: Option<i64>,
    pub last_seen_ms: i64,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub confidence: Option<String>,
    pub source: Option<String>,
}

pub const DEFAULT_INFERENCE_WINDOW_MS: i64 = 15 * 60 * 1000;
pub const DEFAULT_TUI_POLL_MS: u64 = 800;
pub const EVENT_LOG_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuntimeMessage {
    Hook(HookEvent),
    Git(GitEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEvent {
    pub repo_root: String,
    pub observed_at_ms: i64,
    pub client: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub cwd: String,
    pub model: Option<String>,
    pub event_name: String,
    pub tool_name: Option<String>,
    pub tool_command: Option<String>,
    pub file_paths: Vec<String>,
    pub tmux_session: Option<String>,
    pub tmux_window: Option<String>,
    pub tmux_pane: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitEvent {
    pub repo_root: String,
    pub observed_at_ms: i64,
    pub event_name: String,
    pub args: Vec<String>,
    pub head_commit: Option<String>,
    pub branch: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionView {
    pub session_id: String,
    pub cwd: String,
    pub model: Option<String>,
    pub client: String,
    pub started_at_ms: i64,
    pub last_seen_at_ms: i64,
    pub status: String,
    pub tmux_pane: Option<String>,
    pub touched_files: BTreeSet<String>,
    pub last_turn_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FileView {
    pub rel_path: String,
    pub dirty: bool,
    pub state_code: String,
    pub last_modified_at_ms: i64,
    pub last_session_id: Option<String>,
    pub confidence: AttributionConfidence,
    pub conflicted: bool,
    pub touched_by: BTreeSet<String>,
    pub recent_events: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct EventLogEntry {
    pub observed_at_ms: i64,
    pub source: EventSource,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventSource {
    Hook,
    Git,
    Watch,
}

impl EventSource {
    pub fn label(self) -> &'static str {
        match self {
            EventSource::Hook => "hook",
            EventSource::Git => "git",
            EventSource::Watch => "watch",
        }
    }
}
