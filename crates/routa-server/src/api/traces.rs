use axum::{
    extract::{Query as QueryParams, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::ServerError;
use crate::state::AppState;
use routa_core::trace::{TraceQuery, TraceReader};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(query_traces).post(export_traces))
        .route("/stats", get(get_trace_stats))
        .route("/{id}", get(get_trace_by_id))
}

/// GET /api/traces — Query traces with optional filters.
///
/// Query parameters:
/// - sessionId: Filter by session ID
/// - workspaceId: Filter by workspace ID
/// - file: Filter by file path
/// - eventType: Filter by event type
/// - startDate: Start date (YYYY-MM-DD)
/// - endDate: End date (YYYY-MM-DD)
/// - limit: Max number of results
/// - offset: Skip N results
async fn query_traces(
    State(_state): State<AppState>,
    QueryParams(params): QueryParams<TraceQueryParams>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Get current working directory for trace base path
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;

    let reader = TraceReader::new(&cwd);
    let query = params.to_trace_query();

    let traces = reader
        .query(&query)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to query traces: {e}")))?;

    Ok(Json(serde_json::json!({
        "traces": traces,
        "count": traces.len()
    })))
}

/// GET /api/traces/stats — Get trace statistics.
async fn get_trace_stats(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;

    let reader = TraceReader::new(&cwd);
    let stats = reader
        .stats()
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to get trace stats: {e}")))?;

    Ok(Json(serde_json::json!({ "stats": stats })))
}

/// GET /api/traces/:id — Get a single trace by ID.
async fn get_trace_by_id(
    State(_state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;

    let reader = TraceReader::new(&cwd);
    let trace = reader
        .get_by_id(&id)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to get trace: {e}")))?;

    match trace {
        Some(trace) => Ok(Json(serde_json::json!({ "trace": trace }))),
        None => Err(ServerError::NotFound(format!("Trace {id} not found"))),
    }
}

/// POST /api/traces/export — Export traces in Agent Trace JSON format.
async fn export_traces(
    State(_state): State<AppState>,
    QueryParams(params): QueryParams<TraceQueryParams>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;

    let reader = TraceReader::new(&cwd);
    let query = params.to_trace_query();

    let traces_json = reader
        .export(&query)
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to export traces: {e}")))?;

    Ok(Json(serde_json::json!({
        "export": traces_json,
        "format": "agent-trace-json",
        "version": "0.1.0"
    })))
}

/// Query parameters for trace API endpoints.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceQueryParams {
    session_id: Option<String>,
    workspace_id: Option<String>,
    file: Option<String>,
    event_type: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

impl TraceQueryParams {
    fn to_trace_query(&self) -> TraceQuery {
        TraceQuery {
            session_id: self.session_id.clone(),
            workspace_id: self.workspace_id.clone(),
            file: self.file.clone(),
            event_type: self.event_type.clone(),
            start_date: self.start_date.clone(),
            end_date: self.end_date.clone(),
            limit: self.limit,
            offset: self.offset,
        }
    }
}
