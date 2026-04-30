use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use sysinfo::System;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/",
        get(get_memory_stats)
            .post(cleanup_memory)
            .delete(reset_memory),
    )
}

pub fn legacy_router() -> Router<AppState> {
    Router::new().route(
        "/",
        get(get_legacy_memory_stats)
            .post(cleanup_legacy_memory)
            .delete(reset_legacy_memory),
    )
}

#[derive(Debug, Deserialize)]
struct MemoryQuery {
    history: Option<bool>,
}

/// GET /api/system/memory — Get memory usage statistics.
///
/// For desktop version, returns system memory info.
async fn get_memory_stats(
    State(_state): State<AppState>,
    Query(query): Query<MemoryQuery>,
) -> Json<serde_json::Value> {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let available_memory = sys.available_memory();

    let usage_percentage = if total_memory > 0 {
        (used_memory as f64 / total_memory as f64 * 100.0) as u64
    } else {
        0
    };

    let level = if usage_percentage > 90 {
        "critical"
    } else if usage_percentage > 75 {
        "warning"
    } else {
        "normal"
    };

    let stats = serde_json::json!({
        "heapUsedMB": used_memory / 1024 / 1024,
        "heapTotalMB": total_memory / 1024 / 1024,
        "availableMB": available_memory / 1024 / 1024,
        "usagePercentage": usage_percentage,
        "level": level,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    if query.history.unwrap_or(false) {
        // Return with empty history for desktop version
        Json(serde_json::json!({
            "stats": stats,
            "history": [],
            "sessionStore": {
                "activeSessions": 0,
                "totalHistorySize": 0,
                "averageHistorySize": 0
            }
        }))
    } else {
        Json(stats)
    }
}

/// GET /api/memory — Deprecated alias for /api/system/memory.
async fn get_legacy_memory_stats(
    state: State<AppState>,
    query: Query<MemoryQuery>,
) -> impl IntoResponse {
    (legacy_headers(), get_memory_stats(state, query).await)
}

/// POST /api/system/memory — Trigger memory cleanup.
///
/// For desktop version, this is a no-op.
async fn cleanup_memory(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "success": true,
        "message": "Memory cleanup not needed in desktop version",
        "cleaned": 0
    }))
}

/// POST /api/memory — Deprecated alias for /api/system/memory.
async fn cleanup_legacy_memory(state: State<AppState>) -> impl IntoResponse {
    (legacy_headers(), cleanup_memory(state).await)
}

/// DELETE /api/system/memory — Reset memory monitoring.
///
/// For desktop version, this is a no-op.
async fn reset_memory(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "success": true,
        "message": "Memory monitoring reset not needed in desktop version"
    }))
}

/// DELETE /api/memory — Deprecated alias for /api/system/memory.
async fn reset_legacy_memory(state: State<AppState>) -> impl IntoResponse {
    (legacy_headers(), reset_memory(state).await)
}

fn legacy_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("deprecation"),
        HeaderValue::from_static("true"),
    );
    headers.insert(
        header::LINK,
        HeaderValue::from_static("</api/system/memory>; rel=\"successor-version\""),
    );
    headers.insert(
        HeaderName::from_static("warning"),
        HeaderValue::from_static("299 - \"Deprecated API route; use /api/system/memory\""),
    );
    headers.insert(
        HeaderName::from_static("x-routa-deprecated-route"),
        HeaderValue::from_static("/api/memory"),
    );
    headers.insert(
        HeaderName::from_static("x-routa-replacement-route"),
        HeaderValue::from_static("/api/system/memory"),
    );
    headers
}
