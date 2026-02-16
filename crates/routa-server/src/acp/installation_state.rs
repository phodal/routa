//! ACP Agent Installation State Management.
//!
//! Tracks which agents are installed locally and persists state to JSON file.

use std::sync::Arc;
use tokio::sync::RwLock;

use super::paths::AcpPaths;
use super::registry_types::{DistributionType, InstalledAgentInfo, InstalledAgentsState};

/// Manages the installation state of ACP agents.
pub struct AcpInstallationState {
    paths: AcpPaths,
    state: Arc<RwLock<InstalledAgentsState>>,
}

impl AcpInstallationState {
    /// Create a new installation state manager.
    pub fn new(paths: AcpPaths) -> Self {
        Self {
            paths,
            state: Arc::new(RwLock::new(InstalledAgentsState::default())),
        }
    }

    /// Load the installation state from disk.
    pub async fn load(&self) -> Result<(), String> {
        let path = self.paths.installed_state_path();
        if !path.exists() {
            return Ok(());
        }

        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read installed.json: {}", e))?;

        let loaded: InstalledAgentsState = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse installed.json: {}", e))?;

        *self.state.write().await = loaded;
        Ok(())
    }

    /// Save the installation state to disk.
    pub async fn save(&self) -> Result<(), String> {
        self.paths
            .ensure_directories()
            .map_err(|e| format!("Failed to create directories: {}", e))?;

        let state = self.state.read().await;
        let content = serde_json::to_string_pretty(&*state)
            .map_err(|e| format!("Failed to serialize state: {}", e))?;

        tokio::fs::write(self.paths.installed_state_path(), content)
            .await
            .map_err(|e| format!("Failed to write installed.json: {}", e))?;

        Ok(())
    }

    /// Check if an agent is installed.
    pub async fn is_installed(&self, agent_id: &str) -> bool {
        self.state.read().await.agents.contains_key(agent_id)
    }

    /// Get the installed version of an agent.
    pub async fn get_installed_version(&self, agent_id: &str) -> Option<String> {
        self.state
            .read()
            .await
            .agents
            .get(agent_id)
            .map(|info| info.version.clone())
    }

    /// Get info about an installed agent.
    pub async fn get_installed_info(&self, agent_id: &str) -> Option<InstalledAgentInfo> {
        self.state.read().await.agents.get(agent_id).cloned()
    }

    /// Get all installed agents.
    pub async fn get_all_installed(&self) -> Vec<InstalledAgentInfo> {
        self.state.read().await.agents.values().cloned().collect()
    }

    /// Mark an agent as installed.
    pub async fn mark_installed(
        &self,
        agent_id: &str,
        version: &str,
        dist_type: DistributionType,
        binary_path: Option<String>,
        package: Option<String>,
    ) -> Result<(), String> {
        let info = InstalledAgentInfo {
            agent_id: agent_id.to_string(),
            version: version.to_string(),
            dist_type,
            installed_at: chrono::Utc::now().to_rfc3339(),
            binary_path,
            package,
        };

        self.state
            .write()
            .await
            .agents
            .insert(agent_id.to_string(), info);

        self.save().await
    }

    /// Uninstall an agent (remove from state).
    pub async fn uninstall(&self, agent_id: &str) -> Result<(), String> {
        self.state.write().await.agents.remove(agent_id);
        self.save().await
    }

    /// Check if an agent has an update available.
    pub async fn has_update(&self, agent_id: &str, latest_version: &str) -> bool {
        if let Some(installed) = self.state.read().await.agents.get(agent_id) {
            installed.version != latest_version
        } else {
            false
        }
    }
}

