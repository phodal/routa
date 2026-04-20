//! ACP Registry fetch utilities (shared between CLI and HTTP server).

use std::path::PathBuf;

use super::paths::AcpPaths;
use super::registry_types::AcpRegistry;

const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

fn registry_cache_path() -> PathBuf {
    AcpPaths::new().registry_cache_path()
}

async fn load_cached_registry_json() -> Result<serde_json::Value, String> {
    let path = registry_cache_path();
    let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
        format!(
            "Failed to read cached ACP registry '{}': {}",
            path.display(),
            e
        )
    })?;

    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Failed to parse cached ACP registry JSON: {e}"))
}

async fn save_cached_registry_json(value: &serde_json::Value) -> Result<(), String> {
    let paths = AcpPaths::new();
    paths
        .ensure_directories()
        .map_err(|e| format!("Failed to create ACP directories: {e}"))?;

    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize ACP registry cache: {e}"))?;

    tokio::fs::write(paths.registry_cache_path(), content)
        .await
        .map_err(|e| format!("Failed to write ACP registry cache: {e}"))
}

async fn fetch_live_registry_json() -> Result<serde_json::Value, String> {
    let resp = reqwest::get(REGISTRY_URL)
        .await
        .map_err(|e| format!("Failed to fetch ACP registry: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ACP registry returned HTTP {}", resp.status()));
    }

    let json = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse ACP registry JSON: {e}"))?;

    let _ = save_cached_registry_json(&json).await;
    Ok(json)
}

/// Fetch the live ACP registry from the CDN.
pub async fn fetch_registry() -> Result<AcpRegistry, String> {
    let json = fetch_registry_json().await?;
    serde_json::from_value::<AcpRegistry>(json)
        .map_err(|e| format!("Failed to parse ACP registry JSON: {e}"))
}

/// Fetch raw registry JSON value (useful when callers do not want typed structs).
pub async fn fetch_registry_json() -> Result<serde_json::Value, String> {
    match fetch_live_registry_json().await {
        Ok(json) => Ok(json),
        Err(fetch_error) => load_cached_registry_json().await.map_err(|cache_error| {
            format!("{fetch_error}; fallback cache unavailable: {cache_error}")
        }),
    }
}
