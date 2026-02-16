use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::error::ServerError;
use crate::models::workspace::Workspace;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_workspaces).post(create_workspace))
        .route("/{id}", get(get_workspace).delete(delete_workspace))
}

async fn list_workspaces(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspaces = state.workspace_store.list().await?;
    Ok(Json(serde_json::json!({ "workspaces": workspaces })))
}

async fn get_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Workspace>, ServerError> {
    state
        .workspace_store
        .get(&id)
        .await?
        .map(Json)
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {} not found", id)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceRequest {
    title: String,
    repo_path: Option<String>,
    branch: Option<String>,
    metadata: Option<HashMap<String, String>>,
}

async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let ws = Workspace::new(
        uuid::Uuid::new_v4().to_string(),
        body.title,
        body.repo_path,
        body.branch,
        body.metadata,
    );

    state.workspace_store.save(&ws).await?;
    Ok(Json(serde_json::json!({ "workspace": ws })))
}

async fn delete_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.workspace_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
