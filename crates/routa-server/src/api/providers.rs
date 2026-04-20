//! Providers API - Fast provider listing with lazy status checking
//!
//! GET /api/providers - List all providers (instant, status may be "checking")
//! GET /api/providers?check=true - Check provider status (slower, but accurate)

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use crate::error::ServerError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct ProviderInfo {
    id: String,
    name: String,
    description: String,
    command: String,
    status: String, // "available" | "unavailable" | "checking"
    source: String, // "static" | "registry"
}

#[derive(Debug, Deserialize)]
struct ProvidersQuery {
    #[serde(default)]
    check: bool,
}

// Simple in-memory cache
struct Cache {
    providers: Option<Vec<ProviderInfo>>,
    timestamp: SystemTime,
}

static CACHE: OnceLock<Arc<Mutex<Cache>>> = OnceLock::new();

fn get_cache() -> &'static Arc<Mutex<Cache>> {
    CACHE.get_or_init(|| {
        Arc::new(Mutex::new(Cache {
            providers: None,
            timestamp: SystemTime::UNIX_EPOCH,
        }))
    })
}

const CACHE_TTL: Duration = Duration::from_secs(30);

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_providers))
}

async fn list_providers(
    State(state): State<AppState>,
    Query(query): Query<ProvidersQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Fast path: return cached or unchecked providers
    if !query.check {
        // Check cache first
        let _should_return_cached = {
            let cache = get_cache().lock().unwrap();
            if let Some(ref providers) = cache.providers {
                if cache.timestamp.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL {
                    // Clone the providers to return after releasing lock
                    return Ok(Json(serde_json::json!({ "providers": providers })));
                }
            }
            false
        };

        // Return unchecked providers immediately
        let mut providers = get_providers_without_checking().await;

        // Add Docker OpenCode provider with cached status
        let docker_status = state.docker_state.detector.check_availability(false).await;
        providers.push(ProviderInfo {
            id: "docker-opencode".to_string(),
            name: "Docker OpenCode".to_string(),
            description: if docker_status.available {
                "OpenCode in isolated Docker container".to_string()
            } else {
                "Requires Docker/Colima daemon".to_string()
            },
            command: "docker run".to_string(),
            status: if docker_status.available {
                "available".to_string()
            } else {
                "unavailable".to_string()
            },
            source: "static".to_string(),
        });

        return Ok(Json(serde_json::json!({ "providers": providers })));
    }

    // Slow path: check all provider statuses
    let mut providers = get_providers_with_checking().await;

    // Add Docker OpenCode provider
    let docker_status = state.docker_state.detector.check_availability(false).await;
    providers.push(ProviderInfo {
        id: "docker-opencode".to_string(),
        name: "Docker OpenCode".to_string(),
        description: if docker_status.available {
            "OpenCode in isolated Docker container".to_string()
        } else {
            "Requires Docker/Colima daemon".to_string()
        },
        command: "docker run".to_string(),
        status: if docker_status.available {
            "available".to_string()
        } else {
            "unavailable".to_string()
        },
        source: "static".to_string(),
    });

    // Update cache
    {
        let mut cache = get_cache().lock().unwrap();
        cache.providers = Some(providers.clone());
        cache.timestamp = SystemTime::now();
    }

    Ok(Json(serde_json::json!({ "providers": providers })))
}

/// Helper to get command from agent distribution
fn get_agent_command(agent: &super::acp_registry::RegistryAgent, platform: &str) -> String {
    // Try npx first
    if let Some(npx_val) = agent.distribution.get("npx") {
        if let Some(package) = npx_val.get("package").and_then(|v| v.as_str()) {
            return format!("npx {package}");
        }
    }

    // Try uvx
    if let Some(uvx_val) = agent.distribution.get("uvx") {
        if let Some(package) = uvx_val.get("package").and_then(|v| v.as_str()) {
            return format!("uvx {package}");
        }
    }

    // Try binary
    if let Some(binary_val) = agent.distribution.get("binary") {
        if let Some(platform_bin) = binary_val.get(platform) {
            if let Some(cmd) = platform_bin.get("cmd").and_then(|v| v.as_str()) {
                return cmd.to_string();
            }
        }
    }

    // Fallback to agent id
    agent.id.clone()
}

/// Fast: Return all providers without checking command availability
async fn get_providers_without_checking() -> Vec<ProviderInfo> {
    use crate::acp;

    let presets = acp::get_presets();
    let mut providers: Vec<ProviderInfo> = presets
        .iter()
        .map(|p| ProviderInfo {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            command: p.command.clone(),
            status: "checking".to_string(),
            source: "static".to_string(),
        })
        .collect();

    // Add registry agents (without checking)
    if let Ok(registry) = super::acp_registry::fetch_registry().await {
        let static_ids: HashSet<_> = providers.iter().map(|p| p.id.clone()).collect();
        let platform =
            super::acp_registry::detect_platform().unwrap_or_else(|| "unknown".to_string());

        for agent in registry.agents {
            let command = get_agent_command(&agent, &platform);

            let provider_id = if static_ids.contains(&agent.id) {
                format!("{}-registry", agent.id)
            } else {
                agent.id.clone()
            };

            let provider_name = if static_ids.contains(&agent.id) {
                format!("{} (Registry)", agent.name)
            } else {
                agent.name.clone()
            };

            providers.push(ProviderInfo {
                id: provider_id,
                name: provider_name,
                description: agent.description,
                command,
                status: "checking".to_string(),
                source: "registry".to_string(),
            });
        }
    }

    providers
}

/// Slow: Check all provider command availability
async fn get_providers_with_checking() -> Vec<ProviderInfo> {
    use crate::{acp, shell_env};

    let presets = acp::get_presets();
    let mut providers: Vec<ProviderInfo> = Vec::new();

    // Check static presets
    for preset in &presets {
        let installed = shell_env::which(&preset.command).is_some();
        providers.push(ProviderInfo {
            id: preset.id.clone(),
            name: preset.name.clone(),
            description: preset.description.clone(),
            command: preset.command.clone(),
            status: if installed {
                "available".to_string()
            } else {
                "unavailable".to_string()
            },
            source: "static".to_string(),
        });
    }

    // Add registry agents with checking
    let static_ids: HashSet<_> = providers.iter().map(|p| p.id.clone()).collect();

    if let Ok(registry) = super::acp_registry::fetch_registry().await {
        let npx_available = shell_env::which("npx").is_some();
        let uvx_available = shell_env::which("uv").is_some();
        let platform =
            super::acp_registry::detect_platform().unwrap_or_else(|| "unknown".to_string());

        for agent in registry.agents {
            let (command, status) = if agent.distribution.get("npx").is_some() {
                let cmd = get_agent_command(&agent, &platform);
                let status_str = if npx_available {
                    "available"
                } else {
                    "unavailable"
                };
                (cmd, status_str.to_string())
            } else if agent.distribution.get("uvx").is_some() {
                let cmd = get_agent_command(&agent, &platform);
                let status_str = if uvx_available {
                    "available"
                } else {
                    "unavailable"
                };
                (cmd, status_str.to_string())
            } else if agent.distribution.get("binary").is_some() {
                let cmd = get_agent_command(&agent, &platform);
                (cmd, "unavailable".to_string())
            } else {
                (agent.id.clone(), "unavailable".to_string())
            };

            let provider_id = if static_ids.contains(&agent.id) {
                format!("{}-registry", agent.id)
            } else {
                agent.id.clone()
            };

            let provider_name = if static_ids.contains(&agent.id) {
                format!("{} (Registry)", agent.name)
            } else {
                agent.name.clone()
            };

            providers.push(ProviderInfo {
                id: provider_id,
                name: provider_name,
                description: agent.description,
                command,
                status,
                source: "registry".to_string(),
            });
        }
    }

    // Sort: available first, then alphabetical
    providers.sort_by(|a, b| {
        if a.status == b.status {
            a.name.cmp(&b.name)
        } else if a.status == "available" {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    providers
}
