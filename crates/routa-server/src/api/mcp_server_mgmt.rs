//! MCP Server Management API - /api/mcp-server
//!
//! GET    /api/mcp-server - Get server status + URLs
//! POST   /api/mcp-server - Start the server
//! DELETE /api/mcp-server - Stop the server
//!
//! Manages the standalone MCP server info (the embedded MCP endpoint is always
//! available at /api/mcp; this endpoint manages an optional separate server).

use axum::{routing::get, Json, Router};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::state::AppState;

static MCP_SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_status).post(start_server).delete(stop_server))
}

async fn get_status() -> Json<serde_json::Value> {
    if MCP_SERVER_RUNNING.load(Ordering::Relaxed) {
        Json(serde_json::json!({
            "running": true,
            "mcpUrl": "/api/mcp",
            "transports": ["streamable-http"],
            "message": "MCP server is running (embedded in Rust backend).",
        }))
    } else {
        Json(serde_json::json!({
            "running": false,
            "message": "Standalone MCP server is not running. POST to /api/mcp-server to start it.",
            "fallback": "/api/mcp (embedded Streamable HTTP route)",
        }))
    }
}

async fn start_server() -> Json<serde_json::Value> {
    // The MCP endpoint is always available at /api/mcp as part of the Rust backend.
    // This "start" just marks it as explicitly active.
    MCP_SERVER_RUNNING.store(true, Ordering::Relaxed);

    Json(serde_json::json!({
        "running": true,
        "mcpUrl": "/api/mcp",
        "transports": ["streamable-http"],
        "message": "MCP server started (embedded). Use /api/mcp for Streamable HTTP.",
    }))
}

async fn stop_server() -> Json<serde_json::Value> {
    MCP_SERVER_RUNNING.store(false, Ordering::Relaxed);

    Json(serde_json::json!({
        "running": false,
        "message": "Standalone MCP server stopped. /api/mcp endpoint remains available.",
    }))
}
