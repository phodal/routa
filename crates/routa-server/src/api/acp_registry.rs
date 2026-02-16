//! ACP Registry API Routes
//!
//! GET  /api/acp/registry           - List all agents with status
//! GET  /api/acp/registry?id=x      - Get specific agent details
//! POST /api/acp/registry           - Force refresh registry cache
//!
//! POST   /api/acp/install          - Install an agent
//! DELETE /api/acp/install          - Uninstall an agent

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::acp::{AcpPaths, DistributionType};
use crate::error::ServerError;
use crate::shell_env;
use crate::state::AppState;

/// ACP Registry URL
const ACP_REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/registry", get(get_registry).post(refresh_registry))
        .route("/install", post(install_agent).delete(uninstall_agent))
}

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RegistryQuery {
    id: Option<String>,
    refresh: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistryAgent {
    id: String,
    name: String,
    version: String,
    description: String,
    repository: Option<String>,
    authors: Vec<String>,
    license: String,
    icon: Option<String>,
    distribution: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct AcpRegistry {
    version: String,
    agents: Vec<RegistryAgent>,
}

#[derive(Debug, Serialize)]
struct AgentWithStatus {
    agent: RegistryAgent,
    installed: bool,
    #[serde(rename = "distributionTypes")]
    distribution_types: Vec<String>,
}

#[derive(Debug, Serialize)]
struct RegistryResponse {
    agents: Vec<AgentWithStatus>,
    platform: Option<String>,
    #[serde(rename = "runtimeAvailability")]
    runtime_availability: RuntimeAvailability,
}

#[derive(Debug, Serialize)]
struct RuntimeAvailability {
    npx: bool,
    uvx: bool,
}

#[derive(Debug, Deserialize)]
struct InstallRequest {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "distributionType")]
    distribution_type: Option<String>,
}

// ─── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/acp/registry - List all agents with installation status
async fn get_registry(
    State(state): State<AppState>,
    Query(query): Query<RegistryQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Load installation state from disk
    let _ = state.acp_installation_state.load().await;

    // Fetch registry from CDN
    let registry = fetch_registry().await?;

    // Check runtime availability
    let npx_available = shell_env::which("npx").is_some();
    let uvx_available = shell_env::which("uv").is_some();

    // If specific agent requested
    if let Some(agent_id) = query.id {
        if let Some(agent) = registry.agents.into_iter().find(|a| a.id == agent_id) {
            let dist_types = get_distribution_types(&agent.distribution);
            let installed = state.acp_installation_state.is_installed(&agent.id).await
                || check_agent_installed(&agent, npx_available, uvx_available);
            return Ok(Json(serde_json::json!({
                "agent": agent,
                "installed": installed,
                "platform": detect_platform(),
                "distributionTypes": dist_types,
            })));
        } else {
            return Err(ServerError::NotFound(format!(
                "Agent '{}' not found",
                agent_id
            )));
        }
    }

    // List all agents with status
    let mut agents_with_status = Vec::new();
    for agent in registry.agents {
        let dist_types = get_distribution_types(&agent.distribution);
        let installed = state.acp_installation_state.is_installed(&agent.id).await
            || check_agent_installed(&agent, npx_available, uvx_available);
        agents_with_status.push(AgentWithStatus {
            agent,
            installed,
            distribution_types: dist_types,
        });
    }

    Ok(Json(serde_json::json!({
        "agents": agents_with_status,
        "platform": detect_platform(),
        "runtimeAvailability": {
            "npx": npx_available,
            "uvx": uvx_available,
        }
    })))
}



/// POST /api/acp/install - Install an agent
async fn install_agent(
    State(state): State<AppState>,
    Json(req): Json<InstallRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let registry = fetch_registry().await?;

    let agent = registry
        .agents
        .into_iter()
        .find(|a| a.id == req.agent_id)
        .ok_or_else(|| {
            ServerError::NotFound(format!("Agent '{}' not found in registry", req.agent_id))
        })?;

    let dist_types = get_distribution_types(&agent.distribution);
    let npx_available = shell_env::which("npx").is_some();
    let uvx_available = shell_env::which("uv").is_some();

    // Determine distribution type to use
    let dist_type = req.distribution_type.unwrap_or_else(|| {
        if dist_types.contains(&"npx".to_string()) && npx_available {
            "npx".to_string()
        } else if dist_types.contains(&"uvx".to_string()) && uvx_available {
            "uvx".to_string()
        } else if dist_types.contains(&"binary".to_string()) {
            "binary".to_string()
        } else {
            "npx".to_string()
        }
    });

    tracing::info!(
        "[ACP Install] Installing agent: {} via {}",
        req.agent_id,
        dist_type
    );

    let version = if agent.version.is_empty() {
        "latest".to_string()
    } else {
        agent.version.clone()
    };

    match dist_type.as_str() {
        "npx" => {
            // For npx, mark installed (runs on demand via npx)
            let package = agent.distribution.get("npx")
                .and_then(|v| v.get("package"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            state.acp_installation_state
                .mark_installed(&req.agent_id, &version, DistributionType::Npx, None, package)
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {}", e)))?;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "message": format!("Agent '{}' configured for npx (runs on demand)", agent.name)
            })))
        }
        "uvx" => {
            // For uvx, mark installed (runs on demand via uvx)
            let package = agent.distribution.get("uvx")
                .and_then(|v| v.get("package"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            state.acp_installation_state
                .mark_installed(&req.agent_id, &version, DistributionType::Uvx, None, package)
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {}", e)))?;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "message": format!("Agent '{}' configured for uvx (runs on demand)", agent.name)
            })))
        }
        "binary" => {
            // For binary, download and extract
            let platform = AcpPaths::current_platform();
            let binary_config = agent.distribution.get("binary")
                .and_then(|v| v.get(&platform))
                .ok_or_else(|| ServerError::BadRequest(format!(
                    "No binary available for platform: {}", platform
                )))?;

            let binary_info: crate::acp::BinaryInfo = serde_json::from_value(binary_config.clone())
                .map_err(|e| ServerError::Internal(format!("Failed to parse binary info: {}", e)))?;

            let exe_path = state.acp_binary_manager
                .install_binary(&req.agent_id, &version, &binary_info)
                .await
                .map_err(|e| ServerError::Internal(format!("Binary installation failed: {}", e)))?;

            let exe_path_str = exe_path.to_string_lossy().to_string();
            state.acp_installation_state
                .mark_installed(
                    &req.agent_id,
                    &version,
                    DistributionType::Binary,
                    Some(exe_path_str.clone()),
                    None,
                )
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {}", e)))?;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "installedPath": exe_path_str,
                "message": format!("Agent '{}' binary installed successfully", agent.name)
            })))
        }
        _ => Err(ServerError::BadRequest(format!(
            "Unknown distribution type: {}",
            dist_type
        ))),
    }
}

/// DELETE /api/acp/install - Uninstall an agent
async fn uninstall_agent(
    State(state): State<AppState>,
    Json(req): Json<InstallRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    tracing::info!("[ACP Install] Uninstalling agent: {}", req.agent_id);

    // Check if installed and get type
    if let Some(info) = state.acp_installation_state.get_installed_info(&req.agent_id).await {
        if info.dist_type == DistributionType::Binary {
            // Remove binary files
            state.acp_binary_manager.uninstall(&req.agent_id).await
                .map_err(|e| ServerError::Internal(format!("Failed to remove binary: {}", e)))?;
        }
    }

    // Remove from installation state
    state.acp_installation_state.uninstall(&req.agent_id).await
        .map_err(|e| ServerError::Internal(format!("Failed to update state: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "agentId": req.agent_id,
        "message": format!("Agent '{}' uninstalled", req.agent_id)
    })))
}

// ─── Helper Functions ──────────────────────────────────────────────────────

/// Fetch the ACP registry from CDN
async fn fetch_registry() -> Result<AcpRegistry, ServerError> {
    let response = reqwest::get(ACP_REGISTRY_URL)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to fetch registry: {}", e)))?;

    if !response.status().is_success() {
        return Err(ServerError::Internal(format!(
            "Registry fetch failed: {}",
            response.status()
        )));
    }

    let registry: AcpRegistry = response
        .json()
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to parse registry: {}", e)))?;

    Ok(registry)
}

/// Get distribution types from agent distribution config
fn get_distribution_types(distribution: &serde_json::Value) -> Vec<String> {
    let mut types = Vec::new();
    if distribution.get("npx").is_some() {
        types.push("npx".to_string());
    }
    if distribution.get("uvx").is_some() {
        types.push("uvx".to_string());
    }
    if distribution.get("binary").is_some() {
        types.push("binary".to_string());
    }
    types
}

/// Check if an agent is installed/available
fn check_agent_installed(agent: &RegistryAgent, npx_available: bool, uvx_available: bool) -> bool {
    let dist = &agent.distribution;

    // npx agents are "installed" if npx is available
    if dist.get("npx").is_some() && npx_available {
        return true;
    }

    // uvx agents are "installed" if uvx is available
    if dist.get("uvx").is_some() && uvx_available {
        return true;
    }

    // Binary agents would need to check if the binary exists
    // For now, return false for binary-only agents
    false
}

/// Detect the current platform
fn detect_platform() -> Option<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let platform = match (os, arch) {
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        ("linux", "x86_64") => "linux-x86_64",
        ("windows", "aarch64") => "windows-aarch64",
        ("windows", "x86_64") => "windows-x86_64",
        _ => return None,
    };

    Some(platform.to_string())
}

/// POST /api/acp/registry - Force refresh registry cache
async fn refresh_registry(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let registry = fetch_registry().await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "version": registry.version,
        "agentCount": registry.agents.len(),
        "message": "Registry cache refreshed"
    })))
}
