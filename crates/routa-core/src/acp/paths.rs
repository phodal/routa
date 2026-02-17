//! ACP installation paths management.
//!
//! Manages directory structure for locally installed ACP agents:
//!   - Base directory: `{data_dir}/acp-agents/`
//!   - Agent binaries: `{base}/{agentId}/{version}/`
//!   - Downloads: `{base}/.downloads/{agentId}/{version}/`
//!   - Runtimes: `{base}/.runtimes/{runtime}/{version}/`
//!   - Icons: `{base}/.icons/`
//!   - Registry cache: `{base}/registry.json`
//!   - Installed state: `{base}/installed.json`

use std::path::PathBuf;

/// ACP paths manager for local agent installation.
#[derive(Debug, Clone)]
pub struct AcpPaths {
    base_dir: PathBuf,
}

impl AcpPaths {
    /// Create a new AcpPaths instance using the system data directory.
    pub fn new() -> Self {
        let base_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("acp-agents");
        Self { base_dir }
    }

    /// Create AcpPaths with a custom base directory (for testing).
    pub fn with_base_dir(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    /// Get the base directory for all ACP agent data.
    pub fn base_dir(&self) -> &PathBuf {
        &self.base_dir
    }

    /// Get the directory for a specific agent.
    pub fn agent_dir(&self, agent_id: &str) -> PathBuf {
        self.base_dir.join(agent_id)
    }

    /// Get the directory for a specific agent version.
    pub fn agent_version_dir(&self, agent_id: &str, version: &str) -> PathBuf {
        self.agent_dir(agent_id).join(version)
    }

    /// Get the downloads directory.
    pub fn downloads_dir(&self) -> PathBuf {
        self.base_dir.join(".downloads")
    }

    /// Get the download directory for a specific agent version.
    pub fn agent_download_dir(&self, agent_id: &str, version: &str) -> PathBuf {
        self.downloads_dir().join(agent_id).join(version)
    }

    /// Get the runtimes directory.
    pub fn runtimes_dir(&self) -> PathBuf {
        self.base_dir.join(".runtimes")
    }

    /// Get the directory for a specific runtime.
    pub fn runtime_dir(&self, runtime: &str, version: &str) -> PathBuf {
        self.runtimes_dir().join(runtime).join(version)
    }

    /// Get the icons directory.
    pub fn icons_dir(&self) -> PathBuf {
        self.base_dir.join(".icons")
    }

    /// Get the path to the registry cache file.
    pub fn registry_cache_path(&self) -> PathBuf {
        self.base_dir.join("registry.json")
    }

    /// Get the path to the installed agents state file.
    pub fn installed_state_path(&self) -> PathBuf {
        self.base_dir.join("installed.json")
    }

    /// Ensure all required directories exist.
    pub fn ensure_directories(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.base_dir)?;
        std::fs::create_dir_all(self.downloads_dir())?;
        std::fs::create_dir_all(self.runtimes_dir())?;
        std::fs::create_dir_all(self.icons_dir())?;
        Ok(())
    }

    /// Get the current platform target string.
    /// Returns format like "darwin-aarch64", "darwin-x86_64", "linux-x86_64", etc.
    pub fn current_platform() -> String {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        let os_name = match os {
            "macos" => "darwin",
            "linux" => "linux",
            "windows" => "windows",
            other => other,
        };

        let arch_name = match arch {
            "aarch64" => "aarch64",
            "x86_64" => "x86_64",
            "x86" => "x86",
            other => other,
        };

        format!("{}-{}", os_name, arch_name)
    }
}

impl Default for AcpPaths {
    fn default() -> Self {
        Self::new()
    }
}

