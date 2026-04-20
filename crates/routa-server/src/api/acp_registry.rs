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

use crate::acp::{get_presets, AcpPaths, DistributionType, RuntimeType, WarmupStatus};
use crate::error::ServerError;
use crate::shell_env;
use crate::state::AppState;

/// ACP Registry URL
const ACP_REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/registry", get(get_registry).post(refresh_registry))
        .route("/install", post(install_agent).delete(uninstall_agent))
        .route("/runtime", get(get_runtime_status).post(ensure_runtime))
        .route("/warmup", get(get_warmup_status).post(warmup_agent))
}

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RegistryQuery {
    id: Option<String>,
    #[allow(dead_code)]
    refresh: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryAgent {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub repository: Option<String>,
    pub authors: Vec<String>,
    pub license: String,
    pub icon: Option<String>,
    pub distribution: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AcpRegistry {
    pub version: String,
    pub agents: Vec<RegistryAgent>,
}

#[derive(Debug, Serialize)]
struct AgentWithStatus {
    agent: RegistryAgent,
    available: bool,
    installed: bool,
    uninstallable: bool,
    #[serde(rename = "distributionTypes")]
    distribution_types: Vec<String>,
    source: &'static str,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct RegistryResponse {
    agents: Vec<AgentWithStatus>,
    platform: Option<String>,
    #[serde(rename = "runtimeAvailability")]
    runtime_availability: RuntimeAvailability,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
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
            let status = get_agent_status(&state, &agent, npx_available, uvx_available).await;
            return Ok(Json(serde_json::json!({
                "agent": agent,
                "available": status.available,
                "installed": status.installed,
                "uninstallable": status.uninstallable,
                "platform": detect_platform(),
                "distributionType": status.resolved_distribution_type,
            })));
        } else {
            return Err(ServerError::NotFound(format!(
                "Agent '{agent_id}' not found"
            )));
        }
    }

    // List all agents with status
    let registry_ids: std::collections::HashSet<String> = registry
        .agents
        .iter()
        .map(|agent| agent.id.clone())
        .collect();
    let mut agents_with_status = Vec::new();
    for agent in registry.agents {
        let dist_types = get_distribution_types(&agent.distribution);
        let status = get_agent_status(&state, &agent, npx_available, uvx_available).await;
        agents_with_status.push(AgentWithStatus {
            agent,
            available: status.available,
            installed: status.installed,
            uninstallable: status.uninstallable,
            distribution_types: dist_types,
            source: "registry",
        });
    }

    for preset in get_presets() {
        if preset.id == "claude" {
            continue;
        }
        if registry_ids.contains(&preset.id) {
            continue;
        }

        let resolved =
            resolve_preset_command(&preset).and_then(|command| shell_env::which(&command));
        agents_with_status.push(AgentWithStatus {
            agent: RegistryAgent {
                id: preset.id,
                name: preset.name,
                version: String::new(),
                description: preset.description,
                repository: None,
                authors: vec![],
                license: String::new(),
                icon: None,
                distribution: serde_json::json!({}),
            },
            available: resolved.is_some(),
            installed: resolved.is_some(),
            uninstallable: false,
            distribution_types: vec![],
            source: "builtin",
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
            // Ensure we have a Node.js / npx runtime (managed download if system npx absent)
            let npx_system = shell_env::which("npx").is_some();
            if !npx_system {
                tracing::info!("[ACP Install] npx not found on PATH — downloading managed Node.js");
                state
                    .acp_runtime_manager
                    .ensure_runtime(&RuntimeType::Npx)
                    .await
                    .map_err(|e| {
                        ServerError::Internal(format!("Failed to ensure npx runtime: {e}"))
                    })?;
            }

            // For npx, mark installed (runs on demand via npx)
            let package = agent
                .distribution
                .get("npx")
                .and_then(|v| v.get("package"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            state
                .acp_installation_state
                .mark_installed(
                    &req.agent_id,
                    &version,
                    DistributionType::Npx,
                    None,
                    package,
                )
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {e}")))?;

            // Trigger background warmup to pre-cache the npm package
            state
                .acp_warmup_service
                .warmup_in_background(&req.agent_id)
                .await;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "message": format!("Agent '{}' configured for npx (warmup started)", agent.name)
            })))
        }
        "uvx" => {
            // Ensure we have a uv / uvx runtime (managed download if system uv absent)
            let uvx_system = shell_env::which("uv").is_some();
            if !uvx_system {
                tracing::info!("[ACP Install] uv not found on PATH — downloading managed uv");
                state
                    .acp_runtime_manager
                    .ensure_runtime(&RuntimeType::Uvx)
                    .await
                    .map_err(|e| {
                        ServerError::Internal(format!("Failed to ensure uvx runtime: {e}"))
                    })?;
            }

            // For uvx, mark installed (runs on demand via uvx)
            let package = agent
                .distribution
                .get("uvx")
                .and_then(|v| v.get("package"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            state
                .acp_installation_state
                .mark_installed(
                    &req.agent_id,
                    &version,
                    DistributionType::Uvx,
                    None,
                    package,
                )
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {e}")))?;

            // Trigger background warmup to pre-cache the Python package
            state
                .acp_warmup_service
                .warmup_in_background(&req.agent_id)
                .await;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "message": format!("Agent '{}' configured for uvx (warmup started)", agent.name)
            })))
        }
        "binary" => {
            // For binary, download and extract
            let platform = AcpPaths::current_platform();
            let binary_config = agent
                .distribution
                .get("binary")
                .and_then(|v| v.get(&platform))
                .ok_or_else(|| {
                    ServerError::BadRequest(format!("No binary available for platform: {platform}"))
                })?;

            let binary_info: crate::acp::BinaryInfo = serde_json::from_value(binary_config.clone())
                .map_err(|e| ServerError::Internal(format!("Failed to parse binary info: {e}")))?;

            let exe_path = state
                .acp_binary_manager
                .install_binary(&req.agent_id, &version, &binary_info)
                .await
                .map_err(|e| ServerError::Internal(format!("Binary installation failed: {e}")))?;

            let exe_path_str = exe_path.to_string_lossy().to_string();
            state
                .acp_installation_state
                .mark_installed(
                    &req.agent_id,
                    &version,
                    DistributionType::Binary,
                    Some(exe_path_str.clone()),
                    None,
                )
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to save state: {e}")))?;

            Ok(Json(serde_json::json!({
                "success": true,
                "agentId": req.agent_id,
                "distributionType": dist_type,
                "installedPath": exe_path_str,
                "message": format!("Agent '{}' binary installed successfully", agent.name)
            })))
        }
        _ => Err(ServerError::BadRequest(format!(
            "Unknown distribution type: {dist_type}"
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
    if let Some(info) = state
        .acp_installation_state
        .get_installed_info(&req.agent_id)
        .await
    {
        if info.dist_type == DistributionType::Binary {
            // Remove binary files
            state
                .acp_binary_manager
                .uninstall(&req.agent_id)
                .await
                .map_err(|e| ServerError::Internal(format!("Failed to remove binary: {e}")))?;
        }
    }

    // Remove from installation state
    state
        .acp_installation_state
        .uninstall(&req.agent_id)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to update state: {e}")))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "agentId": req.agent_id,
        "message": format!("Agent '{}' uninstalled", req.agent_id)
    })))
}

// ─── Helper Functions ──────────────────────────────────────────────────────

/// Fetch the ACP registry from CDN
pub async fn fetch_registry() -> Result<AcpRegistry, ServerError> {
    let response = reqwest::get(ACP_REGISTRY_URL)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to fetch registry: {e}")))?;

    if !response.status().is_success() {
        return Err(ServerError::Internal(format!(
            "Registry fetch failed: {}",
            response.status()
        )));
    }

    let registry: AcpRegistry = response
        .json()
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to parse registry: {e}")))?;

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

#[derive(Debug)]
struct RegistryAgentStatus {
    available: bool,
    installed: bool,
    uninstallable: bool,
    resolved_distribution_type: Option<&'static str>,
}

async fn get_agent_status(
    state: &AppState,
    agent: &RegistryAgent,
    npx_available: bool,
    uvx_available: bool,
) -> RegistryAgentStatus {
    let installed_info = state
        .acp_installation_state
        .get_installed_info(&agent.id)
        .await;

    if let Some(info) = installed_info {
        if info.dist_type == DistributionType::Binary {
            return RegistryAgentStatus {
                available: true,
                installed: true,
                uninstallable: true,
                resolved_distribution_type: Some("binary"),
            };
        }
    }

    let dist = &agent.distribution;
    if dist.get("npx").is_some() && npx_available {
        return RegistryAgentStatus {
            available: true,
            installed: false,
            uninstallable: false,
            resolved_distribution_type: Some("npx"),
        };
    }

    if dist.get("uvx").is_some() && uvx_available {
        return RegistryAgentStatus {
            available: true,
            installed: false,
            uninstallable: false,
            resolved_distribution_type: Some("uvx"),
        };
    }

    RegistryAgentStatus {
        available: false,
        installed: false,
        uninstallable: false,
        resolved_distribution_type: None,
    }
}

fn resolve_preset_command(preset: &crate::acp::AcpPreset) -> Option<String> {
    if let Some(env_var) = &preset.env_bin_override {
        if let Ok(value) = std::env::var(env_var) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    let trimmed = preset.command.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Detect the current platform
pub fn detect_platform() -> Option<String> {
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

// ─── Runtime handlers ──────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct EnsureRuntimeRequest {
    /// Which runtime to ensure: "node", "npx", "uv", or "uvx"
    runtime: String,
}

/// GET /api/acp/runtime — Show current Node.js / uv runtime status.
async fn get_runtime_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    use crate::acp::runtime_manager::current_platform;

    let rm = &state.acp_runtime_manager;
    let platform = current_platform();

    // Check version for each runtime too
    let check_with_version = |rt: RuntimeType| async move {
        let managed = rm.get_managed_runtime(&rt).await;
        let system = rm.get_system_runtime(&rt);
        let version = rm.get_version(&rt).await;
        serde_json::json!({
            "available": managed.is_some() || system.is_some(),
            "managed": managed.as_ref().map(|i| i.path.to_string_lossy().to_string()),
            "system":  system.as_ref().map(|i| i.path.to_string_lossy().to_string()),
            "version": version,
        })
    };

    let (node, npx, uv, uvx) = tokio::join!(
        check_with_version(RuntimeType::Node),
        check_with_version(RuntimeType::Npx),
        check_with_version(RuntimeType::Uv),
        check_with_version(RuntimeType::Uvx),
    );

    Ok(Json(serde_json::json!({
        "platform": platform,
        "runtimes": {
            "node": node,
            "npx":  npx,
            "uv":   uv,
            "uvx":  uvx,
        }
    })))
}

/// POST /api/acp/runtime — Ensure (and possibly download) a managed runtime.
///
/// Body: `{ "runtime": "node" | "npx" | "uv" | "uvx" }`
async fn ensure_runtime(
    State(state): State<AppState>,
    Json(req): Json<EnsureRuntimeRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let rt = match req.runtime.as_str() {
        "node" => RuntimeType::Node,
        "npx" => RuntimeType::Npx,
        "uv" => RuntimeType::Uv,
        "uvx" => RuntimeType::Uvx,
        other => {
            return Err(ServerError::BadRequest(format!(
                "Unknown runtime '{other}'. Use node, npx, uv, or uvx."
            )));
        }
    };

    tracing::info!("[ACP Runtime] Ensuring runtime: {:?}", rt);
    let info = state
        .acp_runtime_manager
        .ensure_runtime(&rt)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to ensure runtime: {e}")))?;

    // Get actual version string
    let version = state.acp_runtime_manager.get_version(&rt).await;

    Ok(Json(serde_json::json!({
        "success": true,
        "runtime": req.runtime,
        "path": info.path.to_string_lossy(),
        "version": version.or(info.version),
        "managed": info.is_managed,
    })))
}

// ─── Warmup handlers ───────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct WarmupRequest {
    #[serde(rename = "agentId")]
    agent_id: String,
    /// If true, wait for warmup to finish before returning
    #[serde(default)]
    sync: bool,
}

#[derive(Debug, serde::Deserialize)]
struct WarmupQuery {
    id: Option<String>,
}

/// GET /api/acp/warmup - Get warmup status
async fn get_warmup_status(
    State(state): State<AppState>,
    Query(query): Query<WarmupQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    if let Some(agent_id) = query.id {
        let status = state.acp_warmup_service.get_status(&agent_id).await;
        return Ok(Json(
            serde_json::to_value(status).map_err(|e| ServerError::Internal(e.to_string()))?,
        ));
    }
    let statuses: Vec<WarmupStatus> = state.acp_warmup_service.get_all_statuses().await;
    Ok(Json(serde_json::json!({ "statuses": statuses })))
}

/// POST /api/acp/warmup - Start warmup for an agent
async fn warmup_agent(
    State(state): State<AppState>,
    Json(req): Json<WarmupRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    tracing::info!("[ACP Warmup] Warming up agent: {}", req.agent_id);

    if req.sync {
        let ok = state
            .acp_warmup_service
            .warmup(&req.agent_id)
            .await
            .unwrap_or(false);

        let status = state.acp_warmup_service.get_status(&req.agent_id).await;
        return Ok(Json(serde_json::json!({
            "agentId": req.agent_id,
            "success": ok,
            "status": status,
        })));
    }

    state
        .acp_warmup_service
        .warmup_in_background(&req.agent_id)
        .await;

    Ok(Json(serde_json::json!({
        "agentId": req.agent_id,
        "started": true,
        "message": format!("Warmup started for agent '{}' in the background", req.agent_id),
    })))
}
