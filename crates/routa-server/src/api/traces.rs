use axum::{
    extract::{Query as QueryParams, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::ServerError;
use crate::state::AppState;
use routa_core::trace::{TraceQuery, TraceReader, TraceRecord};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(query_traces))
        .route("/export", post(export_traces))
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
    State(state): State<AppState>,
    QueryParams(mut params): QueryParams<TraceQueryParams>,
    body: String,
) -> Result<Json<serde_json::Value>, ServerError> {
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;

    if !body.trim().is_empty() {
        let body_params: TraceQueryParams = serde_json::from_str(&body)
            .map_err(|error| ServerError::BadRequest(format!("Invalid JSON body: {error}")))?;
        params.apply_overrides(body_params);
    }

    let query = params.to_trace_query();
    let traces_json = export_traces_payload(&state, &cwd, &query).await?;

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
    fn apply_overrides(&mut self, overrides: TraceQueryParams) {
        if overrides.session_id.is_some() {
            self.session_id = overrides.session_id;
        }
        if overrides.workspace_id.is_some() {
            self.workspace_id = overrides.workspace_id;
        }
        if overrides.file.is_some() {
            self.file = overrides.file;
        }
        if overrides.event_type.is_some() {
            self.event_type = overrides.event_type;
        }
        if overrides.start_date.is_some() {
            self.start_date = overrides.start_date;
        }
        if overrides.end_date.is_some() {
            self.end_date = overrides.end_date;
        }
        if overrides.limit.is_some() {
            self.limit = overrides.limit;
        }
        if overrides.offset.is_some() {
            self.offset = overrides.offset;
        }
    }

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

async fn export_traces_payload(
    state: &AppState,
    fallback_cwd: &Path,
    query: &TraceQuery,
) -> Result<Value, ServerError> {
    if query.session_id.is_none() {
        return TraceReader::new(fallback_cwd)
            .export(query)
            .await
            .map_err(|error| ServerError::Internal(format!("Failed to export traces: {error}")));
    }

    let traces = query_traces_with_session_fallback(state, query, fallback_cwd).await?;
    serde_json::to_value(traces)
        .map_err(|error| ServerError::Internal(format!("Failed to serialize traces: {error}")))
}

async fn query_traces_with_session_fallback(
    state: &AppState,
    query: &TraceQuery,
    fallback_cwd: &Path,
) -> Result<Vec<TraceRecord>, ServerError> {
    let session_id = query.session_id.clone().ok_or_else(|| {
        ServerError::BadRequest("Session trace export requires a sessionId".to_string())
    })?;
    let reader_roots = resolve_trace_reader_roots(state, &session_id, fallback_cwd).await?;
    let trace_query = TraceQuery {
        limit: None,
        offset: None,
        ..query.clone()
    };

    let mut all_traces = Vec::new();
    for root in reader_roots {
        let traces = TraceReader::new(root)
            .query(&trace_query)
            .await
            .map_err(|error| ServerError::Internal(format!("Failed to export traces: {error}")))?;
        all_traces.extend(traces);
    }

    let mut deduped = HashMap::new();
    for trace in all_traces {
        deduped.entry(trace.id.clone()).or_insert(trace);
    }

    let mut traces = deduped.into_values().collect::<Vec<_>>();
    traces.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.id.cmp(&right.id))
    });

    let start = query.offset.unwrap_or(0);
    let end = query
        .limit
        .map(|limit| start + limit)
        .unwrap_or(traces.len());
    Ok(traces
        .into_iter()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect())
}

async fn resolve_trace_reader_roots(
    state: &AppState,
    session_id: &str,
    fallback_cwd: &Path,
) -> Result<Vec<PathBuf>, ServerError> {
    let mut roots = vec![fallback_cwd.to_path_buf()];

    let session_cwd = if let Some(session) = state.acp_manager.get_session(session_id).await {
        Some(PathBuf::from(session.cwd))
    } else {
        state
            .acp_session_store
            .get(session_id)
            .await?
            .map(|session| PathBuf::from(session.cwd))
    };

    if let Some(root) = session_cwd {
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }

    Ok(roots)
}
