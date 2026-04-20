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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Directory,
    Submodule,
}

pub type DirtyRepoEntry = (String, String, Option<i64>, EntryKind);

impl EntryKind {
    pub fn is_directory(self) -> bool {
        matches!(self, EntryKind::Directory)
    }

    pub fn is_submodule(self) -> bool {
        matches!(self, EntryKind::Submodule)
    }

    pub fn is_container(self) -> bool {
        matches!(self, EntryKind::Directory | EntryKind::Submodule)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum HookClient {
    Codex,
    Claude,
    Cursor,
    Aider,
    Gemini,
    Copilot,
    Qoder,
    Auggie,
    Kiro,
    Unknown,
}

impl HookClient {
    pub fn from_str(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "codex" => HookClient::Codex,
            "claude" => HookClient::Claude,
            "cursor" => HookClient::Cursor,
            "aider" => HookClient::Aider,
            "gemini" => HookClient::Gemini,
            "copilot" => HookClient::Copilot,
            "qoder" | "qodercli" => HookClient::Qoder,
            "auggie" => HookClient::Auggie,
            "kiro" => HookClient::Kiro,
            _ => HookClient::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            HookClient::Codex => "codex",
            HookClient::Claude => "claude",
            HookClient::Cursor => "cursor",
            HookClient::Aider => "aider",
            HookClient::Gemini => "gemini",
            HookClient::Copilot => "copilot",
            HookClient::Qoder => "qoder",
            HookClient::Auggie => "auggie",
            HookClient::Kiro => "kiro",
            HookClient::Unknown => "unknown",
        }
    }

    /// Display icon for TUI usage.
    pub fn icon(self) -> &'static str {
        match self {
            HookClient::Codex => "◈",
            HookClient::Claude => "◆",
            HookClient::Cursor => "⌘",
            HookClient::Aider => "⚡",
            HookClient::Gemini => "✦",
            HookClient::Copilot => "⬡",
            HookClient::Qoder => "◌",
            HookClient::Auggie => "▣",
            HookClient::Kiro => "◉",
            HookClient::Unknown => "?",
        }
    }
}

impl RuntimeMessage {
    pub fn observed_at_ms(&self) -> i64 {
        match self {
            RuntimeMessage::Hook(event) => event.observed_at_ms,
            RuntimeMessage::Git(event) => event.observed_at_ms,
            RuntimeMessage::Attribution(event) => event.observed_at_ms,
            RuntimeMessage::Fitness(event) => event.observed_at_ms,
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
    pub task_id: Option<String>,
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
    pub task_id: Option<String>,
    pub confidence: Option<String>,
    pub source: Option<String>,
}

pub const DEFAULT_INFERENCE_WINDOW_MS: i64 = 15 * 60 * 1000;
pub const DEFAULT_TUI_POLL_MS: u64 = 300;
pub const EVENT_LOG_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum RuntimeMessage {
    Hook(HookEvent),
    Git(GitEvent),
    Attribution(AttributionEvent),
    Fitness(FitnessEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEvent {
    pub repo_root: String,
    pub observed_at_ms: i64,
    #[serde(default)]
    pub status: Option<String>,
    pub client: String,
    pub session_id: String,
    pub session_display_name: Option<String>,
    pub turn_id: Option<String>,
    pub cwd: String,
    pub model: Option<String>,
    pub transcript_path: Option<String>,
    pub session_source: Option<String>,
    pub event_name: String,
    pub tool_name: Option<String>,
    pub tool_command: Option<String>,
    pub file_paths: Vec<String>,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub prompt_preview: Option<String>,
    #[serde(default)]
    pub recovered_from_transcript: bool,
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
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub recovered_from_transcript: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributionEvent {
    pub repo_root: String,
    pub observed_at_ms: i64,
    pub rel_path: String,
    pub session_id: String,
    pub confidence: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskView {
    pub task_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub title: String,
    pub objective: String,
    pub prompt_preview: Option<String>,
    pub transcript_path: Option<String>,
    pub recovered_from_transcript: bool,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitnessEvent {
    pub repo_root: String,
    pub observed_at_ms: i64,
    pub mode: String,
    pub status: String,
    pub final_score: Option<f64>,
    pub hard_gate_blocked: Option<bool>,
    pub score_blocked: Option<bool>,
    pub duration_ms: Option<f64>,
    pub dimension_count: Option<usize>,
    pub metric_count: Option<usize>,
    #[serde(default)]
    pub artifact_path: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionView {
    pub session_id: String,
    pub display_name: Option<String>,
    pub cwd: String,
    pub model: Option<String>,
    pub client: String,
    pub transcript_path: Option<String>,
    pub source: Option<String>,
    pub started_at_ms: i64,
    pub last_seen_at_ms: i64,
    pub status: String,
    pub tmux_pane: Option<String>,
    pub touched_files: BTreeSet<String>,
    pub last_turn_id: Option<String>,
    pub last_event_name: Option<String>,
    pub last_tool_name: Option<String>,
    pub active_task_id: Option<String>,
    pub active_task_title: Option<String>,
    pub last_prompt_preview: Option<String>,
    pub active_task_recovered_from_transcript: bool,
    pub recent_git_activity: Vec<String>,
}

impl SessionView {
    /// Map this session to an unmanaged domain Run (Architecture §9.1).
    #[allow(dead_code)]
    pub fn as_unmanaged_run(&self) -> crate::run::run::Run {
        use crate::run::run::{Role, Run, RunMode, RunState};
        use crate::shared::ids::RunId;

        let state = match self.status.as_str() {
            "active" => RunState::Executing,
            "stopped" | "ended" => RunState::Succeeded,
            _ => RunState::Created,
        };
        Run {
            id: RunId(self.session_id.clone()),
            task_id: self.active_task_id.clone().map(Into::into),
            role: Role::Builder,
            mode: RunMode::Unmanaged,
            state,
            workspace_id: None,
            model: self.model.clone(),
            tool_scope: Vec::new(),
            effect_budget: crate::run::run::EffectBudget::default(),
            started_at_ms: self.started_at_ms,
            ended_at_ms: if self.status == "active" {
                None
            } else {
                Some(self.last_seen_at_ms)
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileView {
    pub rel_path: String,
    pub dirty: bool,
    pub state_code: String,
    pub entry_kind: EntryKind,
    pub last_modified_at_ms: i64,
    pub last_session_id: Option<String>,
    pub last_task_id: Option<String>,
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
    Attribution,
    Fitness,
}

impl EventSource {
    pub fn label(self) -> &'static str {
        match self {
            EventSource::Hook => "hook",
            EventSource::Git => "git",
            EventSource::Watch => "watch",
            EventSource::Attribution => "attrib",
            EventSource::Fitness => "fitness",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeServiceInfo {
    pub pid: u32,
    pub transport: String,
    pub started_at_ms: i64,
    pub last_seen_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct DetectedAgent {
    pub key: String,
    pub name: String,
    pub vendor: String,
    #[allow(dead_code)]
    pub icon: String,
    pub pid: u32,
    pub cwd: Option<String>,
    pub cpu_percent: f32,
    pub mem_mb: f32,
    pub uptime_seconds: u64,
    pub status: String,
    #[allow(dead_code)]
    pub confidence: u8,
    pub project: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentStats {
    pub total: usize,
    pub active: usize,
    pub idle: usize,
    pub total_cpu: f32,
    pub total_mem_mb: f32,
    pub by_vendor: std::collections::HashMap<String, usize>,
}
