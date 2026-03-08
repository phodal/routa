use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;
use std::process::Command;

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
    create_github_issue: Option<bool>,
    repo_path: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let workspace_id = body.workspace_id.unwrap_or_else(|| "default".to_string());
    let default_board = state.kanban_store.ensure_default_board(&workspace_id).await?;
    let codebase = resolve_codebase(&state, &workspace_id, body.repo_path.as_deref()).await?;

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
    task.board_id = body.board_id.or_else(|| Some(default_board.id.clone()));
    task.column_id = body.column_id.or_else(|| Some("backlog".to_string()));
    task.position = body.position.unwrap_or(0);
    task.priority = match body.priority {
        Some(value) => Some(
            TaskPriority::from_str(&value)
                .ok_or_else(|| ServerError::BadRequest(format!("Invalid priority: {}", value)))?,
        ),
        None => None,
    };
    task.labels = sanitize_labels(body.labels.unwrap_or_default());
    task.assignee = body.assignee;
    task.assigned_provider = body.assigned_provider;
    task.assigned_role = body.assigned_role;
    task.assigned_specialist_id = body.assigned_specialist_id;
    task.assigned_specialist_name = body.assigned_specialist_name;

    if body.create_github_issue.unwrap_or(false) {
        match resolve_github_repo(codebase.as_ref().map(|item| item.repo_path.as_str())) {
            Some(repo) => match create_github_issue(
                &repo,
                &task.title,
                Some(&task.objective),
                &task.labels,
                task.assignee.as_deref(),
            )
            .await
            {
                Ok(issue) => {
                    task.github_id = Some(issue.id);
                    task.github_number = Some(issue.number);
                    task.github_url = Some(issue.url);
                    task.github_repo = Some(issue.repo);
                    task.github_state = Some(issue.state);
                    task.github_synced_at = Some(Utc::now());
                    task.last_sync_error = None;
                }
                Err(error) => {
                    task.last_sync_error = Some(error);
                }
            },
            None => {
                task.last_sync_error = Some(
                    "Selected codebase is not linked to a GitHub repository.".to_string(),
                );
            }
        }
    }

    state.task_store.save(&task).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "task": task })),
    ))
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
    sync_to_github: Option<bool>,
    retry_trigger: Option<bool>,
    repo_path: Option<String>,
}

async fn update_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let Some(mut task) = state.task_store.get(&id).await? else {
        return Err(ServerError::NotFound(format!("Task {} not found", id)));
    };
    let existing_column_id = task.column_id.clone();
    let has_status_update = body.status.is_some();
    let has_column_update = body.column_id.is_some();
    let has_assigned_provider_update = body.assigned_provider.is_some();
    let has_assigned_role_update = body.assigned_role.is_some();
    let has_assigned_specialist_update = body.assigned_specialist_id.is_some();
    let retry_trigger = body.retry_trigger.unwrap_or(false);
    let repo_path = body.repo_path.clone();

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
        task.priority = Some(
            TaskPriority::from_str(&value)
                .ok_or_else(|| ServerError::BadRequest(format!("Invalid priority: {}", value)))?,
        );
    }
    if let Some(value) = body.labels { task.labels = sanitize_labels(value); }
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

    if retry_trigger {
        task.trigger_session_id = None;
        task.last_sync_error = None;
    }

    if has_column_update && !has_status_update {
        task.status = column_id_to_task_status(task.column_id.as_deref());
    }
    if has_status_update && !has_column_update {
        task.column_id = Some(task_status_to_column_id(&task.status).to_string());
    }

    if body.sync_to_github != Some(false) {
        if let (Some(repo), Some(issue_number)) = (task.github_repo.clone(), task.github_number) {
            match update_github_issue(
                &repo,
                issue_number,
                &task.title,
                Some(&task.objective),
                &task.labels,
                if task.status == TaskStatus::Completed { "closed" } else { "open" },
                task.assignee.as_deref(),
            )
            .await
            {
                Ok(()) => {
                    task.github_state = Some(if task.status == TaskStatus::Completed {
                        "closed".to_string()
                    } else {
                        "open".to_string()
                    });
                    task.github_synced_at = Some(Utc::now());
                    task.last_sync_error = None;
                }
                Err(error) => {
                    task.last_sync_error = Some(error);
                }
            }
        }
    }

    let entering_dev = task.column_id.as_deref() == Some("dev") && existing_column_id.as_deref() != Some("dev");
    let assigned_while_in_dev = task.column_id.as_deref() == Some("dev")
        && task.trigger_session_id.is_none()
        && (has_assigned_provider_update || has_assigned_specialist_update || has_assigned_role_update);
    let retrying_trigger = retry_trigger;

    if (entering_dev || assigned_while_in_dev || retrying_trigger)
        && task.trigger_session_id.is_none()
        && task.assigned_provider.is_some()
    {
        let codebase = resolve_codebase(&state, &task.workspace_id, repo_path.as_deref()).await?;
        let trigger_result = trigger_assigned_task_agent(
            &state,
            &task,
            codebase.as_ref().map(|item| item.repo_path.as_str()),
            codebase.as_ref().and_then(|item| item.branch.as_deref()),
        )
        .await;

        match trigger_result {
            Ok(session_id) => {
                task.trigger_session_id = Some(session_id);
                task.last_sync_error = None;
            }
            Err(error) => {
                task.last_sync_error = Some(error);
            }
        }
    }

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

#[derive(Clone)]
struct GitHubIssueRef {
    id: String,
    number: i64,
    url: String,
    state: String,
    repo: String,
}

fn sanitize_labels(labels: Vec<String>) -> Vec<String> {
    let mut sanitized = Vec::new();
    for label in labels {
        let trimmed = label.trim();
        if !trimmed.is_empty() && !sanitized.iter().any(|item| item == trimmed) {
            sanitized.push(trimmed.to_string());
        }
    }
    sanitized
}

fn column_id_to_task_status(column_id: Option<&str>) -> TaskStatus {
    match column_id.unwrap_or("backlog").to_ascii_lowercase().as_str() {
        "dev" => TaskStatus::InProgress,
        "review" => TaskStatus::ReviewRequired,
        "blocked" => TaskStatus::Blocked,
        "done" => TaskStatus::Completed,
        _ => TaskStatus::Pending,
    }
}

fn task_status_to_column_id(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::InProgress => "dev",
        TaskStatus::ReviewRequired => "review",
        TaskStatus::Blocked => "blocked",
        TaskStatus::Completed => "done",
        _ => "backlog",
    }
}

async fn resolve_codebase(
    state: &AppState,
    workspace_id: &str,
    repo_path: Option<&str>,
) -> Result<Option<crate::models::codebase::Codebase>, ServerError> {
    if let Some(path) = repo_path {
        state.codebase_store.find_by_repo_path(workspace_id, path).await
    } else {
        state.codebase_store.get_default(workspace_id).await
    }
}

fn resolve_github_repo(repo_path: Option<&str>) -> Option<String> {
    let repo_path = repo_path?;
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = crate::git::parse_github_url(&remote)?;
    Some(format!("{}/{}", parsed.owner, parsed.repo))
}

fn github_token() -> Option<String> {
    std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var("GH_TOKEN").ok().filter(|value| !value.is_empty()))
}

async fn create_github_issue(
    repo: &str,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    assignee: Option<&str>,
) -> Result<GitHubIssueRef, String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = client
        .post(format!("https://api.github.com/repos/{}/issues", repo))
        .header(AUTHORIZATION, format!("token {}", token))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("GitHub issue create failed: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub issue create failed: {} {}", status, text));
    }

    let data = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("GitHub issue create failed: {}", error))?;

    Ok(GitHubIssueRef {
        id: data.get("id").and_then(|value| value.as_i64()).unwrap_or_default().to_string(),
        number: data.get("number").and_then(|value| value.as_i64()).unwrap_or_default(),
        url: data
            .get("html_url")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        state: data
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("open")
            .to_string(),
        repo: repo.to_string(),
    })
}

async fn update_github_issue(
    repo: &str,
    issue_number: i64,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    state: &str,
    assignee: Option<&str>,
) -> Result<(), String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
        "state": state,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = client
        .patch(format!("https://api.github.com/repos/{}/issues/{}", repo, issue_number))
        .header(AUTHORIZATION, format!("token {}", token))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("GitHub issue update failed: {}", error))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(format!("GitHub issue update failed: {} {}", status, text))
    }
}

fn build_task_prompt(task: &Task) -> String {
    let labels = if task.labels.is_empty() {
        "Labels: none".to_string()
    } else {
        format!("Labels: {}", task.labels.join(", "))
    };

    [
        format!("You are assigned to Kanban task: {}", task.title),
        String::new(),
        task.objective.clone(),
        String::new(),
        format!(
            "Priority: {}",
            task.priority.as_ref().map(|value| value.as_str()).unwrap_or("medium")
        ),
        labels,
        task.github_url
            .as_ref()
            .map(|url| format!("GitHub Issue: {}", url))
            .unwrap_or_else(|| "GitHub Issue: local-only".to_string()),
        String::new(),
        "Start implementation work immediately. Report progress in the session and keep changes focused on this task.".to_string(),
    ]
    .join("\n")
}

async fn trigger_assigned_task_agent(
    state: &AppState,
    task: &Task,
    cwd: Option<&str>,
    branch: Option<&str>,
) -> Result<String, String> {
    let provider = task
        .assigned_provider
        .clone()
        .unwrap_or_else(|| "opencode".to_string());
    let role = task
        .assigned_role
        .clone()
        .unwrap_or_else(|| "CRAFTER".to_string())
        .to_uppercase();
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = cwd
        .map(|value| value.to_string())
        .or_else(|| std::env::current_dir().ok().map(|path| path.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            task.workspace_id.clone(),
            Some(provider.clone()),
            Some(role.clone()),
            None,
            None,
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    state
        .acp_session_store
        .create(
            &session_id,
            &cwd,
            &task.workspace_id,
            Some(provider.as_str()),
            Some(role.as_str()),
            None,
        )
        .await
        .map_err(|error| format!("Failed to persist ACP session: {}", error))?;

    let prompt = build_task_prompt(task);
    let state_clone = state.clone();
    let session_id_clone = session_id.clone();
    let task_workspace = task.workspace_id.clone();
    let provider_clone = provider.clone();
    let cwd_clone = cwd.clone();
    let _branch = branch.map(|value| value.to_string());

    tokio::spawn(async move {
        if let Err(error) = state_clone.acp_manager.prompt(&session_id_clone, &prompt).await {
            tracing::error!(
                "[kanban] Failed to auto-prompt ACP task session {} in workspace {} with provider {} at {}: {}",
                session_id_clone,
                task_workspace,
                provider_clone,
                cwd_clone,
                error
            );
            return;
        }

        let _ = state_clone.acp_session_store.set_first_prompt_sent(&session_id_clone).await;
        if let Some(history) = state_clone.acp_manager.get_session_history(&session_id_clone).await {
            let _ = state_clone.acp_session_store.save_history(&session_id_clone, &history).await;
        }
    });

    Ok(session_id)
}
