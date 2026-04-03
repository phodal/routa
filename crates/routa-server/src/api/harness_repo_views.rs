use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use routa_core::harness::detect_repo_signals;
use routa_core::harness_automation::detect_repo_automations;
use serde_json::Value;

use crate::api::repo_context::{json_error, resolve_repo_root, RepoContextQuery};
use crate::error::ServerError;
use crate::state::AppState;

pub async fn get_harness_repo_signals(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing harness repo context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await?;

    let report = detect_repo_signals(&repo_root).map_err(ServerError::Internal)?;
    Ok(Json(serde_json::to_value(report).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize report: {error}"))
    })?))
}

pub async fn get_harness_automations(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Harness automations 上下文无效",
        "读取 Harness automation definitions 失败",
    ))?;

    let schedules = if let Some(workspace_id) = query.workspace_id.as_deref() {
        state
            .schedule_store
            .list_by_workspace(workspace_id)
            .await
            .map_err(map_internal_error("读取 Harness automation runtime 失败"))?
    } else {
        Vec::new()
    };

    let report = detect_repo_automations(&repo_root, &schedules).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(
                "读取 Harness automation definitions 失败",
                error,
            )),
        )
    })?;

    Ok(Json(serde_json::to_value(report).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(
                "读取 Harness automation definitions 失败",
                error.to_string(),
            )),
        )
    })?))
}

fn map_context_error(
    public_error: &'static str,
    internal_error: &'static str,
) -> impl Fn(ServerError) -> (StatusCode, Json<Value>) + Clone {
    move |error| match error {
        ServerError::BadRequest(details) => (
            StatusCode::BAD_REQUEST,
            Json(json_error(public_error, details)),
        ),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(internal_error, other.to_string())),
        ),
    }
}

fn map_internal_error(
    public_error: &'static str,
) -> impl Fn(ServerError) -> (StatusCode, Json<Value>) + Clone {
    move |error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(public_error, error.to_string())),
        )
    }
}
