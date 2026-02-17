//! RPC methods for task management.
//!
//! Methods:
//! - `tasks.list`         — list tasks with optional filters
//! - `tasks.get`          — get a single task by id
//! - `tasks.create`       — create a new task
//! - `tasks.delete`       — delete a task
//! - `tasks.updateStatus` — update a task's status
//! - `tasks.findReady`    — find tasks ready for execution

use serde::{Deserialize, Serialize};

use crate::models::task::{Task, TaskStatus};
use crate::rpc::error::RpcError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// tasks.list
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
}

fn default_workspace_id() -> String {
    "default".into()
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub tasks: Vec<Task>,
}

pub async fn list(state: &AppState, params: ListParams) -> Result<ListResult, RpcError> {
    let tasks = if let Some(assignee) = &params.assigned_to {
        state.task_store.list_by_assignee(assignee).await?
    } else if let Some(status_str) = &params.status {
        let status = TaskStatus::from_str(status_str)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .task_store
            .list_by_status(&params.workspace_id, &status)
            .await?
    } else {
        state
            .task_store
            .list_by_workspace(&params.workspace_id)
            .await?
    };

    Ok(ListResult { tasks })
}

// ---------------------------------------------------------------------------
// tasks.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<Task, RpcError> {
    state
        .task_store
        .get(&params.id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Task {} not found", params.id)))
}

// ---------------------------------------------------------------------------
// tasks.create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateParams {
    pub title: String,
    pub objective: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateResult {
    pub task: Task,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        params.title,
        params.objective,
        params.workspace_id,
        params.scope,
        params.acceptance_criteria,
        params.verification_commands,
        params.dependencies,
        params.parallel_group,
    );

    state.task_store.save(&task).await?;
    Ok(CreateResult { task })
}

// ---------------------------------------------------------------------------
// tasks.delete
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
    state.task_store.delete(&params.id).await?;
    Ok(DeleteResult { deleted: true })
}

// ---------------------------------------------------------------------------
// tasks.updateStatus
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusParams {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateStatusResult {
    pub updated: bool,
}

pub async fn update_status(
    state: &AppState,
    params: UpdateStatusParams,
) -> Result<UpdateStatusResult, RpcError> {
    let status = TaskStatus::from_str(&params.status)
        .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", params.status)))?;
    state.task_store.update_status(&params.id, &status).await?;
    Ok(UpdateStatusResult { updated: true })
}

// ---------------------------------------------------------------------------
// tasks.findReady
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindReadyParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
}

pub async fn find_ready(state: &AppState, params: FindReadyParams) -> Result<ListResult, RpcError> {
    let tasks = state
        .task_store
        .find_ready_tasks(&params.workspace_id)
        .await?;
    Ok(ListResult { tasks })
}
