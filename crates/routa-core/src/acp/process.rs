//! AcpProcess — manages a single ACP agent child process with JSON-RPC over stdio.
//!
//! The lifecycle mirrors the Next.js `AcpProcess` class:
//!   1. `spawn(command, args)` — start the child, launch a background stdout reader
//!   2. `initialize()`         — send "initialize" request, wait for response
//!   3. `new_session(cwd)`     — send "session/new", get back sessionId
//!   4. `prompt(sid, text)`    — send "session/prompt" (5-min timeout), stream via SSE
//!   5. `kill()`               — terminate the process
//!
//! Agent→client requests (permissions, fs, terminal) are handled in the background reader.
//! Agent message notifications are traced to JSONL files for attribution tracking.

use std::collections::HashMap;
use std::io::ErrorKind;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, oneshot, Mutex};

use super::terminal_manager::TerminalManager;
#[cfg(windows)]
use super::CREATE_NO_WINDOW;
use crate::trace::{
    Contributor, TraceConversation, TraceEventType, TraceRecord, TraceTool, TraceWriter,
};

/// Callback type for session/update notifications from the agent.
pub type NotificationSender = broadcast::Sender<serde_json::Value>;

/// Type alias for the pending request map to avoid complex type repetition.
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>>;

/// A managed ACP agent child process.
pub struct AcpProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Option<Child>>>,
    pending: PendingMap,
    next_id: Arc<AtomicU64>,
    alive: Arc<AtomicBool>,
    notification_tx: NotificationSender,
    display_name: String,
    /// The command used to spawn this process (e.g., "npx", "uvx", "opencode")
    command: String,
    _reader_handle: tokio::task::JoinHandle<()>,
}

impl AcpProcess {
    /// Spawn the agent process and start the background reader.
    ///
    /// `our_session_id` is used to rewrite the agent's session ID in notifications
    /// so the frontend SSE stream matches on the correct session.
    pub async fn spawn(
        command: &str,
        args: &[&str],
        cwd: &str,
        notification_tx: NotificationSender,
        display_name: &str,
        our_session_id: &str,
    ) -> Result<Self, String> {
        tracing::info!(
            "[AcpProcess:{}] Spawning: {} {} (cwd: {})",
            display_name,
            command,
            args.join(" "),
            cwd,
        );

        let cwd_path = Path::new(cwd);
        if !cwd_path.exists() {
            return Err(format!(
                "Invalid session cwd '{cwd}': directory does not exist"
            ));
        }
        if !cwd_path.is_dir() {
            return Err(format!(
                "Invalid session cwd '{cwd}': path is not a directory"
            ));
        }

        // Resolve the actual binary path using the full shell PATH
        // (macOS GUI apps have a minimal PATH that won't find user CLI tools)
        let resolved_command =
            crate::shell_env::which(command).unwrap_or_else(|| command.to_string());

        let mut command_builder = tokio::process::Command::new(&resolved_command);
        command_builder
            .args(args)
            .current_dir(cwd)
            .env("PATH", crate::shell_env::full_path())
            .env("NODE_NO_READLINE", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        command_builder
            .as_std_mut()
            .creation_flags(CREATE_NO_WINDOW);

        // codex-acp often returns only stopReason in session/prompt result.
        // Enabling lightweight codex logs gives us process_output lines that
        // include assistant deltas, which the CLI can aggregate as final output.
        if resolved_command.ends_with("codex-acp") && std::env::var_os("RUST_LOG").is_none() {
            command_builder.env(
                "RUST_LOG",
                "info,codex_acp::thread=info,codex_acp::codex_agent=info",
            );
        }

        let mut child = command_builder.spawn().map_err(|e| match e.kind() {
            ErrorKind::NotFound => {
                let resolved_exists = Path::new(&resolved_command).exists();
                if resolved_exists {
                    format!(
                        "Failed to execute '{command}' (resolved: '{resolved_command}'): {e}. The binary exists, but a required interpreter or wrapper target may be missing."
                    )
                } else {
                    format!(
                        "Failed to spawn '{command}' (resolved: '{resolved_command}'): {e}. Is it installed and in PATH?"
                    )
                }
            }
            _ => format!(
                "Failed to spawn '{command}' (resolved: '{resolved_command}') from cwd '{cwd}': {e}"
            ),
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "No stdin on child process".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "No stdout on child process".to_string())?;
        let stderr = child.stderr.take();

        let alive = Arc::new(AtomicBool::new(true));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let stdin = Arc::new(Mutex::new(stdin));

        let name = display_name.to_string();

        // Log stderr in background and forward to frontend as process_output
        if let Some(stderr) = stderr {
            let name_clone = name.clone();
            let ntx_stderr = notification_tx.clone();
            let our_sid_stderr = our_session_id.to_string();
            let resolved_command_stderr = resolved_command.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        if should_ignore_process_stderr(
                            &resolved_command_stderr,
                            &name_clone,
                            &line,
                        ) {
                            continue;
                        }
                        tracing::debug!("[AcpProcess:{} stderr] {}", name_clone, line);
                        // Forward stderr to frontend as process_output notification
                        let notification = serde_json::json!({
                            "jsonrpc": "2.0",
                            "method": "session/update",
                            "params": {
                                "sessionId": our_sid_stderr,
                                "update": {
                                    "sessionUpdate": "process_output",
                                    "source": "stderr",
                                    "data": format!("{}\n", line),
                                    "displayName": name_clone,
                                }
                            }
                        });
                        let _ = ntx_stderr.send(notification);
                    }
                }
            });
        }

        // Background stdout reader — dispatches responses, notifications, agent requests
        let alive_clone = alive.clone();
        let pending_clone = pending.clone();
        let ntx = notification_tx.clone();
        let stdin_clone = stdin.clone();
        let name_clone = name.clone();
        let our_sid = our_session_id.to_string();
        let cwd_clone = cwd.to_string();
        let provider_clone = display_name.to_string();

        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            // Buffer for accumulating agent message chunks
            let mut agent_msg_buffer = String::new();
            // Buffer for accumulating agent thought chunks
            let mut agent_thought_buffer = String::new();
            // Buffer for pending tool calls awaiting rawInput (OpenCode sends empty rawInput initially)
            let mut pending_tool_calls: std::collections::HashMap<String, (String, bool)> =
                std::collections::HashMap::new();

            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }

                let msg: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        // Try to find embedded JSON objects
                        if let Some(v) = try_parse_embedded_json(&line) {
                            v
                        } else {
                            tracing::debug!(
                                "[AcpProcess:{}] Non-JSON stdout: {}",
                                name_clone,
                                truncate_content(&line, 200)
                            );
                            continue;
                        }
                    }
                };

                let has_id = msg.get("id").is_some() && !msg.get("id").unwrap().is_null();
                let has_result = msg.get("result").is_some();
                let has_error = msg.get("error").is_some();
                let has_method = msg.get("method").and_then(|m| m.as_str()).is_some();

                if has_id && (has_result || has_error) {
                    // Response to a pending request
                    let id = msg["id"].as_u64().unwrap_or(0);
                    let mut map = pending_clone.lock().await;
                    if let Some(tx) = map.remove(&id) {
                        if has_error {
                            let err_msg =
                                msg["error"]["message"].as_str().unwrap_or("unknown error");
                            let err_code = msg["error"]["code"].as_i64().unwrap_or(0);
                            let _ = tx.send(Err(format!("ACP Error [{err_code}]: {err_msg}")));
                        } else {
                            let _ = tx.send(Ok(msg["result"].clone()));
                        }
                    }
                } else if has_id && has_method {
                    // Agent→Client request — handle it
                    let method = msg["method"].as_str().unwrap_or("");
                    let id_val = msg["id"].clone();
                    tracing::info!(
                        "[AcpProcess:{}] Agent request: {} (id={})",
                        name_clone,
                        method,
                        id_val
                    );
                    let response =
                        handle_agent_request(method, &msg["params"], &our_sid, &ntx).await;
                    let reply = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id_val,
                        "result": response,
                    });
                    let data = format!("{}\n", serde_json::to_string(&reply).unwrap());
                    let mut stdin = stdin_clone.lock().await;
                    let _ = stdin.write_all(data.as_bytes()).await;
                    let _ = stdin.flush().await;
                } else if has_method {
                    // Notification (no id) — forward to SSE
                    // Rewrite the agent's sessionId to our session ID so the
                    // frontend SSE stream can match on the correct session.
                    let mut rewritten = msg.clone();
                    if let Some(params) = rewritten.get_mut("params") {
                        if params.get("sessionId").is_some() {
                            params["sessionId"] = serde_json::Value::String(our_sid.clone());
                        }
                    }

                    // ── Trace: various event types ─────────────────────────────
                    if let Some(params) = msg.get("params") {
                        if let Some(update) = params.get("update") {
                            let session_update = update
                                .get("sessionUpdate")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");

                            match session_update {
                                "agent_thought_chunk" => {
                                    // Accumulate thought chunks
                                    let text = update
                                        .get("content")
                                        .and_then(|c| c.get("text"))
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");
                                    agent_thought_buffer.push_str(text);
                                    // Trace when buffer reaches 100+ chars
                                    if agent_thought_buffer.len() >= 100 {
                                        let record = TraceRecord::new(
                                            &our_sid,
                                            TraceEventType::AgentThought,
                                            Contributor::new(&provider_clone, None),
                                        )
                                        .with_conversation(TraceConversation {
                                            turn: None,
                                            role: Some("assistant".to_string()),
                                            content_preview: Some(truncate_content(
                                                &agent_thought_buffer,
                                                200,
                                            )),
                                            full_content: Some(agent_thought_buffer.clone()),
                                        });
                                        let writer = TraceWriter::new(&cwd_clone);
                                        let _ = writer.append_safe(&record).await;
                                        agent_thought_buffer.clear();
                                    }
                                }
                                "agent_message_chunk" => {
                                    // Accumulate message chunks
                                    let text = update
                                        .get("content")
                                        .and_then(|c| c.get("text"))
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");
                                    agent_msg_buffer.push_str(text);
                                    // Trace when buffer reaches 100+ chars
                                    if agent_msg_buffer.len() >= 100 {
                                        let record = TraceRecord::new(
                                            &our_sid,
                                            TraceEventType::AgentMessage,
                                            Contributor::new(&provider_clone, None),
                                        )
                                        .with_conversation(TraceConversation {
                                            turn: None,
                                            role: Some("assistant".to_string()),
                                            content_preview: Some(truncate_content(
                                                &agent_msg_buffer,
                                                200,
                                            )),
                                            full_content: Some(agent_msg_buffer.clone()),
                                        });
                                        let writer = TraceWriter::new(&cwd_clone);
                                        let _ = writer.append_safe(&record).await;
                                        agent_msg_buffer.clear();
                                    }
                                }
                                "agent_message" => {
                                    // Full message - trace immediately
                                    let text = update
                                        .get("content")
                                        .and_then(|c| c.get("text"))
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");
                                    let record = TraceRecord::new(
                                        &our_sid,
                                        TraceEventType::AgentMessage,
                                        Contributor::new(&provider_clone, None),
                                    )
                                    .with_conversation(TraceConversation {
                                        turn: None,
                                        role: Some("assistant".to_string()),
                                        content_preview: Some(truncate_content(text, 200)),
                                        full_content: Some(text.to_string()),
                                    });
                                    let writer = TraceWriter::new(&cwd_clone);
                                    let _ = writer.append_safe(&record).await;
                                }
                                "tool_call" => {
                                    // Tool call - OpenCode may send rawInput as empty initially
                                    let tool_call_id =
                                        update.get("toolCallId").and_then(|v| v.as_str());
                                    let kind = update
                                        .get("kind")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| update.get("title").and_then(|v| v.as_str()))
                                        .unwrap_or("unknown");
                                    let raw_input = update.get("rawInput").cloned();

                                    // Check if rawInput is empty or null
                                    let has_input = raw_input.as_ref().is_some_and(|v| {
                                        if let Some(obj) = v.as_object() {
                                            !obj.is_empty()
                                        } else {
                                            !v.is_null()
                                        }
                                    });

                                    if has_input {
                                        // Trace immediately with full input (Claude Code behavior)
                                        let record = TraceRecord::new(
                                            &our_sid,
                                            TraceEventType::ToolCall,
                                            Contributor::new(&provider_clone, None),
                                        )
                                        .with_tool(TraceTool {
                                            name: kind.to_string(),
                                            tool_call_id: tool_call_id.map(|s| s.to_string()),
                                            status: Some("running".to_string()),
                                            input: raw_input,
                                            output: None,
                                        });
                                        let writer = TraceWriter::new(&cwd_clone);
                                        let _ = writer.append_safe(&record).await;
                                    } else if let Some(id) = tool_call_id {
                                        // OpenCode behavior: rawInput is empty, wait for tool_call_update
                                        pending_tool_calls
                                            .insert(id.to_string(), (kind.to_string(), false));
                                    }
                                }
                                "tool_call_update" => {
                                    // Tool update - may contain rawInput (OpenCode) or just rawOutput (completion)
                                    let tool_call_id =
                                        update.get("toolCallId").and_then(|v| v.as_str());
                                    let kind = update
                                        .get("kind")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| update.get("title").and_then(|v| v.as_str()))
                                        .unwrap_or("unknown");
                                    let raw_input = update.get("rawInput").cloned();
                                    let raw_output = update
                                        .get("rawOutput")
                                        .and_then(|v| v.as_str())
                                        .map(|s| serde_json::Value::String(s.to_string()))
                                        .or_else(|| update.get("rawOutput").cloned());
                                    let status = update
                                        .get("status")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("completed");

                                    // Check if this update has rawInput and the tool_call wasn't traced yet
                                    let has_input = raw_input.as_ref().is_some_and(|v| {
                                        if let Some(obj) = v.as_object() {
                                            !obj.is_empty()
                                        } else {
                                            !v.is_null()
                                        }
                                    });

                                    if let Some(id) = tool_call_id {
                                        if let Some((stored_kind, traced)) =
                                            pending_tool_calls.get_mut(id)
                                        {
                                            if has_input && !*traced {
                                                // Record the tool_call trace now with actual input
                                                let record = TraceRecord::new(
                                                    &our_sid,
                                                    TraceEventType::ToolCall,
                                                    Contributor::new(&provider_clone, None),
                                                )
                                                .with_tool(TraceTool {
                                                    name: stored_kind.clone(),
                                                    tool_call_id: Some(id.to_string()),
                                                    status: Some("running".to_string()),
                                                    input: raw_input.clone(),
                                                    output: None,
                                                });
                                                let writer = TraceWriter::new(&cwd_clone);
                                                let _ = writer.append_safe(&record).await;
                                                *traced = true;
                                            }
                                        }
                                    }

                                    // Record tool_result trace when status indicates completion or we have output
                                    let is_complete = status == "completed"
                                        || status == "failed"
                                        || raw_output.is_some();
                                    if is_complete {
                                        let record = TraceRecord::new(
                                            &our_sid,
                                            TraceEventType::ToolResult,
                                            Contributor::new(&provider_clone, None),
                                        )
                                        .with_tool(TraceTool {
                                            name: kind.to_string(),
                                            tool_call_id: tool_call_id.map(|s| s.to_string()),
                                            status: Some(status.to_string()),
                                            input: None,
                                            output: raw_output,
                                        });
                                        let writer = TraceWriter::new(&cwd_clone);
                                        let _ = writer.append_safe(&record).await;

                                        // Clean up pending entry
                                        if let Some(id) = tool_call_id {
                                            pending_tool_calls.remove(id);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }

                    let _ = ntx.send(rewritten);
                } else {
                    tracing::debug!(
                        "[AcpProcess:{}] Unhandled message: {}",
                        name_clone,
                        truncate_content(&line, 200)
                    );
                }
            }

            // Flush any remaining buffered agent message content
            if !agent_msg_buffer.is_empty() {
                let record = TraceRecord::new(
                    &our_sid,
                    TraceEventType::AgentMessage,
                    Contributor::new(&provider_clone, None),
                )
                .with_conversation(TraceConversation {
                    turn: None,
                    role: Some("assistant".to_string()),
                    content_preview: Some(truncate_content(&agent_msg_buffer, 200)),
                    full_content: Some(agent_msg_buffer.clone()),
                });
                let writer = TraceWriter::new(&cwd_clone);
                let _ = writer.append_safe(&record).await;
            }

            // Flush any remaining buffered agent thought content
            if !agent_thought_buffer.is_empty() {
                let record = TraceRecord::new(
                    &our_sid,
                    TraceEventType::AgentThought,
                    Contributor::new(&provider_clone, None),
                )
                .with_conversation(TraceConversation {
                    turn: None,
                    role: Some("assistant".to_string()),
                    content_preview: Some(truncate_content(&agent_thought_buffer, 200)),
                    full_content: Some(agent_thought_buffer.clone()),
                });
                let writer = TraceWriter::new(&cwd_clone);
                let _ = writer.append_safe(&record).await;
            }

            alive_clone.store(false, Ordering::SeqCst);
            tracing::info!("[AcpProcess:{}] stdout reader finished", name_clone);
        });

        // Wait briefly for process to stabilize
        tokio::time::sleep(Duration::from_millis(300)).await;

        if !alive.load(Ordering::SeqCst) {
            return Err(format!("{display_name} process died during startup"));
        }

        tracing::info!("[AcpProcess:{}] Process started", display_name);

        Ok(Self {
            stdin,
            child: Arc::new(Mutex::new(Some(child))),
            pending,
            next_id: Arc::new(AtomicU64::new(1)),
            alive,
            notification_tx,
            display_name: display_name.to_string(),
            command: command.to_string(),
            _reader_handle: reader_handle,
        })
    }

    /// Whether the process is still alive.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Send a JSON-RPC request and wait for the response.
    pub async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout_ms: Option<u64>,
    ) -> Result<serde_json::Value, String> {
        if !self.is_alive() {
            return Err(format!("{} process is not alive", self.display_name));
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();

        self.pending.lock().await.insert(id, tx);

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let data = format!("{}\n", serde_json::to_string(&msg).unwrap());

        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(data.as_bytes())
                .await
                .map_err(|e| format!("Write {method}: {e}"))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Flush {method}: {e}"))?;
        }

        // Determine timeout based on method and command type
        // npx/uvx agents may need longer timeout for first-time package download
        let is_npx_or_uvx = self.command == "npx" || self.command == "uvx";
        let default_timeout = match method {
            "initialize" | "session/new" | "session/load" => {
                if is_npx_or_uvx {
                    120_000 // 2 min for npx/uvx (may need to download packages)
                } else {
                    15_000 // 15s for others
                }
            }
            "session/prompt" => 300_000, // 5 min
            _ => 30_000,
        };
        let timeout_dur = Duration::from_millis(timeout_ms.unwrap_or(default_timeout));

        match tokio::time::timeout(timeout_dur, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!("Channel closed for {method} (id={id})")),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!(
                    "Timeout waiting for {} (id={}, {}ms)",
                    method,
                    id,
                    timeout_dur.as_millis()
                ))
            }
        }
    }

    /// Initialize the ACP protocol.
    pub async fn initialize(&self) -> Result<serde_json::Value, String> {
        self.initialize_with_timeout(None).await
    }

    /// Initialize the ACP protocol with an optional timeout override.
    pub async fn initialize_with_timeout(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<serde_json::Value, String> {
        let result = self
            .send_request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": 1,
                    "clientInfo": {
                        "name": "routa-desktop",
                        "version": "0.1.0"
                    }
                }),
                timeout_ms,
            )
            .await?;
        tracing::info!(
            "[AcpProcess:{}] Initialized: {}",
            self.display_name,
            serde_json::to_string(&result).unwrap_or_default()
        );
        Ok(result)
    }

    /// Create a new ACP session. Returns the agent's session ID.
    pub async fn new_session(
        &self,
        cwd: &str,
        mcp_servers: &[serde_json::Value],
    ) -> Result<String, String> {
        let result = self
            .send_request(
                "session/new",
                serde_json::json!({
                    "cwd": cwd,
                    "mcpServers": mcp_servers
                }),
                None,
            )
            .await?;

        let session_id = result["sessionId"]
            .as_str()
            .ok_or_else(|| "No sessionId in session/new response".to_string())?
            .to_string();

        tracing::info!(
            "[AcpProcess:{}] Session created: {}",
            self.display_name,
            session_id
        );
        Ok(session_id)
    }

    /// Load a persisted ACP session. Returns the agent's resumed session ID.
    pub async fn load_session(
        &self,
        session_id: &str,
        cwd: &str,
        mcp_servers: &[serde_json::Value],
    ) -> Result<String, String> {
        let result = self
            .send_request(
                "session/load",
                serde_json::json!({
                    "sessionId": session_id,
                    "cwd": cwd,
                    "mcpServers": mcp_servers,
                }),
                None,
            )
            .await?;

        let resumed_session_id = result["sessionId"]
            .as_str()
            .unwrap_or(session_id)
            .to_string();

        tracing::info!(
            "[AcpProcess:{}] Session loaded: {}",
            self.display_name,
            resumed_session_id
        );
        Ok(resumed_session_id)
    }

    /// Send a prompt to an existing session. 5-minute timeout.
    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<serde_json::Value, String> {
        self.send_request(
            "session/prompt",
            serde_json::json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": text }]
            }),
            Some(300_000),
        )
        .await
    }

    /// Send session/cancel notification (no response expected).
    pub async fn cancel(&self, session_id: &str) {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": { "sessionId": session_id }
        });
        let data = format!("{}\n", serde_json::to_string(&msg).unwrap());
        let mut stdin = self.stdin.lock().await;
        let _ = stdin.write_all(data.as_bytes()).await;
        let _ = stdin.flush().await;
    }

    /// Get the notification broadcast sender (for subscribing to SSE).
    pub fn notification_sender(&self) -> &NotificationSender {
        &self.notification_tx
    }

    /// Kill the agent process.
    pub async fn kill(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().await.take() {
            tracing::info!("[AcpProcess:{}] Killing process", self.display_name);
            let _ = child.kill().await;
        }
        // Reject all pending requests
        let mut map = self.pending.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(Err("Process killed".to_string()));
        }
    }
}

/// Handle agent→client requests. Auto-approves permissions, handles fs ops.
async fn handle_agent_request(
    method: &str,
    params: &serde_json::Value,
    session_id: &str,
    notification_tx: &NotificationSender,
) -> serde_json::Value {
    match method {
        "session/request_permission" => {
            tracing::info!("[AcpProcess] session/request_permission params={}", params);
            build_permission_approval_result(params)
        }
        "fs/read_text_file" => {
            let path = params["path"].as_str().unwrap_or("");
            match tokio::fs::read_to_string(path).await {
                Ok(content) => serde_json::json!({ "content": content }),
                Err(e) => serde_json::json!({
                    "error": format!("Failed to read file: {}", e)
                }),
            }
        }
        "fs/write_text_file" => {
            let path = params["path"].as_str().unwrap_or("");
            let content = params["content"].as_str().unwrap_or("");
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            match tokio::fs::write(path, content).await {
                Ok(_) => serde_json::json!({}),
                Err(e) => serde_json::json!({
                    "error": format!("Failed to write file: {}", e)
                }),
            }
        }
        "terminal/create" => {
            match TerminalManager::global()
                .create(params, session_id, notification_tx)
                .await
            {
                Ok(result) => result,
                Err(error) => serde_json::json!({ "error": error }),
            }
        }
        "terminal/output" => {
            let terminal_id = params["terminalId"].as_str().unwrap_or("");
            match TerminalManager::global().get_output(terminal_id).await {
                Ok(result) => result,
                Err(error) => serde_json::json!({ "error": error }),
            }
        }
        "terminal/wait_for_exit" => {
            let terminal_id = params["terminalId"].as_str().unwrap_or("");
            match TerminalManager::global().wait_for_exit(terminal_id).await {
                Ok(result) => result,
                Err(error) => serde_json::json!({ "error": error }),
            }
        }
        "terminal/kill" => {
            let terminal_id = params["terminalId"].as_str().unwrap_or("");
            match TerminalManager::global().kill(terminal_id).await {
                Ok(_) => serde_json::json!({}),
                Err(error) => serde_json::json!({ "error": error }),
            }
        }
        "terminal/release" => {
            let terminal_id = params["terminalId"].as_str().unwrap_or("");
            TerminalManager::global().release(terminal_id).await;
            serde_json::json!({})
        }
        _ => {
            tracing::warn!("[AcpProcess] Unknown agent request: {}", method);
            serde_json::json!({})
        }
    }
}

/// Try to find and parse embedded JSON objects in a line.
fn try_parse_embedded_json(line: &str) -> Option<serde_json::Value> {
    let mut depth = 0i32;
    let mut start = None;

    for (i, ch) in line.char_indices() {
        match ch {
            '{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line[s..=i]) {
                            return Some(v);
                        }
                    }
                    start = None;
                }
            }
            _ => {}
        }
    }
    None
}

/// Build permission approval response following ACP spec and codex-acp expectations.
/// This mirrors the Next.js implementation in acp-process.ts.
fn build_permission_approval_result(params: &serde_json::Value) -> serde_json::Value {
    // Default scope is "turn"
    let scope = "turn";

    // Try to resolve optionId from params.options array
    if let Some(option_id) = resolve_permission_option_id(params, scope) {
        return serde_json::json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        });
    }

    // Fallback: return cancelled outcome
    serde_json::json!({
        "outcome": {
            "outcome": "cancelled"
        }
    })
}

/// Resolve the appropriate permission optionId from the options array.
/// Prefers "approved" or "approved-for-session" for turn/session scope.
fn resolve_permission_option_id(params: &serde_json::Value, scope: &str) -> Option<String> {
    let options = params.get("options")?.as_array()?;

    // Define preferred option IDs based on scope
    let preferred_ids = if scope == "session" {
        vec![
            "approved-for-session",
            "approved-always",
            "approved-execpolicy-amendment",
            "approved",
        ]
    } else {
        vec![
            "approved",
            "approved-once",
            "approved-for-session",
            "approved-always",
            "approved-execpolicy-amendment",
        ]
    };

    // Define preferred option kinds
    let preferred_kinds = if scope == "session" {
        vec!["allow_always", "allow_once"]
    } else {
        vec!["allow_once", "allow_always"]
    };

    // First, try to find by preferred optionId
    for pref_id in &preferred_ids {
        for option in options {
            if let Some(option_id) = option.get("optionId").and_then(|v| v.as_str()) {
                if option_id == *pref_id {
                    return Some(option_id.to_string());
                }
            }
        }
    }

    // Second, try to find by preferred kind
    for pref_kind in &preferred_kinds {
        for option in options {
            if let Some(kind) = option.get("kind").and_then(|v| v.as_str()) {
                if kind == *pref_kind {
                    if let Some(option_id) = option.get("optionId").and_then(|v| v.as_str()) {
                        return Some(option_id.to_string());
                    }
                }
            }
        }
    }

    // Fallback: use first available option or default
    if let Some(first_option) = options.first() {
        if let Some(option_id) = first_option.get("optionId").and_then(|v| v.as_str()) {
            return Some(option_id.to_string());
        }
    }

    // Last resort: return default based on scope
    Some(if scope == "session" {
        "approved-for-session".to_string()
    } else {
        "approved".to_string()
    })
}

/// Safely truncate a string at a UTF-8 character boundary.
/// Returns a substring of at most `max_bytes` bytes, but ensures it doesn't
/// cut in the middle of a multi-byte UTF-8 character.
fn truncate_content(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }

    // Find the last valid UTF-8 character boundary before max_bytes
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }

    s[..end].to_string()
}

fn should_ignore_process_stderr(command: &str, display_name: &str, line: &str) -> bool {
    is_codex_process(command, display_name) && is_codex_otel_stderr(line)
}

fn is_codex_process(command: &str, display_name: &str) -> bool {
    let trimmed_command = command.trim();
    display_name.trim().eq_ignore_ascii_case("codex")
        || trimmed_command.eq_ignore_ascii_case("codex-acp")
        || trimmed_command.ends_with("/codex-acp")
}

fn is_codex_otel_stderr(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.contains("codex_otel.log_only:") || trimmed.contains("codex_otel.trace_safe:")
}

#[cfg(test)]
mod tests {
    use super::{is_codex_otel_stderr, resolve_permission_option_id, should_ignore_process_stderr};
    use serde_json::json;

    #[test]
    fn ignores_codex_otel_stderr_noise() {
        let line = "INFO ... codex_otel.log_only: event.kind=response.output_text.delta";
        assert!(should_ignore_process_stderr(
            "/opt/homebrew/bin/codex-acp",
            "Codex",
            line
        ));
        assert!(is_codex_otel_stderr(line));
    }

    #[test]
    fn preserves_non_otel_codex_stderr() {
        let line = "ERROR codex_api::endpoint::responses_websocket: failed to connect";
        assert!(!should_ignore_process_stderr(
            "/opt/homebrew/bin/codex-acp",
            "Codex",
            line
        ));
    }

    #[test]
    fn preserves_other_provider_stderr() {
        let line = "INFO ... codex_otel.log_only: event.kind=response.output_text.delta";
        assert!(!should_ignore_process_stderr(
            "/usr/bin/opencode",
            "OpenCode",
            line
        ));
    }

    #[test]
    fn resolve_permission_option_id_prefers_turn_approval() {
        let params = json!({
            "options": [
                { "optionId": "denied", "kind": "deny_once" },
                { "optionId": "approved", "kind": "allow_once" }
            ]
        });

        assert_eq!(
            resolve_permission_option_id(&params, "turn").as_deref(),
            Some("approved")
        );
    }
}
