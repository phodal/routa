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

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, Mutex, oneshot};

/// Callback type for session/update notifications from the agent.
pub type NotificationSender = broadcast::Sender<serde_json::Value>;

/// A managed ACP agent child process.
pub struct AcpProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Option<Child>>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>>,
    next_id: Arc<AtomicU64>,
    alive: Arc<AtomicBool>,
    notification_tx: NotificationSender,
    display_name: String,
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

        // Resolve the actual binary path using the full shell PATH
        // (macOS GUI apps have a minimal PATH that won't find user CLI tools)
        let resolved_command = crate::shell_env::which(command)
            .unwrap_or_else(|| command.to_string());

        let mut child = tokio::process::Command::new(&resolved_command)
            .args(args)
            .current_dir(cwd)
            .env("PATH", crate::shell_env::full_path())
            .env("NODE_NO_READLINE", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to spawn '{}' (resolved: '{}'): {}. Is it installed and in PATH?",
                    command, resolved_command, e
                )
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
        let pending: Arc<
            Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>,
        > = Arc::new(Mutex::new(HashMap::new()));
        let stdin = Arc::new(Mutex::new(stdin));

        let name = display_name.to_string();

        // Log stderr in background
        if let Some(stderr) = stderr {
            let name_clone = name.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        tracing::debug!("[AcpProcess:{} stderr] {}", name_clone, line);
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

        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

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
                                &line[..line.len().min(200)]
                            );
                            continue;
                        }
                    }
                };

                let has_id = msg.get("id").is_some()
                    && !msg.get("id").unwrap().is_null();
                let has_result = msg.get("result").is_some();
                let has_error = msg.get("error").is_some();
                let has_method = msg
                    .get("method")
                    .and_then(|m| m.as_str())
                    .is_some();

                if has_id && (has_result || has_error) {
                    // Response to a pending request
                    let id = msg["id"].as_u64().unwrap_or(0);
                    let mut map = pending_clone.lock().await;
                    if let Some(tx) = map.remove(&id) {
                        if has_error {
                            let err_msg = msg["error"]["message"]
                                .as_str()
                                .unwrap_or("unknown error");
                            let err_code = msg["error"]["code"].as_i64().unwrap_or(0);
                            let _ = tx.send(Err(format!(
                                "ACP Error [{}]: {}",
                                err_code, err_msg
                            )));
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
                    let response = handle_agent_request(method, &msg["params"]).await;
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
                    let mut rewritten = msg;
                    if let Some(params) = rewritten.get_mut("params") {
                        if params.get("sessionId").is_some() {
                            params["sessionId"] =
                                serde_json::Value::String(our_sid.clone());
                        }
                    }
                    let _ = ntx.send(rewritten);
                } else {
                    tracing::debug!(
                        "[AcpProcess:{}] Unhandled message: {}",
                        name_clone,
                        &line[..line.len().min(200)]
                    );
                }
            }

            alive_clone.store(false, Ordering::SeqCst);
            tracing::info!("[AcpProcess:{}] stdout reader finished", name_clone);
        });

        // Wait briefly for process to stabilize
        tokio::time::sleep(Duration::from_millis(300)).await;

        if !alive.load(Ordering::SeqCst) {
            return Err(format!("{} process died during startup", display_name));
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
                .map_err(|e| format!("Write {}: {}", method, e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Flush {}: {}", method, e))?;
        }

        let default_timeout = match method {
            "initialize" | "session/new" => 15_000,
            "session/prompt" => 300_000, // 5 min
            _ => 30_000,
        };
        let timeout_dur = Duration::from_millis(timeout_ms.unwrap_or(default_timeout));

        match tokio::time::timeout(timeout_dur, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!("Channel closed for {} (id={})", method, id)),
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
                None,
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
    pub async fn new_session(&self, cwd: &str) -> Result<String, String> {
        let result = self
            .send_request(
                "session/new",
                serde_json::json!({
                    "cwd": cwd,
                    "mcpServers": []
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

    /// Send a prompt to an existing session. 5-minute timeout.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<serde_json::Value, String> {
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
) -> serde_json::Value {
    match method {
        "session/request_permission" => {
            // Auto-approve all permissions
            serde_json::json!({
                "outcome": { "outcome": "approved" }
            })
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
            // Stub: return a fake terminal ID
            serde_json::json!({ "terminalId": uuid::Uuid::new_v4().to_string() })
        }
        "terminal/output" => {
            serde_json::json!({ "output": "" })
        }
        "terminal/wait_for_exit" => {
            serde_json::json!({ "exitCode": 0 })
        }
        "terminal/kill" | "terminal/release" => {
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
