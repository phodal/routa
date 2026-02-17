//! ACP Registry types for agent metadata and distribution.
//!
//! These types match the ACP registry JSON schema from:
//! https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The root registry containing all available agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpRegistry {
    #[serde(default)]
    pub version: Option<String>,
    pub agents: Vec<AcpAgentEntry>,
}

/// An agent entry in the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpAgentEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub distribution: AcpDistribution,
}

/// Distribution information for an agent.
/// The actual registry uses npx/uvx/binary as optional fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpDistribution {
    /// NPX distribution info
    #[serde(default)]
    pub npx: Option<NpxDistribution>,
    /// UVX distribution info
    #[serde(default)]
    pub uvx: Option<UvxDistribution>,
    /// Binary distribution info (platform -> binary info)
    #[serde(default)]
    pub binary: Option<HashMap<String, BinaryInfo>>,
}

/// NPX distribution info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpxDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// UVX distribution info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvxDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// Distribution type for an agent (used internally).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DistributionType {
    Npx,
    Uvx,
    Binary,
}

/// Binary distribution info for a specific platform.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInfo {
    /// Archive URL to download
    #[serde(alias = "url")]
    pub archive: String,
    /// Command to run after extraction
    #[serde(default, alias = "executable")]
    pub cmd: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

/// Information about an installed agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgentInfo {
    pub agent_id: String,
    pub version: String,
    pub dist_type: DistributionType,
    pub installed_at: String,
    /// Path to the installed binary (for binary type)
    #[serde(default)]
    pub binary_path: Option<String>,
    /// Package name (for npx/uvx type)
    #[serde(default)]
    pub package: Option<String>,
}

/// State of all installed agents.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgentsState {
    pub agents: HashMap<String, InstalledAgentInfo>,
}

impl AcpDistribution {
    /// Get the distribution type.
    pub fn dist_type(&self) -> Option<DistributionType> {
        if self.npx.is_some() {
            Some(DistributionType::Npx)
        } else if self.uvx.is_some() {
            Some(DistributionType::Uvx)
        } else if self.binary.is_some() {
            Some(DistributionType::Binary)
        } else {
            None
        }
    }
}

impl AcpAgentEntry {
    /// Get the distribution type for this agent.
    pub fn dist_type(&self) -> Option<DistributionType> {
        self.distribution.dist_type()
    }

    /// Get the command to run this agent.
    pub fn get_command(&self, binary_path: Option<&str>) -> Option<(String, Vec<String>)> {
        if let Some(ref npx) = self.distribution.npx {
            let mut args = vec!["-y".to_string(), npx.package.clone()];
            args.extend(npx.args.clone());
            return Some(("npx".to_string(), args));
        }
        if let Some(ref uvx) = self.distribution.uvx {
            let mut args = vec![uvx.package.clone()];
            args.extend(uvx.args.clone());
            return Some(("uvx".to_string(), args));
        }
        if self.distribution.binary.is_some() {
            let path = binary_path?;
            return Some((path.to_string(), vec![]));
        }
        None
    }

    /// Check if this agent has a binary for the current platform.
    pub fn has_binary_for_platform(&self, platform: &str) -> bool {
        self.distribution
            .binary
            .as_ref()
            .map(|b| b.contains_key(platform))
            .unwrap_or(false)
    }

    /// Get the binary info for a specific platform.
    pub fn get_binary_info(&self, platform: &str) -> Option<&BinaryInfo> {
        self.distribution.binary.as_ref()?.get(platform)
    }

    /// Get the package name for npx/uvx distributions.
    pub fn get_package(&self) -> Option<String> {
        if let Some(ref npx) = self.distribution.npx {
            return Some(npx.package.clone());
        }
        if let Some(ref uvx) = self.distribution.uvx {
            return Some(uvx.package.clone());
        }
        None
    }
}

