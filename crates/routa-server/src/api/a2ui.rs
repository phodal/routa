//! A2UI Dashboard API - /api/a2ui/dashboard
//!
//! Mock implementation for desktop backend.
//! The A2UI protocol is primarily used in the web interface for dashboard rendering.
//! Desktop mode returns minimal mock responses for API compatibility.
//!
//! GET  /api/a2ui/dashboard - Returns A2UI v0.10 messages (mock)
//! POST /api/a2ui/dashboard - Accepts custom A2UI messages (mock)

use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/dashboard", get(get_dashboard).post(post_dashboard))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardQuery {
    workspace_id: Option<String>,
}

/// GET /api/a2ui/dashboard — Mock A2UI dashboard data
async fn get_dashboard(
    Query(q): Query<DashboardQuery>,
) -> Result<Json<serde_json::Value>, crate::error::ServerError> {
    super::require_workspace_id(q.workspace_id.as_deref())?;
    // Desktop mode: return minimal A2UI response
    Ok(Json(serde_json::json!({
        "data": [],
        "kind": "data",
        "metadata": {
            "mimeType": "application/json+a2ui",
            "note": "A2UI protocol is not fully implemented in desktop mode"
        }
    })))
}

/// POST /api/a2ui/dashboard — Mock A2UI custom surface handler
async fn post_dashboard(
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, crate::error::ServerError> {
    super::require_workspace_id(body.get("workspaceId").and_then(|v| v.as_str()))?;
    // Desktop mode: acknowledge but don't process
    Ok(Json(serde_json::json!({
        "success": true,
        "surfaceCount": 0,
        "totalMessages": 0,
        "note": "A2UI protocol is not fully implemented in desktop mode"
    })))
}
