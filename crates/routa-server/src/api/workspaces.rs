use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::error::ServerError;
use crate::models::workspace::{Workspace, WorkspaceStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_workspaces).post(create_workspace))
        .route(
            "/{id}",
            get(get_workspace)
                .delete(delete_workspace)
                .patch(update_workspace),
        )
        .route("/{id}/archive", post(archive_workspace))
}

#[derive(Debug, Deserialize)]
struct ListWorkspacesQuery {
    status: Option<WorkspaceStatus>,
}

async fn list_workspaces(
    State(state): State<AppState>,
    Query(query): Query<ListWorkspacesQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspaces = if let Some(status) = query.status {
        state.workspace_store.list_by_status(status).await?
    } else {
        state.workspace_store.list().await?
    };
    Ok(Json(serde_json::json!({ "workspaces": workspaces })))
}

async fn get_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace = state
        .workspace_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {id} not found")))?;
    let codebases = state
        .codebase_store
        .list_by_workspace(&id)
        .await
        .unwrap_or_default();
    Ok(Json(
        serde_json::json!({ "workspace": workspace, "codebases": codebases }),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceRequest {
    title: Option<String>,
    metadata: Option<HashMap<String, String>>,
}

async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let title = body
        .title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("title is required".to_string()))?;
    let ws = Workspace::new(uuid::Uuid::new_v4().to_string(), title, body.metadata);

    state.workspace_store.save(&ws).await?;
    Ok(Json(serde_json::json!({ "workspace": ws })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkspaceRequest {
    title: Option<String>,
    metadata: Option<HashMap<String, String>>,
}

async fn update_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let mut ws = state
        .workspace_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {id} not found")))?;

    if let Some(title) = &body.title {
        state.workspace_store.update_title(&id, title).await?;
    }

    if let Some(metadata) = body.metadata {
        ws.metadata.extend(metadata);
        state.workspace_store.save(&ws).await?;
    }

    let ws = state
        .workspace_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {id} not found")))?;

    Ok(Json(serde_json::json!({ "workspace": ws })))
}

async fn archive_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Verify workspace exists
    state
        .workspace_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {id} not found")))?;

    state.workspace_store.update_status(&id, "archived").await?;

    let ws = state
        .workspace_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Workspace {id} not found")))?;

    Ok(Json(serde_json::json!({ "workspace": ws })))
}

async fn delete_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.workspace_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
