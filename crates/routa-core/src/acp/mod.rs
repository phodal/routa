//! ACP (Agent Client Protocol) integration.
//!
//! Manages ACP agent processes and provides JSON-RPC communication
//! between the desktop client and coding agents (e.g. OpenCode, Claude, Copilot).
//!
//! Architecture (matches the Next.js `AcpProcessManager`):
//!   - `session/new`    → spawns a child process, sends `initialize` + `session/new`
//!   - `session/prompt` → reuses the live process, sends `session/prompt`
//!   - `session/cancel` → sends cancellation notification
//!   - SSE GET          → subscribes to `broadcast` channel for `session/update` events
//!
//! **Claude Code** uses a different protocol (stream-json) instead of ACP.
//! The `ClaudeCodeProcess` translates Claude's output into ACP-compatible
//! `session/update` notifications for frontend compatibility.
//!
//! **Agent Trace**: All sessions record trace events to JSONL files for
//! attribution tracking (which model/session/tool affected which files and when).

pub mod binary_manager;
pub mod claude_code_process;
pub mod docker;
pub mod installation_state;
pub mod mcp_setup;
pub mod paths;
pub mod process;
pub mod provider_adapter;
pub mod registry_fetch;
pub mod registry_types;
pub mod runtime_manager;
pub mod terminal_manager;
pub mod warmup;

pub use binary_manager::AcpBinaryManager;
pub use claude_code_process::{ClaudeCodeConfig, ClaudeCodeProcess};
pub use installation_state::AcpInstallationState;
pub use paths::AcpPaths;
pub use registry_fetch::{fetch_registry, fetch_registry_json};
pub use registry_types::*;
pub use runtime_manager::{current_platform, AcpRuntimeManager, RuntimeInfo, RuntimeType};
pub use warmup::{AcpWarmupService, WarmupState, WarmupStatus};

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

use crate::trace::{Contributor, TraceConversation, TraceEventType, TraceRecord, TraceWriter};
use process::AcpProcess;

// ─── Session Record ─────────────────────────────────────────────────────

/// Record of an active ACP session persisted for UI listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionRecord {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub cwd: String,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routa_agent_id: Option<String>,
    pub provider: Option<String>,
    pub role: Option<String>,
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub first_prompt_sent: bool,
    /// Parent session ID for CRAFTER child sessions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_system_prompt: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionLaunchOptions {
    pub specialist_id: Option<String>,
    pub specialist_system_prompt: Option<String>,
    pub allowed_native_tools: Option<Vec<String>>,
    pub initialize_timeout_ms: Option<u64>,
}

// ─── Managed Process ────────────────────────────────────────────────────

/// Process type enum to support both ACP and Claude stream-json protocols.
#[derive(Clone)]
enum AgentProcessType {
    /// Standard ACP protocol (opencode, gemini, copilot, etc.)
    Acp(Arc<AcpProcess>),
    /// Claude Code stream-json protocol
    Claude(Arc<ClaudeCodeProcess>),
}

impl AgentProcessType {
    /// Kill the underlying process.
    async fn kill(&self) {
        match self {
            AgentProcessType::Acp(process) => process.kill().await,
            AgentProcessType::Claude(process) => process.kill().await,
        }
    }
}

/// A managed agent process with its metadata.
struct ManagedProcess {
    process: AgentProcessType,
    /// The agent's own session ID (returned by `session/new` or claude's session_id).
    acp_session_id: String,
    preset_id: String,
    #[allow(dead_code)]
    created_at: String,
    /// Trace writer for recording agent activities to JSONL
    trace_writer: TraceWriter,
    /// Working directory (for contributor context)
    #[allow(dead_code)]
    cwd: String,
}

// ─── ACP Manager ────────────────────────────────────────────────────────

/// Manages ACP agent sessions and process lifecycle.
///
/// Each session maps to a long-lived child process that communicates via
/// stdio JSON-RPC. Notifications are forwarded to subscribers via broadcast.
#[derive(Clone)]
pub struct AcpManager {
    /// Our sessionId → session record (for UI listing)
    sessions: Arc<RwLock<HashMap<String, AcpSessionRecord>>>,
    /// Our sessionId → managed process (the live agent)
    processes: Arc<RwLock<HashMap<String, ManagedProcess>>>,
    /// Our sessionId → broadcast sender for SSE notifications
    notification_channels: Arc<RwLock<HashMap<String, broadcast::Sender<serde_json::Value>>>>,
    /// Our sessionId → message history (session/update notifications)
    history: Arc<RwLock<HashMap<String, Vec<serde_json::Value>>>>,
}

impl Default for AcpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AcpManager {
    pub fn rewrite_notification_session_id(
        session_id: &str,
        mut notification: serde_json::Value,
    ) -> serde_json::Value {
        if let Some(object) = notification.as_object_mut() {
            object.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id.to_string()),
            );
        }
        notification
    }

    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            notification_channels: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// List all session records.
    pub async fn list_sessions(&self) -> Vec<AcpSessionRecord> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }

    /// Get a session record by ID.
    pub async fn get_session(&self, session_id: &str) -> Option<AcpSessionRecord> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    /// Rename a session.
    /// Returns `Some(())` if the session was found and renamed, `None` if not found.
    pub async fn rename_session(&self, session_id: &str, name: &str) -> Option<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id)?;
        session.name = Some(name.to_string());
        Some(())
    }

    /// Attach a ROUTA agent ID to an existing session record.
    /// Returns `Some(())` if the session was found, `None` if not found.
    pub async fn set_routa_agent_id(&self, session_id: &str, routa_agent_id: &str) -> Option<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id)?;
        session.routa_agent_id = Some(routa_agent_id.to_string());
        Some(())
    }

    /// Delete a session.
    /// Returns `Some(())` if the session was found and deleted, `None` if not found.
    pub async fn delete_session(&self, session_id: &str) -> Option<()> {
        let mut sessions = self.sessions.write().await;
        let mut processes = self.processes.write().await;
        let mut channels = self.notification_channels.write().await;
        let mut history = self.history.write().await;

        // Remove session record
        sessions.remove(session_id)?;

        // Kill the process if it exists
        if let Some(managed) = processes.remove(session_id) {
            let _ = managed.process.kill().await;
        }

        // Remove notification channel
        channels.remove(session_id);

        // Remove history
        history.remove(session_id);

        Some(())
    }

    /// Get session message history.
    /// Returns `Some(history)` if the session exists, `None` if not found.
    pub async fn get_session_history(&self, session_id: &str) -> Option<Vec<serde_json::Value>> {
        let history = self.history.read().await;
        history.get(session_id).cloned()
    }

    /// Add a notification to session history.
    /// Child agent notifications (those with `childAgentId`) are NOT stored in the
    /// parent session's history — they would flood out the ROUTA coordinator's own
    /// messages. Child messages are persisted in their own child session's history.
    pub async fn push_to_history(&self, session_id: &str, notification: serde_json::Value) {
        // Skip child agent notifications to prevent flooding parent history
        if notification.get("childAgentId").is_some() {
            return;
        }
        let mut history = self.history.write().await;
        let entries = history
            .entry(session_id.to_string())
            .or_insert_with(Vec::new);
        entries.push(notification);
        // Cap at 500 entries (same limit as Next.js backend)
        if entries.len() > 500 {
            let drain_count = entries.len() - 500;
            entries.drain(0..drain_count);
        }
    }

    /// Broadcast a synthetic session/update event and persist it into in-memory history.
    pub async fn emit_session_update(
        &self,
        session_id: &str,
        update: serde_json::Value,
    ) -> Result<(), String> {
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": update,
            }
        });

        if let Some(channel) = self
            .notification_channels
            .read()
            .await
            .get(session_id)
            .cloned()
        {
            let _ = channel.send(message.clone());
        } else {
            let params = message
                .get("params")
                .cloned()
                .ok_or_else(|| "Missing params in synthetic session/update".to_string())?;
            self.push_to_history(
                session_id,
                Self::rewrite_notification_session_id(session_id, params),
            )
            .await;
        }
        Ok(())
    }

    /// Mark a session as having had its first prompt dispatched.
    pub async fn mark_first_prompt_sent(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.first_prompt_sent = true;
        }
    }

    /// Create a new ACP session: spawn agent process, initialize, create session.
    /// Supports both static presets and registry-based agents.
    /// **Claude** uses stream-json protocol instead of ACP.
    ///
    /// Returns `(our_session_id, agent_session_id)`.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_session(
        &self,
        session_id: String,
        cwd: String,
        workspace_id: String,
        provider: Option<String>,
        role: Option<String>,
        model: Option<String>,
        parent_session_id: Option<String>,
        tool_mode: Option<String>,
        mcp_profile: Option<String>,
    ) -> Result<(String, String), String> {
        self.create_session_with_options(
            session_id,
            cwd,
            workspace_id,
            provider,
            role,
            model,
            parent_session_id,
            tool_mode,
            mcp_profile,
            SessionLaunchOptions::default(),
        )
        .await
    }

    fn spawn_history_mirror(
        &self,
        session_id: &str,
        ntx: &broadcast::Sender<serde_json::Value>,
    ) {
        let history_manager = self.clone();
        let history_session_id = session_id.to_string();
        let mut history_rx = ntx.subscribe();
        tokio::spawn(async move {
            loop {
                match history_rx.recv().await {
                    Ok(message) => {
                        let params = match message.get("params") {
                            Some(value) => value.clone(),
                            None => continue,
                        };
                        history_manager
                            .push_to_history(
                                &history_session_id,
                                Self::rewrite_notification_session_id(&history_session_id, params),
                            )
                            .await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            "[AcpManager] Dropped {} session/update notifications for {}",
                            skipped,
                            history_session_id
                        );
                    }
                }
            }
        });
    }

    #[allow(clippy::too_many_arguments)]
    async fn register_managed_session(
        &self,
        session_id: String,
        cwd: String,
        workspace_id: String,
        provider_name: String,
        role: Option<String>,
        model: Option<String>,
        parent_session_id: Option<String>,
        options: &SessionLaunchOptions,
        process_type: AgentProcessType,
        acp_session_id: String,
        ntx: broadcast::Sender<serde_json::Value>,
    ) {
        let created_at = chrono::Utc::now().to_rfc3339();
        let trace_writer = TraceWriter::new(&cwd);
        let record = AcpSessionRecord {
            session_id: session_id.clone(),
            name: None,
            cwd: cwd.clone(),
            workspace_id: workspace_id.clone(),
            routa_agent_id: None,
            provider: Some(provider_name.clone()),
            role: role.clone().or(Some("CRAFTER".to_string())),
            mode_id: None,
            model: model.clone(),
            created_at: created_at.clone(),
            first_prompt_sent: false,
            parent_session_id: parent_session_id.clone(),
            specialist_id: options.specialist_id.clone(),
            specialist_system_prompt: options.specialist_system_prompt.clone(),
        };

        self.sessions.write().await.insert(session_id.clone(), record);
        self.processes.write().await.insert(
            session_id.clone(),
            ManagedProcess {
                process: process_type,
                acp_session_id: acp_session_id.clone(),
                preset_id: provider_name.clone(),
                created_at,
                trace_writer: trace_writer.clone(),
                cwd: cwd.clone(),
            },
        );
        self.notification_channels
            .write()
            .await
            .insert(session_id.clone(), ntx.clone());
        self.spawn_history_mirror(&session_id, &ntx);

        let trace = TraceRecord::new(
            &session_id,
            TraceEventType::SessionStart,
            Contributor::new(&provider_name, None),
        )
        .with_workspace_id(&workspace_id)
        .with_metadata(
            "role",
            serde_json::json!(role.as_deref().unwrap_or("CRAFTER")),
        )
        .with_metadata("cwd", serde_json::json!(cwd));

        trace_writer.append_safe(&trace).await;
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_session_from_inline(
        &self,
        session_id: String,
        cwd: String,
        workspace_id: String,
        provider_name: String,
        role: Option<String>,
        model: Option<String>,
        parent_session_id: Option<String>,
        command: String,
        args: Vec<String>,
        options: SessionLaunchOptions,
    ) -> Result<(String, String), String> {
        let (ntx, _) = broadcast::channel::<serde_json::Value>(256);

        let process = AcpProcess::spawn(
            &command,
            &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            &cwd,
            ntx.clone(),
            &provider_name,
            &session_id,
        )
        .await?;

        process
            .initialize_with_timeout(options.initialize_timeout_ms)
            .await?;

        let acp_session_id = process.new_session(&cwd).await?;
        self.register_managed_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            provider_name.clone(),
            role.clone(),
            model.clone(),
            parent_session_id.clone(),
            &options,
            AgentProcessType::Acp(Arc::new(process)),
            acp_session_id.clone(),
            ntx.clone(),
        )
        .await;

        tracing::info!(
            "[AcpManager] Session {} created from inline command (provider: {}, agent session: {})",
            session_id,
            provider_name,
            acp_session_id,
        );

        Ok((session_id, acp_session_id))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_session_with_options(
        &self,
        session_id: String,
        cwd: String,
        workspace_id: String,
        provider: Option<String>,
        role: Option<String>,
        model: Option<String>,
        parent_session_id: Option<String>,
        tool_mode: Option<String>,
        mcp_profile: Option<String>,
        options: SessionLaunchOptions,
    ) -> Result<(String, String), String> {
        let provider_name = provider.as_deref().unwrap_or("opencode");

        // Create the notification broadcast channel for this session
        let (ntx, _) = broadcast::channel::<serde_json::Value>(256);
        let claude_mcp_config = if provider_name == "claude" {
            Some(mcp_setup::build_claude_mcp_config(
                &workspace_id,
                &session_id,
                tool_mode.as_deref(),
                mcp_profile.as_deref(),
            ))
        } else {
            None
        };

        // Check if this is Claude (uses stream-json protocol, not ACP)
        let (process_type, acp_session_id) = if provider_name == "claude" {
            // Use Claude Code stream-json protocol
            let config = ClaudeCodeConfig {
                command: "claude".to_string(),
                cwd: cwd.clone(),
                display_name: format!("Claude-{}", &session_id[..8.min(session_id.len())]),
                permission_mode: Some("bypassPermissions".to_string()),
                mcp_configs: claude_mcp_config.into_iter().collect(),
                append_system_prompt: options.specialist_system_prompt.clone(),
                allowed_tools: options.allowed_native_tools.clone(),
            };

            let claude_process = ClaudeCodeProcess::spawn(config, ntx.clone()).await?;
            let claude_session_id = claude_process
                .session_id()
                .await
                .unwrap_or_else(|| format!("claude-{}", &session_id[..8.min(session_id.len())]));

            (
                AgentProcessType::Claude(Arc::new(claude_process)),
                claude_session_id,
            )
        } else {
            // Use standard ACP protocol
            let preset = get_preset_by_id_with_registry(provider_name).await?;

            if let Some(summary) = mcp_setup::ensure_mcp_for_provider(
                provider_name,
                &workspace_id,
                &session_id,
                tool_mode.as_deref(),
                mcp_profile.as_deref(),
            )
            .await?
            {
                tracing::info!("[AcpManager] {}", summary);
            }

            // Build args: preset args + optional model flag
            let mut extra_args: Vec<String> = preset.args.clone();
            if let Some(ref m) = model {
                if !m.is_empty() {
                    // opencode (and future providers) accept -m <model>
                    extra_args.push("-m".to_string());
                    extra_args.push(m.clone());
                }
            }

            let preset_command = resolve_preset_command(&preset);
            let process = AcpProcess::spawn(
                &preset_command,
                &extra_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                &cwd,
                ntx.clone(),
                &preset.name,
                &session_id,
            )
            .await?;

            // Initialize the protocol
            process
                .initialize_with_timeout(options.initialize_timeout_ms)
                .await?;

            // Create the agent session
            let agent_session_id = process.new_session(&cwd).await?;

            (AgentProcessType::Acp(Arc::new(process)), agent_session_id)
        };

        self.register_managed_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            provider_name.to_string(),
            role.clone(),
            model.clone(),
            parent_session_id.clone(),
            &options,
            process_type,
            acp_session_id.clone(),
            ntx.clone(),
        )
        .await;

        tracing::info!(
            "[AcpManager] Session {} created (provider: {}, agent session: {})",
            session_id,
            provider_name,
            acp_session_id,
        );

        Ok((session_id, acp_session_id))
    }

    /// Send a prompt to an existing session's agent process.
    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<serde_json::Value, String> {
        self.mark_first_prompt_sent(session_id).await;

        let (process, acp_session_id, preset_id, trace_writer) = {
            let processes = self.processes.read().await;
            let managed = processes
                .get(session_id)
                .ok_or_else(|| format!("No agent process for session: {}", session_id))?;
            (
                managed.process.clone(),
                managed.acp_session_id.clone(),
                managed.preset_id.clone(),
                managed.trace_writer.clone(),
            )
        };

        let is_alive = match &process {
            AgentProcessType::Acp(p) => p.is_alive(),
            AgentProcessType::Claude(p) => p.is_alive(),
        };

        if !is_alive {
            return Err(format!("Agent ({}) process is not running", preset_id));
        }

        // Record UserMessage trace
        let trace = TraceRecord::new(
            session_id,
            TraceEventType::UserMessage,
            Contributor::new(&preset_id, None),
        )
        .with_conversation(TraceConversation {
            turn: None,
            role: Some("user".to_string()),
            content_preview: Some(truncate_content(text, 500)),
            full_content: None,
        });

        trace_writer.append_safe(&trace).await;

        tracing::info!(
            target: "routa_acp_prompt",
            session_id = %session_id,
            preset_id = %preset_id,
            acp_session_id = %acp_session_id,
            prompt_len = text.len(),
            "acp prompt start"
        );

        let result = match &process {
            AgentProcessType::Acp(p) => p.prompt(&acp_session_id, text).await,
            AgentProcessType::Claude(p) => {
                let stop_reason = p.prompt(text).await?;
                Ok(serde_json::json!({ "stopReason": stop_reason }))
            }
        };

        match &result {
            Ok(_) => tracing::info!(
                target: "routa_acp_prompt",
                session_id = %session_id,
                preset_id = %preset_id,
                "acp prompt success"
            ),
            Err(error) => tracing::error!(
                target: "routa_acp_prompt",
                session_id = %session_id,
                preset_id = %preset_id,
                error = %error,
                "acp prompt failed"
            ),
        }

        result
    }

    /// Cancel the current prompt in a session.
    pub async fn cancel(&self, session_id: &str) {
        let processes = self.processes.read().await;
        if let Some(managed) = processes.get(session_id) {
            match &managed.process {
                AgentProcessType::Acp(p) => p.cancel(&managed.acp_session_id).await,
                AgentProcessType::Claude(p) => p.cancel().await,
            }
        }
    }

    /// Kill a session's agent process and remove it.
    pub async fn kill_session(&self, session_id: &str) {
        // Kill the process
        if let Some(managed) = self.processes.write().await.remove(session_id) {
            // Record SessionEnd trace before killing
            let trace = TraceRecord::new(
                session_id,
                TraceEventType::SessionEnd,
                Contributor::new(&managed.preset_id, None),
            );
            managed.trace_writer.append_safe(&trace).await;

            match &managed.process {
                AgentProcessType::Acp(p) => p.kill().await,
                AgentProcessType::Claude(p) => p.kill().await,
            }
        }
        // Remove session record
        self.sessions.write().await.remove(session_id);
        // Remove notification channel
        self.notification_channels.write().await.remove(session_id);
    }

    /// Subscribe to SSE notifications for a session.
    /// Returns a broadcast receiver that yields `session/update` JSON-RPC messages.
    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Option<broadcast::Receiver<serde_json::Value>> {
        let channels = self.notification_channels.read().await;
        channels.get(session_id).map(|tx| tx.subscribe())
    }

    /// Check if a session's agent process is alive.
    pub async fn is_alive(&self, session_id: &str) -> bool {
        let processes = self.processes.read().await;
        processes
            .get(session_id)
            .map(|m| match &m.process {
                AgentProcessType::Acp(p) => p.is_alive(),
                AgentProcessType::Claude(p) => p.is_alive(),
            })
            .unwrap_or(false)
    }

    /// Get the preset ID for a session.
    pub async fn get_preset_id(&self, session_id: &str) -> Option<String> {
        let processes = self.processes.read().await;
        processes.get(session_id).map(|m| m.preset_id.clone())
    }

    /// Check if a session uses Claude (stream-json protocol, not ACP).
    pub async fn is_claude_session(&self, session_id: &str) -> bool {
        let processes = self.processes.read().await;
        processes
            .get(session_id)
            .map(|m| matches!(&m.process, AgentProcessType::Claude(_)))
            .unwrap_or(false)
    }

    /// Send a prompt to Claude session and return immediately.
    /// The actual response is streamed via the broadcast channel.
    /// Use `subscribe()` to receive notifications.
    pub async fn prompt_claude_async(&self, session_id: &str, text: &str) -> Result<(), String> {
        let processes = self.processes.read().await;
        let managed = processes
            .get(session_id)
            .ok_or_else(|| format!("No agent process for session: {}", session_id))?;

        // Record trace
        let trace = TraceRecord::new(
            session_id,
            TraceEventType::UserMessage,
            Contributor::new(&managed.preset_id, None),
        )
        .with_conversation(TraceConversation {
            turn: None,
            role: Some("user".to_string()),
            content_preview: Some(text[..text.len().min(200)].to_string()),
            full_content: Some(text.to_string()),
        });

        managed.trace_writer.append_safe(&trace).await;

        match &managed.process {
            AgentProcessType::Claude(p) => {
                // Spawn the prompt in a background task so we can return immediately
                let process = Arc::clone(p);
                let text = text.to_string();
                tokio::spawn(async move {
                    let _ = process.prompt(&text).await;
                });
                Ok(())
            }
            AgentProcessType::Acp(_) => {
                Err("prompt_claude_async is only for Claude sessions".to_string())
            }
        }
    }
}

// ─── ACP Presets ────────────────────────────────────────────────────────

/// ACP provider presets for known coding agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPreset {
    /// Unique identifier (lowercase, e.g., "claude", "opencode")
    pub id: String,
    /// Human-readable display name (e.g., "Claude Code", "OpenCode")
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub description: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_bin_override: Option<String>,
}

/// Get the list of known ACP agent presets (static/builtin only).
pub fn get_presets() -> Vec<AcpPreset> {
    vec![
        AcpPreset {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            command: "opencode".to_string(),
            args: vec!["acp".to_string()],
            description: "OpenCode AI coding agent".to_string(),
            env_bin_override: Some("OPENCODE_BIN".to_string()),
        },
        AcpPreset {
            id: "gemini".to_string(),
            name: "Gemini".to_string(),
            command: "gemini".to_string(),
            args: vec!["--experimental-acp".to_string()],
            description: "Google Gemini CLI".to_string(),
            env_bin_override: None,
        },
        AcpPreset {
            id: "codex-acp".to_string(),
            name: "Codex".to_string(),
            command: "codex-acp".to_string(),
            args: vec![],
            description: "OpenAI Codex CLI (codex-acp wrapper)".to_string(),
            env_bin_override: Some("CODEX_ACP_BIN".to_string()),
        },
        AcpPreset {
            id: "copilot".to_string(),
            name: "GitHub Copilot".to_string(),
            command: "copilot".to_string(),
            args: vec![
                "--acp".to_string(),
                "--allow-all-tools".to_string(),
                "--no-ask-user".to_string(),
            ],
            description: "GitHub Copilot CLI".to_string(),
            env_bin_override: Some("COPILOT_BIN".to_string()),
        },
        AcpPreset {
            id: "auggie".to_string(),
            name: "Auggie".to_string(),
            command: "auggie".to_string(),
            args: vec!["--acp".to_string()],
            description: "Augment Code's AI agent".to_string(),
            env_bin_override: None,
        },
        AcpPreset {
            id: "kimi".to_string(),
            name: "Kimi".to_string(),
            command: "kimi".to_string(),
            args: vec!["acp".to_string()],
            description: "Moonshot AI's Kimi CLI".to_string(),
            env_bin_override: None,
        },
        AcpPreset {
            id: "kiro".to_string(),
            name: "Kiro".to_string(),
            command: "kiro-cli".to_string(),
            args: vec!["acp".to_string()],
            description: "Amazon Kiro AI coding agent".to_string(),
            env_bin_override: Some("KIRO_BIN".to_string()),
        },
        AcpPreset {
            id: "qoder".to_string(),
            name: "Qoder".to_string(),
            command: "qodercli".to_string(),
            args: vec!["--acp".to_string()],
            description: "Qoder AI coding agent".to_string(),
            env_bin_override: Some("QODER_BIN".to_string()),
        },
        AcpPreset {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            // Claude Code uses stream-json protocol, not ACP flags
            // Args are unused since we use ClaudeCodeProcess directly
            args: vec![],
            description: "Anthropic Claude Code (stream-json protocol)".to_string(),
            env_bin_override: Some("CLAUDE_BIN".to_string()),
        },
    ]
}

/// Get a preset by ID, checking both static presets and registry.
/// Static presets take precedence.
///
/// Supports suffixed IDs like "auggie-registry" to explicitly request
/// the registry version when both built-in and registry versions exist.
pub async fn get_preset_by_id_with_registry(id: &str) -> Result<AcpPreset, String> {
    let normalized_id = match id {
        "codex" => "codex-acp",
        "qodercli" => "qoder",
        other => other,
    };

    // Handle suffixed IDs (e.g., "auggie-registry")
    // This allows explicit selection of registry version when both exist
    const REGISTRY_SUFFIX: &str = "-registry";
    if let Some(base_id) = normalized_id.strip_suffix(REGISTRY_SUFFIX) {
        let mut preset = get_registry_preset(base_id).await?;
        // Keep the suffixed ID in the returned preset for consistency
        preset.id = id.to_string();
        return Ok(preset);
    }

    // Check static presets first (match by id, not name)
    if let Some(mut preset) = get_presets().into_iter().find(|p| p.id == normalized_id) {
        if preset.id != id {
            preset.id = id.to_string();
        }
        return Ok(preset);
    }

    // Fall back to registry
    let mut preset = get_registry_preset(normalized_id).await?;
    if preset.id != id {
        preset.id = id.to_string();
    }
    Ok(preset)
}

/// Get a preset from the ACP registry by ID.
async fn get_registry_preset(id: &str) -> Result<AcpPreset, String> {
    let registry: AcpRegistry = fetch_registry().await?;

    // Find the agent
    let agent = registry
        .agents
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("Agent '{}' not found in registry", id))?;

    // Build command from distribution
    let (command, args) = if let Some(ref npx) = agent.distribution.npx {
        let mut args = vec!["-y".to_string(), npx.package.clone()];
        args.extend(npx.args.clone());
        ("npx".to_string(), args)
    } else if let Some(ref uvx) = agent.distribution.uvx {
        let mut args = vec![uvx.package.clone()];
        args.extend(uvx.args.clone());
        ("uvx".to_string(), args)
    } else {
        return Err(format!(
            "Agent '{}' has no supported distribution (npx/uvx)",
            id
        ));
    };

    Ok(AcpPreset {
        id: agent.id.clone(),
        name: agent.name,
        command,
        args,
        description: agent.description,
        env_bin_override: None,
    })
}

fn resolve_preset_command(preset: &AcpPreset) -> String {
    if let Some(env_var) = &preset.env_bin_override {
        if let Ok(custom_command) = std::env::var(env_var) {
            let trimmed = custom_command.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    crate::shell_env::which(&preset.command).unwrap_or_else(|| preset.command.clone())
}

// ─── Utility Functions ─────────────────────────────────────────────────────

/// Truncate content to a maximum length for storage in traces.
fn truncate_content(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        text.to_string()
    } else if max_len <= 3 {
        text.chars().take(max_len).collect()
    } else {
        let truncated: String = text.chars().take(max_len - 3).collect();
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        get_preset_by_id_with_registry, get_presets, truncate_content, AcpManager, AcpSessionRecord,
    };
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[test]
    fn static_presets_include_codex_acp_for_codex_alias() {
        let presets = get_presets();
        assert!(presets.iter().any(|preset| preset.id == "codex-acp"));
    }

    #[test]
    fn static_presets_include_qoder() {
        let presets = get_presets();
        assert!(presets.iter().any(|preset| preset.id == "qoder"));
    }

    #[tokio::test]
    async fn qodercli_alias_resolves_to_qoder_preset() {
        let preset = get_preset_by_id_with_registry("qodercli")
            .await
            .expect("qodercli alias should resolve");
        assert_eq!(preset.id, "qodercli");
        assert_eq!(preset.command, "qodercli");
        assert_eq!(preset.args, vec!["--acp".to_string()]);
    }

    #[tokio::test]
    async fn mark_first_prompt_sent_updates_live_session_record() {
        let manager = AcpManager::new();
        let session_id = "session-1".to_string();
        manager.sessions.write().await.insert(
            session_id.clone(),
            AcpSessionRecord {
                session_id: session_id.clone(),
                name: None,
                cwd: ".".to_string(),
                workspace_id: "default".to_string(),
                routa_agent_id: None,
                provider: Some("opencode".to_string()),
                role: Some("CRAFTER".to_string()),
                mode_id: None,
                model: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                first_prompt_sent: false,
                parent_session_id: None,
                specialist_id: None,
                specialist_system_prompt: None,
            },
        );

        manager.mark_first_prompt_sent(&session_id).await;

        let session = manager.get_session(&session_id).await.expect("session");
        assert!(session.first_prompt_sent);
    }

    #[tokio::test]
    async fn push_to_history_skips_parent_child_forwarding_noise() {
        let manager = AcpManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            notification_channels: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(HashMap::new())),
        };

        manager
            .push_to_history(
                "parent",
                serde_json::json!({
                    "sessionId": "parent",
                    "childAgentId": "child-1",
                    "update": { "sessionUpdate": "agent_message", "content": { "type": "text", "text": "delegated" } }
                }),
            )
            .await;

        let history = manager
            .get_session_history("parent")
            .await
            .unwrap_or_default();
        assert!(history.is_empty());
    }

    #[tokio::test]
    async fn emit_session_update_broadcasts_when_channel_exists() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(8);
        let manager = AcpManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            notification_channels: Arc::new(RwLock::new(HashMap::from([(
                "session-1".to_string(),
                tx,
            )]))),
            history: Arc::new(RwLock::new(HashMap::new())),
        };

        manager
            .emit_session_update(
                "session-1",
                serde_json::json!({
                    "sessionUpdate": "turn_complete",
                    "stopReason": "cancelled"
                }),
            )
            .await
            .expect("emit should succeed");

        let broadcast = rx.recv().await.expect("broadcast event");
        assert_eq!(
            broadcast["params"]["update"]["sessionUpdate"].as_str(),
            Some("turn_complete")
        );
        assert_eq!(
            broadcast["params"]["update"]["stopReason"].as_str(),
            Some("cancelled")
        );
    }

    #[tokio::test]
    async fn emit_session_update_persists_history_without_channel() {
        let manager = AcpManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            notification_channels: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(HashMap::new())),
        };

        manager
            .emit_session_update(
                "session-1",
                serde_json::json!({
                    "sessionUpdate": "turn_complete",
                    "stopReason": "cancelled"
                }),
            )
            .await
            .expect("emit should succeed");

        let history = manager
            .get_session_history("session-1")
            .await
            .expect("history should exist");
        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0]["update"]["sessionUpdate"].as_str(),
            Some("turn_complete")
        );
    }

    #[test]
    fn rewrite_notification_session_id_overrides_provider_session_id() {
        let rewritten = AcpManager::rewrite_notification_session_id(
            "child-session",
            serde_json::json!({
                "sessionId": "provider-session",
                "update": { "sessionUpdate": "agent_message_chunk", "content": { "text": "hi" } }
            }),
        );

        assert_eq!(rewritten["sessionId"].as_str(), Some("child-session"));
    }

    #[test]
    fn truncate_content_handles_unicode_boundaries() {
        assert_eq!(truncate_content("你好世界ABC", 5), "你好...");
        assert_eq!(truncate_content("你好世界ABC", 3), "你好世");
        assert_eq!(truncate_content("短文本", 10), "短文本");
    }
}
