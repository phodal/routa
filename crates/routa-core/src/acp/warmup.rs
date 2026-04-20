//! ACP Warmup Service
//!
//! Mirrors the Kotlin `AcpWarmupService` from the IntelliJ plugin.
//!
//! Pre-warms ACP agents (npx or uvx packages) in the background after
//! installation so that the first real launch is instant instead of
//! waiting for the npm / PyPI package download.
//!
//! Warmup commands:
//!   - npx agent: `npx -y <package>`   → pre-caches the npm package
//!   - uvx agent: `uvx <package>`      → pre-downloads Python + pack

use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::RwLock;

use super::paths::AcpPaths;
use super::registry_fetch::fetch_registry;
use super::runtime_manager::{AcpRuntimeManager, RuntimeType};
#[cfg(windows)]
use super::CREATE_NO_WINDOW;

// ─── Constants ─────────────────────────────────────────────────────────────

const PREWARM_TIMEOUT_SECS: u64 = 5 * 60; // 5 minutes

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WarmupState {
    Idle,
    Warming,
    Warm,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarmupStatus {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub state: WarmupState,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(rename = "finishedAt", skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl WarmupStatus {
    fn idle(agent_id: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            state: WarmupState::Idle,
            started_at: None,
            finished_at: None,
            error: None,
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ─── AcpWarmupService ─────────────────────────────────────────────────────

/// Manages pre-warming of npx/uvx agent packages.
pub struct AcpWarmupService {
    paths: AcpPaths,
    states: Arc<RwLock<HashMap<String, WarmupStatus>>>,
}

impl AcpWarmupService {
    pub fn new(paths: AcpPaths) -> Self {
        Self {
            paths,
            states: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn make_runtime_manager(&self) -> AcpRuntimeManager {
        AcpRuntimeManager::new(self.paths.clone())
    }

    // ── Public Queries ─────────────────────────────────────────────────

    pub async fn is_warming_up(&self, agent_id: &str) -> bool {
        self.states
            .read()
            .await
            .get(agent_id)
            .map(|s| s.state == WarmupState::Warming)
            .unwrap_or(false)
    }

    pub async fn is_warmed_up(&self, agent_id: &str) -> bool {
        self.states
            .read()
            .await
            .get(agent_id)
            .map(|s| s.state == WarmupState::Warm)
            .unwrap_or(false)
    }

    pub async fn needs_warmup(&self, agent_id: &str) -> bool {
        matches!(
            self.states.read().await.get(agent_id).map(|s| &s.state),
            None | Some(WarmupState::Idle) | Some(WarmupState::Failed)
        )
    }

    pub async fn get_status(&self, agent_id: &str) -> WarmupStatus {
        self.states
            .read()
            .await
            .get(agent_id)
            .cloned()
            .unwrap_or_else(|| WarmupStatus::idle(agent_id))
    }

    pub async fn get_all_statuses(&self) -> Vec<WarmupStatus> {
        self.states.read().await.values().cloned().collect()
    }

    // ── Warmup ─────────────────────────────────────────────────────────

    /// Trigger warmup for `agent_id` in a background tokio task.
    /// Safe to call multiple times — does nothing if already warming/warm.
    pub async fn warmup_in_background(&self, agent_id: &str) {
        if !self.needs_warmup(agent_id).await {
            return;
        }
        let agent_id = agent_id.to_string();
        let states = self.states.clone();
        let paths = self.paths.clone();
        tokio::spawn(async move {
            let tmp = AcpWarmupService { paths, states };
            let _ = tmp.warmup(&agent_id).await;
        });
    }

    /// Await warmup completion.
    /// Returns `Ok(true)` when warmup successfully completed, `Ok(false)` on failure.
    pub async fn warmup(&self, agent_id: &str) -> Result<bool, String> {
        if !self.needs_warmup(agent_id).await {
            return Ok(self.is_warmed_up(agent_id).await);
        }

        self.set_state(
            agent_id,
            WarmupStatus {
                agent_id: agent_id.to_string(),
                state: WarmupState::Warming,
                started_at: Some(now_secs()),
                finished_at: None,
                error: None,
            },
        )
        .await;

        let result = self.run_warmup(agent_id).await;

        let (state, error) = match &result {
            Ok(true) => (WarmupState::Warm, None),
            Ok(false) => (WarmupState::Failed, None),
            Err(e) => (WarmupState::Failed, Some(e.clone())),
        };

        self.set_state(
            agent_id,
            WarmupStatus {
                agent_id: agent_id.to_string(),
                state,
                started_at: None,
                finished_at: Some(now_secs()),
                error,
            },
        )
        .await;

        result.map_err(|_| "Warmup failed".to_string())
    }

    // ── Internal ───────────────────────────────────────────────────────

    async fn run_warmup(&self, agent_id: &str) -> Result<bool, String> {
        // Fetch agent from registry
        let registry = fetch_registry()
            .await
            .map_err(|e| format!("Registry fetch failed: {e}"))?;

        let agent = registry
            .agents
            .iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| format!("Agent '{agent_id}' not found in registry"))?
            .clone();

        let dist = &agent.distribution;

        // npx agent
        if let Some(npx_dist) = dist.npx.as_ref() {
            let package = npx_dist.package.clone();

            let runtime_info = self
                .make_runtime_manager()
                .ensure_runtime(&RuntimeType::Npx)
                .await?;

            return self
                .execute_prewarm_command("npx", &runtime_info.path, &package)
                .await;
        }

        // uvx agent
        if let Some(uvx_dist) = dist.uvx.as_ref() {
            let package = uvx_dist.package.clone();

            let runtime_info = self
                .make_runtime_manager()
                .ensure_runtime(&RuntimeType::Uvx)
                .await?;

            return self
                .execute_prewarm_command("uvx", &runtime_info.path, &package)
                .await;
        }

        // Binary — no warmup needed
        tracing::info!("[AcpWarmup] Agent {} is binary, no warmup needed", agent_id);
        Ok(true)
    }

    /// Execute the prewarm command with PREWARM_TIMEOUT_SECS timeout.
    pub async fn execute_prewarm_command(
        &self,
        runner: &str,
        runtime_path: &std::path::Path,
        package_name: &str,
    ) -> Result<bool, String> {
        let args: Vec<&str> = if runner == "npx" {
            vec!["-y", package_name]
        } else {
            // uvx: run with --help to trigger package download
            vec![package_name, "--help"]
        };

        tracing::info!(
            "[AcpWarmup] Pre-warming {} package: {} (via {:?})",
            runner,
            package_name,
            runtime_path
        );

        let runtime_dir = runtime_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut cmd = Command::new(runtime_path);
        cmd.args(&args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        #[cfg(windows)]
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);

        // Prepend runtime dir to PATH
        if let Ok(path_env) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ";" } else { ":" };
            cmd.env("PATH", format!("{runtime_dir}{sep}{path_env}"));
        }

        let child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

        match tokio::time::timeout(
            std::time::Duration::from_secs(PREWARM_TIMEOUT_SECS),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(output)) => {
                // Non-zero exit is OK — package was likely downloaded;
                // many CLIs exit non-zero for --help
                tracing::info!(
                    "[AcpWarmup] Prewarm done for {} (exit={})",
                    package_name,
                    output.status.code().unwrap_or(-1)
                );
                Ok(true)
            }
            Ok(Err(e)) => {
                tracing::error!(
                    "[AcpWarmup] Prewarm command error for {}: {}",
                    package_name,
                    e
                );
                Err(e.to_string())
            }
            Err(_) => {
                tracing::warn!(
                    "[AcpWarmup] Prewarm timed out after {}s for {}",
                    PREWARM_TIMEOUT_SECS,
                    package_name
                );
                Ok(false)
            }
        }
    }

    async fn set_state(&self, agent_id: &str, status: WarmupStatus) {
        self.states
            .write()
            .await
            .insert(agent_id.to_string(), status);
    }
}
