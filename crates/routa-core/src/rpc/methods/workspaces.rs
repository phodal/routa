//! RPC methods for workspace management.
//!
//! Methods:
//! - `workspaces.list`   — list all workspaces
//! - `workspaces.get`    — get a workspace by id
//! - `workspaces.create` — create a new workspace
//! - `workspaces.delete` — delete a workspace

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::workspace::Workspace;
use crate::rpc::error::RpcError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// workspaces.list
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub workspaces: Vec<Workspace>,
}

pub async fn list(state: &AppState) -> Result<ListResult, RpcError> {
    let workspaces = state.workspace_store.list().await?;
    Ok(ListResult { workspaces })
}

// ---------------------------------------------------------------------------
// workspaces.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<Workspace, RpcError> {
    state
        .workspace_store
        .get(&params.id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Workspace {} not found", params.id)))
}

// ---------------------------------------------------------------------------
// workspaces.create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateParams {
    pub title: String,
    pub repo_path: Option<String>,
    pub branch: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct CreateResult {
    pub workspace: Workspace,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let ws = Workspace::new(
        uuid::Uuid::new_v4().to_string(),
        params.title,
        params.repo_path,
        params.branch,
        params.metadata,
    );

    state.workspace_store.save(&ws).await?;
    Ok(CreateResult { workspace: ws })
}

// ---------------------------------------------------------------------------
// workspaces.delete
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteParams {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub deleted: bool,
}

pub async fn delete(state: &AppState, params: DeleteParams) -> Result<DeleteResult, RpcError> {
    state.workspace_store.delete(&params.id).await?;
    Ok(DeleteResult { deleted: true })
}
