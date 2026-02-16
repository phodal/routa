//! MCP Configuration Test API - /api/test-mcp
//!
//! GET /api/test-mcp - Test MCP configuration for all providers

use axum::{routing::get, Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(test_mcp))
}

async fn test_mcp() -> Json<serde_json::Value> {
    let providers = [
        "auggie", "opencode", "claude", "codex", "gemini", "kimi", "copilot",
    ];

    let mcp_endpoint = "/api/mcp";

    let mut results = serde_json::Map::new();

    for &provider in &providers {
        let supports_mcp = true; // All known providers support MCP via Routa

        let cmd = match provider {
            "auggie" => "auggie",
            "opencode" => "opencode",
            "claude" => "claude",
            "codex" => "codex-acp",
            "gemini" => "gemini",
            "kimi" => "kimi",
            "copilot" => "copilot",
            _ => continue,
        };

        let installed = crate::shell_env::which(cmd).is_some();

        results.insert(
            provider.to_string(),
            serde_json::json!({
                "supportsMcp": supports_mcp,
                "installed": installed,
                "mcpEndpoint": mcp_endpoint,
            }),
        );
    }

    let default_config = serde_json::json!({
        "routaServerUrl": "http://127.0.0.1:3210",
        "mcpEndpoint": "http://127.0.0.1:3210/api/mcp",
    });

    Json(serde_json::json!({
        "providers": results,
        "defaultConfig": default_config,
        "mcpEndpoint": format!("http://127.0.0.1:3210{}", mcp_endpoint),
    }))
}
