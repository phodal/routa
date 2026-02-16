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

pub mod binary_manager;
pub mod installation_state;
pub mod paths;
pub mod process;
pub mod registry_types;

pub use binary_manager::AcpBinaryManager;
pub use installation_state::AcpInstallationState;
pub use paths::AcpPaths;
pub use registry_types::*;

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

use process::AcpProcess;

// ─── Session Record ─────────────────────────────────────────────────────

/// Record of an active ACP session persisted for UI listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionRecord {
    pub session_id: String,
    pub cwd: String,
    pub workspace_id: String,
    pub provider: Option<String>,
    pub mode_id: Option<String>,
    pub created_at: String,
}

// ─── Managed Process ────────────────────────────────────────────────────

/// A managed ACP agent process with its metadata.
struct ManagedProcess {
    process: Arc<AcpProcess>,
    /// The agent's own session ID (returned by `session/new`).
    acp_session_id: String,
    preset_id: String,
    #[allow(dead_code)]
    created_at: String,
}

// ─── ACP Manager ────────────────────────────────────────────────────────

/// Manages ACP agent sessions and process lifecycle.
///
/// Each session maps to a long-lived child process that communicates via
/// stdio JSON-RPC. Notifications are forwarded to subscribers via broadcast.
pub struct AcpManager {
    /// Our sessionId → session record (for UI listing)
    sessions: Arc<RwLock<HashMap<String, AcpSessionRecord>>>,
    /// Our sessionId → managed process (the live agent)
    processes: Arc<RwLock<HashMap<String, ManagedProcess>>>,
    /// Our sessionId → broadcast sender for SSE notifications
    notification_channels: Arc<RwLock<HashMap<String, broadcast::Sender<serde_json::Value>>>>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            notification_channels: Arc::new(RwLock::new(HashMap::new())),
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

    /// Create a new ACP session: spawn agent process, initialize, create session.
    ///
    /// Returns `(our_session_id, agent_session_id)`.
    pub async fn create_session(
        &self,
        session_id: String,
        cwd: String,
        workspace_id: String,
        provider: Option<String>,
    ) -> Result<(String, String), String> {
        let provider_name = provider.as_deref().unwrap_or("opencode");
        let preset = get_presets()
            .into_iter()
            .find(|p| p.name == provider_name)
            .ok_or_else(|| format!("Unknown provider: {}", provider_name))?;

        // Create the notification broadcast channel for this session
        let (ntx, _) = broadcast::channel::<serde_json::Value>(256);

        // Spawn the agent process
        let process = AcpProcess::spawn(
            &preset.command,
            &preset.args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            &cwd,
            ntx.clone(),
            &preset.name,
            &session_id,
        )
        .await?;

        // Initialize the protocol
        process.initialize().await?;

        // Create the agent session
        let acp_session_id = process.new_session(&cwd).await?;

        let process = Arc::new(process);

        // Store everything
        let record = AcpSessionRecord {
            session_id: session_id.clone(),
            cwd,
            workspace_id,
            provider: Some(provider_name.to_string()),
            mode_id: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), record);

        self.processes.write().await.insert(
            session_id.clone(),
            ManagedProcess {
                process,
                acp_session_id: acp_session_id.clone(),
                preset_id: provider_name.to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        );

        self.notification_channels
            .write()
            .await
            .insert(session_id.clone(), ntx);

        tracing::info!(
            "[AcpManager] Session {} created (provider: {}, agent session: {})",
            session_id,
            provider_name,
            acp_session_id,
        );

        Ok((session_id, acp_session_id))
    }

    /// Send a prompt to an existing session's agent process.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<serde_json::Value, String> {
        let processes = self.processes.read().await;
        let managed = processes
            .get(session_id)
            .ok_or_else(|| format!("No agent process for session: {}", session_id))?;

        if !managed.process.is_alive() {
            return Err(format!(
                "ACP agent ({}) process is not running",
                managed.preset_id
            ));
        }

        managed
            .process
            .prompt(&managed.acp_session_id, text)
            .await
    }

    /// Cancel the current prompt in a session.
    pub async fn cancel(&self, session_id: &str) {
        let processes = self.processes.read().await;
        if let Some(managed) = processes.get(session_id) {
            managed.process.cancel(&managed.acp_session_id).await;
        }
    }

    /// Kill a session's agent process and remove it.
    pub async fn kill_session(&self, session_id: &str) {
        // Kill the process
        if let Some(managed) = self.processes.write().await.remove(session_id) {
            managed.process.kill().await;
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
            .map(|m| m.process.is_alive())
            .unwrap_or(false)
    }

    /// Get the preset ID for a session.
    pub async fn get_preset_id(&self, session_id: &str) -> Option<String> {
        let processes = self.processes.read().await;
        processes.get(session_id).map(|m| m.preset_id.clone())
    }
}

// ─── ACP Presets ────────────────────────────────────────────────────────

/// ACP provider presets for known coding agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPreset {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub description: String,
}

/// Get the list of known ACP agent presets.
pub fn get_presets() -> Vec<AcpPreset> {
    vec![
        AcpPreset {
            name: "opencode".to_string(),
            command: "opencode".to_string(),
            args: vec!["acp".to_string()],
            description: "OpenCode AI coding agent".to_string(),
        },
        AcpPreset {
            name: "gemini".to_string(),
            command: "gemini".to_string(),
            args: vec!["--experimental-acp".to_string()],
            description: "Google Gemini CLI".to_string(),
        },
        AcpPreset {
            name: "codex-acp".to_string(),
            command: "codex-acp".to_string(),
            args: vec![],
            description: "OpenAI Codex CLI (codex-acp wrapper)".to_string(),
        },
        AcpPreset {
            name: "copilot".to_string(),
            command: "copilot".to_string(),
            args: vec!["--acp".to_string()],
            description: "GitHub Copilot CLI".to_string(),
        },
        AcpPreset {
            name: "auggie".to_string(),
            command: "auggie".to_string(),
            args: vec!["--acp".to_string()],
            description: "Augment Code's AI agent".to_string(),
        },
        AcpPreset {
            name: "kimi".to_string(),
            command: "kimi".to_string(),
            args: vec!["acp".to_string()],
            description: "Moonshot AI's Kimi CLI".to_string(),
        },
        AcpPreset {
            name: "claude".to_string(),
            command: "claude".to_string(),
            args: vec!["--acp".to_string()],
            description: "Anthropic Claude Code".to_string(),
        },
    ]
}
