//! Claude Code process management using stream-json protocol.
//!
//! Claude Code uses a different wire format from ACP:
//!   - stdin/stdout: JSON lines (NDJSON) with Claude-specific message types
//!   - Message types: system, assistant, user, result, stream_event
//!
//! This process translates Claude's output into ACP-compatible `session/update`
//! notifications so the existing renderer works without changes.
//! Agent message notifications are traced to JSONL files for attribution tracking.

use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use regex::Regex;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot, Mutex};

#[cfg(windows)]
use super::CREATE_NO_WINDOW;
use crate::trace::{Contributor, TraceConversation, TraceEventType, TraceRecord, TraceWriter};

// ─── Claude Protocol Types ──────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct ClaudeStreamDelta {
    #[serde(rename = "type", default)]
    delta_type: String,
    text: Option<String>,
    thinking: Option<String>,
    #[allow(dead_code)]
    partial_json: Option<String>,
    // For message_delta events
    stop_reason: Option<String>,
    #[allow(dead_code)]
    stop_sequence: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeStreamContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[allow(dead_code)]
    text: Option<String>,
    #[allow(dead_code)]
    thinking: Option<String>,
    id: Option<String>,
    name: Option<String>,
    #[allow(dead_code)]
    input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeStreamEvent {
    #[serde(rename = "type", default)]
    event_type: String,
    #[allow(dead_code)]
    index: Option<i32>,
    content_block: Option<ClaudeStreamContentBlock>,
    delta: Option<ClaudeStreamDelta>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
    #[allow(dead_code)]
    thinking: Option<String>,
    id: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
    tool_use_id: Option<String>,
    content: Option<serde_json::Value>,
    is_error: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeMessage {
    #[allow(dead_code)]
    role: String,
    content: Vec<ClaudeContent>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeOutputMessage {
    #[serde(rename = "type")]
    msg_type: String,
    subtype: Option<String>,
    session_id: Option<String>,
    message: Option<ClaudeMessage>,
    event: Option<ClaudeStreamEvent>,
    result: Option<String>,
    #[allow(dead_code)]
    is_error: Option<bool>,
}

// ─── Config ─────────────────────────────────────────────────────────────

/// Configuration for spawning a Claude Code process.
#[derive(Debug, Clone)]
pub struct ClaudeCodeConfig {
    /// Command to run (usually "claude")
    pub command: String,
    /// Working directory
    pub cwd: String,
    /// Display name for logging
    pub display_name: String,
    /// Permission mode: "acceptEdits" | "bypassPermissions"
    pub permission_mode: Option<String>,
    /// MCP config JSON strings
    pub mcp_configs: Vec<String>,
    /// Optional specialist/system prompt appended to Claude's default prompt.
    pub append_system_prompt: Option<String>,
    /// Optional allowlist for Claude built-in tools. Empty disables all built-ins.
    pub allowed_tools: Option<Vec<String>>,
}

impl Default for ClaudeCodeConfig {
    fn default() -> Self {
        Self {
            command: "claude".to_string(),
            cwd: ".".to_string(),
            display_name: "Claude Code".to_string(),
            permission_mode: Some("bypassPermissions".to_string()),
            mcp_configs: Vec::new(),
            append_system_prompt: None,
            allowed_tools: None,
        }
    }
}

// ─── Process State ──────────────────────────────────────────────────────

#[derive(Default)]
struct ProcessState {
    tool_use_names: HashMap<String, String>,
    tool_use_inputs: HashMap<String, serde_json::Value>,
    rendered_tool_ids: HashSet<String>,
    in_thinking: bool,
    in_text: bool,
    has_rendered_stream_content: bool,
}

/// Claude Code process manager.
pub struct ClaudeCodeProcess {
    config: ClaudeCodeConfig,
    session_id: Arc<Mutex<Option<String>>>,
    alive: Arc<AtomicBool>,
    notification_tx: broadcast::Sender<serde_json::Value>,
    state: Arc<Mutex<ProcessState>>,
    stdin_tx: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    prompt_complete_tx: Arc<Mutex<Option<oneshot::Sender<String>>>>,
}

impl ClaudeCodeProcess {
    /// Create a new Claude Code process manager.
    pub fn new(
        config: ClaudeCodeConfig,
        notification_tx: broadcast::Sender<serde_json::Value>,
    ) -> Self {
        Self {
            config,
            session_id: Arc::new(Mutex::new(None)),
            alive: Arc::new(AtomicBool::new(false)),
            notification_tx,
            state: Arc::new(Mutex::new(ProcessState::default())),
            stdin_tx: Arc::new(Mutex::new(None)),
            prompt_complete_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Get the session ID.
    pub async fn session_id(&self) -> Option<String> {
        self.session_id.lock().await.clone()
    }

    /// Whether the process is alive.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Spawn the Claude Code process.
    pub async fn spawn(
        config: ClaudeCodeConfig,
        notification_tx: broadcast::Sender<serde_json::Value>,
    ) -> Result<Self, String> {
        let process = Self::new(config, notification_tx);
        process.start().await?;
        Ok(process)
    }

    /// Start the Claude Code process with stream-json mode.
    async fn start(&self) -> Result<(), String> {
        // Resolve the actual binary path using the full shell PATH
        // (macOS GUI apps have a minimal PATH that won't find user CLI tools)
        let resolved_command = crate::shell_env::which(&self.config.command)
            .unwrap_or_else(|| self.config.command.clone());

        let mut cmd = Command::new(&resolved_command);
        cmd.arg("-p");
        cmd.args(["--output-format", "stream-json"]);
        cmd.args(["--input-format", "stream-json"]);
        cmd.arg("--include-partial-messages");
        cmd.arg("--verbose");

        // Permission mode
        let permission_mode = self
            .config
            .permission_mode
            .as_deref()
            .unwrap_or("bypassPermissions");
        if permission_mode == "bypassPermissions" {
            cmd.arg("--dangerously-skip-permissions");
        } else {
            cmd.args(["--permission-mode", permission_mode]);
        }

        if let Some(prompt) = &self.config.append_system_prompt {
            if !prompt.trim().is_empty() {
                cmd.args(["--append-system-prompt", prompt]);
            }
        }

        if let Some(allowed_tools) = &self.config.allowed_tools {
            let tools_arg = if allowed_tools.is_empty() {
                String::new()
            } else {
                allowed_tools.join(",")
            };
            cmd.args(["--tools", &tools_arg]);
        }

        // Disallow interactive questions
        cmd.args(["--disallowed-tools", "AskUserQuestion"]);

        // Add MCP configs
        for mcp_config in &self.config.mcp_configs {
            cmd.args(["--mcp-config", mcp_config]);
        }

        cmd.current_dir(&self.config.cwd);
        cmd.env("PATH", crate::shell_env::full_path());
        cmd.env("NODE_NO_READLINE", "1");
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(windows)]
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);

        tracing::info!(
            "[ClaudeCode:{}] Spawning: {} -p --output-format stream-json ... (cwd: {})",
            self.config.display_name,
            resolved_command,
            self.config.cwd
        );

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn Claude Code - is '{}' installed? Error: {}. Resolved path: '{}'",
                self.config.command, e, resolved_command
            )
        })?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

        *self.stdin_tx.lock().await = Some(stdin);
        self.alive.store(true, Ordering::SeqCst);

        // Spawn stdout reader
        let session_id = self.session_id.clone();
        let alive = self.alive.clone();
        let notification_tx = self.notification_tx.clone();
        let state = self.state.clone();
        let prompt_complete_tx = self.prompt_complete_tx.clone();
        let display_name = self.config.display_name.clone();
        let cwd_clone = self.config.cwd.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            // Buffer for accumulating agent message text for tracing
            let mut agent_msg_buffer = String::new();

            while let Ok(Some(line)) = lines.next_line().await {
                let line = clear_ansi(line.trim());
                if line.is_empty() || line.starts_with("[DEBUG]") || line.starts_with("[ERROR]") {
                    continue;
                }
                if !line.starts_with('{') {
                    continue;
                }

                match serde_json::from_str::<ClaudeOutputMessage>(&line) {
                    Ok(msg) => {
                        // ── Trace: capture agent message text ──────────────
                        // Capture from assistant message content
                        if let Some(ref message) = msg.message {
                            for item in &message.content {
                                if item.content_type == "text" {
                                    if let Some(ref text) = item.text {
                                        agent_msg_buffer.push_str(text);
                                    }
                                }
                            }
                        }
                        // Capture from stream_event text_delta
                        if msg.msg_type == "stream_event" {
                            if let Some(ref event) = msg.event {
                                if event.event_type == "content_block_delta" {
                                    if let Some(ref delta) = event.delta {
                                        if delta.delta_type == "text_delta" {
                                            if let Some(ref text) = delta.text {
                                                agent_msg_buffer.push_str(text);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        // Trace when buffer reaches 100+ chars (captures meaningful segments)
                        if agent_msg_buffer.len() >= 100 {
                            if let Some(sid) = session_id.lock().await.clone() {
                                let record = TraceRecord::new(
                                    sid,
                                    TraceEventType::AgentMessage,
                                    Contributor::new("claude", None),
                                )
                                .with_conversation(
                                    TraceConversation {
                                        turn: None,
                                        role: Some("assistant".to_string()),
                                        content_preview: Some(
                                            agent_msg_buffer[..agent_msg_buffer.len().min(200)]
                                                .to_string(),
                                        ),
                                        full_content: Some(agent_msg_buffer.clone()),
                                    },
                                );
                                let writer = TraceWriter::new(&cwd_clone);
                                let _ = writer.append_safe(&record).await;
                            }
                            agent_msg_buffer.clear();
                        }

                        handle_claude_message(
                            msg,
                            &session_id,
                            &notification_tx,
                            &state,
                            &prompt_complete_tx,
                        )
                        .await;
                    }
                    Err(e) => {
                        tracing::debug!(
                            "[ClaudeCode:{}] Failed to parse: {} - {}",
                            display_name,
                            e,
                            &line[..line.len().min(100)]
                        );
                    }
                }
            }

            // Flush any remaining buffered agent message content
            if !agent_msg_buffer.is_empty() {
                if let Some(sid) = session_id.lock().await.clone() {
                    let record = TraceRecord::new(
                        sid,
                        TraceEventType::AgentMessage,
                        Contributor::new("claude", None),
                    )
                    .with_conversation(TraceConversation {
                        turn: None,
                        role: Some("assistant".to_string()),
                        content_preview: Some(
                            agent_msg_buffer[..agent_msg_buffer.len().min(200)].to_string(),
                        ),
                        full_content: Some(agent_msg_buffer.clone()),
                    });
                    let writer = TraceWriter::new(&cwd_clone);
                    let _ = writer.append_safe(&record).await;
                }
            }

            alive.store(false, Ordering::SeqCst);
            tracing::info!("[ClaudeCode:{}] stdout reader exited", display_name);
        });

        // Spawn stderr reader
        let display_name2 = self.config.display_name.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    tracing::warn!("[ClaudeCode:{} stderr] {}", display_name2, line);
                }
            }
        });

        // Wait for process to stabilize
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        if !self.is_alive() {
            return Err("Claude Code process died during startup".to_string());
        }

        tracing::info!("[ClaudeCode:{}] Process started", self.config.display_name);
        Ok(())
    }

    /// Send a prompt to Claude Code.
    pub async fn prompt(&self, text: &str) -> Result<String, String> {
        if !self.is_alive() {
            return Err("Claude Code process is not alive".to_string());
        }

        // Reset streaming state
        {
            let mut state = self.state.lock().await;
            state.in_thinking = false;
            state.in_text = false;
            state.has_rendered_stream_content = false;
        }

        let session_id = self.session_id.lock().await.clone();
        let user_input = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{ "type": "text", "text": text }]
            },
            "session_id": session_id
        });

        let (tx, rx) = oneshot::channel();
        *self.prompt_complete_tx.lock().await = Some(tx);

        // Write to stdin
        let mut stdin_guard = self.stdin_tx.lock().await;
        if let Some(ref mut stdin) = *stdin_guard {
            let msg = format!("{user_input}\n");
            stdin
                .write_all(msg.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to stdin: {e}"))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush stdin: {e}"))?;
        } else {
            return Err("stdin not available".to_string());
        }

        // Wait for result
        match rx.await {
            Ok(stop_reason) => Ok(stop_reason),
            Err(_) => Err("Prompt was cancelled or process exited".to_string()),
        }
    }

    /// Cancel the current prompt.
    pub async fn cancel(&self) {
        // Claude Code doesn't have a cancel protocol - just drop the completion channel
        let _ = self.prompt_complete_tx.lock().await.take();
    }

    /// Kill the process.
    pub async fn kill(&self) {
        self.alive.store(false, Ordering::SeqCst);
        // Drop stdin to signal EOF
        let _ = self.stdin_tx.lock().await.take();
    }
}

// ─── Message Handling ───────────────────────────────────────────────────

async fn handle_claude_message(
    msg: ClaudeOutputMessage,
    session_id: &Arc<Mutex<Option<String>>>,
    notification_tx: &broadcast::Sender<serde_json::Value>,
    state: &Arc<Mutex<ProcessState>>,
    prompt_complete_tx: &Arc<Mutex<Option<oneshot::Sender<String>>>>,
) {
    let sid = session_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "claude-session".to_string());

    match msg.msg_type.as_str() {
        "system" => {
            if msg.subtype.as_deref() == Some("init") {
                if let Some(new_session_id) = msg.session_id {
                    *session_id.lock().await = Some(new_session_id);
                }
            }
        }

        "stream_event" => {
            if let Some(event) = msg.event {
                process_stream_event(event, &sid, notification_tx, state).await;
            }
        }

        "assistant" => {
            if let Some(message) = msg.message {
                let mut state_guard = state.lock().await;
                for c in message.content {
                    if c.content_type == "tool_use" {
                        let tool_id = c.id.clone().unwrap_or_default();
                        let tool_name = c.name.clone().unwrap_or_else(|| "unknown".to_string());
                        state_guard
                            .tool_use_names
                            .insert(tool_id.clone(), tool_name.clone());

                        if let Some(input) = c.input.clone() {
                            state_guard
                                .tool_use_inputs
                                .insert(tool_id.clone(), input.clone());
                        }

                        if !state_guard.rendered_tool_ids.contains(&tool_id) {
                            let mapped_name = map_claude_tool_name(&tool_name);
                            let input = c.input.clone().unwrap_or(serde_json::json!({}));
                            emit_session_update(
                                notification_tx,
                                &sid,
                                serde_json::json!({
                                    "sessionUpdate": "tool_call",
                                    "toolCallId": tool_id,
                                    "title": format_tool_title(&tool_name, &input),
                                    "status": "running",
                                    "kind": mapped_name,
                                    "rawInput": input
                                }),
                            );
                            state_guard.rendered_tool_ids.insert(tool_id);
                        }
                    }
                }
            }
        }

        "user" => {
            if let Some(message) = msg.message {
                let state_guard = state.lock().await;
                for c in message.content {
                    if c.content_type == "tool_result" {
                        let tool_id = c.tool_use_id.clone().unwrap_or_default();
                        let tool_name = state_guard
                            .tool_use_names
                            .get(&tool_id)
                            .cloned()
                            .unwrap_or_else(|| "unknown".to_string());
                        let is_error = c.is_error.unwrap_or(false);
                        let output = extract_tool_result_text(&c);
                        let mapped_kind = map_claude_tool_name(&tool_name);

                        let status = if is_error { "failed" } else { "completed" };

                        emit_session_update(
                            notification_tx,
                            &sid,
                            serde_json::json!({
                                "sessionUpdate": "tool_call_update",
                                "toolCallId": tool_id,
                                "title": tool_name,
                                "status": status,
                                "kind": mapped_kind,
                                "rawOutput": output
                            }),
                        );
                    }
                }
            }
        }

        "result" => {
            let result_text = msg.result.clone().unwrap_or_default();
            let has_rendered = state.lock().await.has_rendered_stream_content;

            if !result_text.is_empty() && !has_rendered {
                emit_session_update(
                    notification_tx,
                    &sid,
                    serde_json::json!({
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "text", "text": result_text }
                    }),
                );
            }

            // Signal completion
            if let Some(tx) = prompt_complete_tx.lock().await.take() {
                let stop_reason = msg.subtype.unwrap_or_else(|| "end_turn".to_string());
                let _ = tx.send(stop_reason);
            }
        }

        _ => {}
    }
}

async fn process_stream_event(
    event: ClaudeStreamEvent,
    sid: &str,
    notification_tx: &broadcast::Sender<serde_json::Value>,
    state: &Arc<Mutex<ProcessState>>,
) {
    match event.event_type.as_str() {
        "content_block_start" => {
            if let Some(block) = event.content_block {
                let mut state_guard = state.lock().await;
                match block.block_type.as_str() {
                    "thinking" => state_guard.in_thinking = true,
                    "text" => state_guard.in_text = true,
                    "tool_use" => {
                        if let (Some(id), Some(name)) = (block.id, block.name) {
                            state_guard.tool_use_names.insert(id, name);
                        }
                    }
                    _ => {}
                }
            }
        }

        "content_block_delta" => {
            if let Some(delta) = event.delta {
                let mut state_guard = state.lock().await;
                match delta.delta_type.as_str() {
                    "thinking_delta" => {
                        if let Some(thinking) = delta.thinking {
                            state_guard.has_rendered_stream_content = true;
                            emit_session_update(
                                notification_tx,
                                sid,
                                serde_json::json!({
                                    "sessionUpdate": "agent_thought_chunk",
                                    "content": { "type": "text", "text": thinking }
                                }),
                            );
                        }
                    }
                    "text_delta" => {
                        if let Some(text) = delta.text {
                            state_guard.has_rendered_stream_content = true;
                            state_guard.in_thinking = false;
                            emit_session_update(
                                notification_tx,
                                sid,
                                serde_json::json!({
                                    "sessionUpdate": "agent_message_chunk",
                                    "content": { "type": "text", "text": text }
                                }),
                            );
                        }
                    }
                    "input_json_delta" => {
                        state_guard.has_rendered_stream_content = true;
                    }
                    _ => {}
                }
            }
        }

        "content_block_stop" => {
            let mut state_guard = state.lock().await;
            state_guard.in_thinking = false;
            state_guard.in_text = false;
        }

        "message_delta" => {
            // message_delta events indicate the message is complete
            // We can optionally emit a completion notification here
            if let Some(delta) = event.delta {
                if delta.stop_reason.is_some() {
                    tracing::debug!(
                        "[ClaudeCode] Message delta with stop_reason: {:?}",
                        delta.stop_reason
                    );
                }
            }
        }

        "" => {
            // Empty event_type likely means this is a message_delta event
            // Check if delta has stop_reason
            if let Some(delta) = event.delta {
                if delta.stop_reason.is_some() {
                    tracing::debug!(
                        "[ClaudeCode] Message completed with stop_reason: {:?}",
                        delta.stop_reason
                    );
                }
            }
        }

        _ => {}
    }
}

// ─── Helper Functions ───────────────────────────────────────────────────

fn emit_session_update(
    tx: &broadcast::Sender<serde_json::Value>,
    session_id: &str,
    update: serde_json::Value,
) {
    let notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": update
        }
    });
    let _ = tx.send(notification);
}

fn clear_ansi(text: &str) -> String {
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    re.replace_all(text, "").to_string()
}

fn map_claude_tool_name(claude_tool_name: &str) -> String {
    // Handle MCP tool names: mcp__server-name__tool_name -> tool_name
    if claude_tool_name.starts_with("mcp__") {
        let parts: Vec<&str> = claude_tool_name.split("__").collect();
        if parts.len() >= 3 {
            let tool_name = parts[2..].join("__");
            if tool_name == "delegate_task_to_agent" {
                return "task".to_string();
            }
            return tool_name;
        }
    }

    match claude_tool_name {
        "Bash" => "shell".to_string(),
        "Read" => "read-file".to_string(),
        "Write" => "write-file".to_string(),
        "Edit" => "edit-file".to_string(),
        "Glob" => "glob".to_string(),
        "Grep" => "grep".to_string(),
        "WebSearch" => "web-search".to_string(),
        "WebFetch" => "web-fetch".to_string(),
        "Task" => "task".to_string(),
        _ => claude_tool_name.to_string(),
    }
}

fn format_tool_title(tool_name: &str, params: &serde_json::Value) -> String {
    let mut display_name = tool_name.to_string();
    if tool_name.starts_with("mcp__") {
        let parts: Vec<&str> = tool_name.split("__").collect();
        if parts.len() >= 3 {
            display_name = parts[2..].join("__");
        }
    }

    match display_name.as_str() {
        "Read" | "Write" | "Edit" => {
            let path = params
                .get("file_path")
                .or_else(|| params.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("{display_name}: {path}")
        }
        "Bash" => {
            let cmd = params.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let truncated: String = cmd.chars().take(80).collect();
            format!("Bash: {truncated}")
        }
        "Task" => {
            let desc = params
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let sub_type = params
                .get("subagent_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !desc.is_empty() {
                if !sub_type.is_empty() {
                    format!("Task [{sub_type}]: {desc}")
                } else {
                    format!("Task: {desc}")
                }
            } else {
                "Task".to_string()
            }
        }
        _ => display_name,
    }
}

fn extract_tool_result_text(content: &ClaudeContent) -> String {
    match &content.content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
        None => String::new(),
    }
}
