use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::ServerError;
use crate::models::task::{Task, TaskPriority, TaskStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_tasks).post(create_task).delete(delete_all_tasks))
    .route("/{id}", get(get_task).patch(update_task).delete(delete_task))
        .route("/{id}/status", axum::routing::post(update_task_status))
        .route("/ready", get(find_ready_tasks))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTasksQuery {
    workspace_id: Option<String>,
    session_id: Option<String>,
    status: Option<String>,
    assigned_to: Option<String>,
}

async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");

    let tasks = if let Some(session_id) = &query.session_id {
        // Filter by session_id takes priority
        state.task_store.list_by_session(session_id).await?
    } else if let Some(assignee) = &query.assigned_to {
        state.task_store.list_by_assignee(assignee).await?
    } else if let Some(status_str) = &query.status {
        let status = TaskStatus::from_str(status_str)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .task_store
            .list_by_status(workspace_id, &status)
            .await?
    } else {
        state.task_store.list_by_workspace(workspace_id).await?
    };

    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

async fn get_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    Ok(Json(serde_json::json!({ "task": task })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskRequest {
    title: String,
    objective: String,
    workspace_id: Option<String>,
    session_id: Option<String>,
    scope: Option<String>,
    acceptance_criteria: Option<Vec<String>>,
    verification_commands: Option<Vec<String>>,
    dependencies: Option<Vec<String>>,
    parallel_group: Option<String>,
    board_id: Option<String>,
    column_id: Option<String>,
    position: Option<i64>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    assigned_provider: Option<String>,
    assigned_role: Option<String>,
    assigned_specialist_id: Option<String>,
    assigned_specialist_name: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = body.workspace_id.unwrap_or_else(|| "default".to_string());

    let mut task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        body.title,
        body.objective,
        workspace_id,
        body.session_id,
        body.scope,
        body.acceptance_criteria,
        body.verification_commands,
        body.dependencies,
        body.parallel_group,
    );
    task.board_id = body.board_id;
    task.column_id = body.column_id.or_else(|| Some("backlog".to_string()));
    task.position = body.position.unwrap_or(0);
    task.priority = body.priority.and_then(|value| TaskPriority::from_str(&value));
    task.labels = body.labels.unwrap_or_default();
    task.assignee = body.assignee;
    task.assigned_provider = body.assigned_provider;
    task.assigned_role = body.assigned_role;
    task.assigned_specialist_id = body.assigned_specialist_id;
    task.assigned_specialist_name = body.assigned_specialist_name;

    state.task_store.save(&task).await?;
    Ok(Json(serde_json::json!({ "task": task })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskRequest {
    title: Option<String>,
    objective: Option<String>,
    scope: Option<String>,
    acceptance_criteria: Option<Vec<String>>,
    verification_commands: Option<Vec<String>>,
    assigned_to: Option<String>,
    status: Option<String>,
    board_id: Option<String>,
    column_id: Option<String>,
    position: Option<i64>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    assigned_provider: Option<String>,
    assigned_role: Option<String>,
    assigned_specialist_id: Option<String>,
    assigned_specialist_name: Option<String>,
    trigger_session_id: Option<String>,
    github_id: Option<String>,
    github_number: Option<i64>,
    github_url: Option<String>,
    github_repo: Option<String>,
    github_state: Option<String>,
    last_sync_error: Option<String>,
    dependencies: Option<Vec<String>>,
    parallel_group: Option<String>,
    completion_summary: Option<String>,
    verification_report: Option<String>,
}

async fn update_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let Some(mut task) = state.task_store.get(&id).await? else {
        return Err(ServerError::NotFound(format!("Task {} not found", id)));
    };

    if let Some(value) = body.title { task.title = value; }
    if let Some(value) = body.objective { task.objective = value; }
    if let Some(value) = body.scope { task.scope = Some(value); }
    if let Some(value) = body.acceptance_criteria { task.acceptance_criteria = Some(value); }
    if let Some(value) = body.verification_commands { task.verification_commands = Some(value); }
    if let Some(value) = body.assigned_to { task.assigned_to = Some(value); }
    if let Some(value) = body.status {
        task.status = TaskStatus::from_str(&value)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", value)))?;
    }
    if body.board_id.is_some() { task.board_id = body.board_id; }
    if body.column_id.is_some() { task.column_id = body.column_id; }
    if let Some(value) = body.position { task.position = value; }
    if let Some(value) = body.priority {
        task.priority = TaskPriority::from_str(&value);
    }
    if let Some(value) = body.labels { task.labels = value; }
    if body.assignee.is_some() { task.assignee = body.assignee; }
    if body.assigned_provider.is_some() { task.assigned_provider = body.assigned_provider; }
    if body.assigned_role.is_some() { task.assigned_role = body.assigned_role; }
    if body.assigned_specialist_id.is_some() { task.assigned_specialist_id = body.assigned_specialist_id; }
    if body.assigned_specialist_name.is_some() { task.assigned_specialist_name = body.assigned_specialist_name; }
    if body.trigger_session_id.is_some() { task.trigger_session_id = body.trigger_session_id; }
    if body.github_id.is_some() { task.github_id = body.github_id; }
    if body.github_number.is_some() { task.github_number = body.github_number; }
    if body.github_url.is_some() { task.github_url = body.github_url; }
    if body.github_repo.is_some() { task.github_repo = body.github_repo; }
    if body.github_state.is_some() { task.github_state = body.github_state; }
    if body.last_sync_error.is_some() { task.last_sync_error = body.last_sync_error; }
    if let Some(value) = body.dependencies { task.dependencies = value; }
    if body.parallel_group.is_some() { task.parallel_group = body.parallel_group; }
    if body.completion_summary.is_some() { task.completion_summary = body.completion_summary; }
    if body.verification_report.is_some() { task.verification_report = body.verification_report; }
    task.updated_at = chrono::Utc::now();

    state.task_store.save(&task).await?;
    Ok(Json(serde_json::json!({ "task": task })))
}

async fn delete_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.task_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_task_status(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let status = TaskStatus::from_str(&body.status)
        .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", body.status)))?;
    state.task_store.update_status(&id, &status).await?;
    Ok(Json(serde_json::json!({ "updated": true })))
}

async fn find_ready_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    let tasks = state.task_store.find_ready_tasks(workspace_id).await?;
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

/// DELETE /api/tasks — Bulk delete all tasks for a workspace
async fn delete_all_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let count = tasks.len();
    for task in &tasks {
        state.task_store.delete(&task.id).await?;
    }
    Ok(Json(serde_json::json!({ "deleted": count })))
}
