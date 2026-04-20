//! Trace domain types — mirrors the agent-trace specification.
//!
//! Version: 0.1.0

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Current trace schema version.
pub const TRACE_VERSION: &str = "0.1.0";

/// A single trace record capturing an agent activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecord {
    /// Schema version (e.g., "0.1.0")
    pub version: String,

    /// Unique identifier for this trace
    pub id: String,

    /// ISO 8601 timestamp when the trace was recorded
    pub timestamp: DateTime<Utc>,

    /// Session ID this trace belongs to
    pub session_id: String,

    /// Workspace ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,

    /// The contributor (model/provider) that produced this trace
    pub contributor: Contributor,

    /// Type of trace event
    pub event_type: TraceEventType,

    /// Tool information (if this is a tool call)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<TraceTool>,

    /// Files affected by this trace
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<TraceFile>,

    /// Conversation context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<TraceConversation>,

    /// VCS (Git) context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vcs: Option<TraceVcs>,

    /// Additional metadata
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

/// Type of trace event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TraceEventType {
    /// User sent a prompt
    UserMessage,
    /// Agent produced a message chunk
    AgentMessage,
    /// Agent produced a thought chunk
    AgentThought,
    /// Tool was invoked
    ToolCall,
    /// Tool returned a result
    ToolResult,
    /// Session started
    SessionStart,
    /// Session ended
    SessionEnd,
}

/// The model/provider that produced the trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    /// Provider name (e.g., "claude", "opencode", "codex")
    pub provider: String,

    /// Model identifier (e.g., "claude-sonnet-4-20250514")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Normalized model ID in format "provider/model"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_id: Option<String>,
}

impl Contributor {
    /// Create a new contributor with provider and optional model.
    pub fn new(provider: impl Into<String>, model: Option<String>) -> Self {
        let provider = provider.into();
        let normalized_id = model.as_ref().map(|m| format!("{provider}/{m}"));
        Self {
            provider,
            model,
            normalized_id,
        }
    }
}

/// Tool invocation information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceTool {
    /// Tool name (e.g., "read_file", "write_file", "delegate_task_to_agent")
    pub name: String,

    /// Tool call ID (from the agent)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,

    /// Tool status ("running", "completed", "failed")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,

    /// Raw input parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,

    /// Raw output (for tool results)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
}

/// A file affected by the agent action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFile {
    /// Relative file path from workspace root
    pub path: String,

    /// Affected ranges within the file
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ranges: Vec<TraceRange>,

    /// Operation type (read, write, delete, create)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,

    /// Content hash after operation (for attribution)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
}

/// A range within a file (line/column based).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRange {
    /// Start line (1-based)
    pub start_line: u32,

    /// End line (1-based, inclusive)
    pub end_line: u32,

    /// Start column (1-based, optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,

    /// End column (1-based, optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
}

/// Conversation context for the trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceConversation {
    /// Turn number in the conversation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn: Option<u32>,

    /// Message role (user, assistant, tool)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,

    /// Message content (truncated for storage)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_preview: Option<String>,

    /// Full content (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_content: Option<String>,
}

/// VCS (Git) context for the trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceVcs {
    /// Current Git revision (commit SHA)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,

    /// Current Git branch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,

    /// Repository root path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_root: Option<String>,
}

// ─── Builder Pattern ────────────────────────────────────────────────────

impl TraceRecord {
    /// Create a new trace record with required fields.
    pub fn new(
        session_id: impl Into<String>,
        event_type: TraceEventType,
        contributor: Contributor,
    ) -> Self {
        Self {
            version: TRACE_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            session_id: session_id.into(),
            workspace_id: None,
            contributor,
            event_type,
            tool: None,
            files: Vec::new(),
            conversation: None,
            vcs: None,
            metadata: serde_json::Map::new(),
        }
    }

    /// Set the workspace ID.
    pub fn with_workspace_id(mut self, workspace_id: impl Into<String>) -> Self {
        self.workspace_id = Some(workspace_id.into());
        self
    }

    /// Set tool information.
    pub fn with_tool(mut self, tool: TraceTool) -> Self {
        self.tool = Some(tool);
        self
    }

    /// Add a file to the trace.
    pub fn with_file(mut self, file: TraceFile) -> Self {
        self.files.push(file);
        self
    }

    /// Set conversation context.
    pub fn with_conversation(mut self, conversation: TraceConversation) -> Self {
        self.conversation = Some(conversation);
        self
    }

    /// Set VCS context.
    pub fn with_vcs(mut self, vcs: TraceVcs) -> Self {
        self.vcs = Some(vcs);
        self
    }

    /// Add metadata.
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }
}
