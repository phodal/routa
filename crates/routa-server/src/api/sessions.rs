use axum::{
    extract::State,
    routing::get,
    Json, Router,
};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_sessions))
}

/// GET /api/sessions — List ACP sessions.
/// Compatible with the Next.js frontend's session-panel.tsx and chat-panel.tsx.
async fn list_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions = state.acp_manager.list_sessions().await;
    Json(serde_json::json!({ "sessions": sessions }))
}
