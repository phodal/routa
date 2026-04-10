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
