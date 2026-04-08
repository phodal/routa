use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use routa_core::events::{AgentEvent, AgentEventType};
use routa_core::git::{FileChangeStatus, GitFileChange};
use routa_core::kanban::set_task_column;
use routa_core::models::artifact::{Artifact, ArtifactType};
use routa_core::models::kanban::KanbanBoard;
use routa_core::models::task::{
    build_task_invest_validation, build_task_story_readiness, Task, TaskLaneSessionStatus,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::api::tasks_automation::{
    auto_create_worktree, resolve_codebase, trigger_assigned_task_agent,
};
use crate::api::tasks_github::{
    build_task_issue_body, create_github_issue, resolve_github_repo_for_codebase,
    update_github_issue,
};
use crate::application::tasks::{CreateTaskCommand, TaskApplicationService, UpdateTaskCommand};
use crate::error::ServerError;
use crate::models::task::TaskStatus;
use crate::state::AppState;

const KANBAN_HAPPY_PATH_COLUMN_ORDER: [&str; 5] = ["backlog", "todo", "dev", "review", "done"];

fn repo_label_from_path(repo_path: &str) -> String {
    repo_path
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .rsplit(std::path::MAIN_SEPARATOR)
        .find(|segment| !segment.is_empty())
        .unwrap_or(repo_path)
        .to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskArtifactSummary {
    total: usize,
    by_type: BTreeMap<String, usize>,
    required_satisfied: bool,
    missing_required: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskVerificationSummary {
    has_verdict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    verdict: Option<String>,
    has_report: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskCompletionSummary {
    has_summary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRunSummary {
    total: usize,
    latest_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskEvidenceSummary {
    artifact: TaskArtifactSummary,
    verification: TaskVerificationSummary,
    completion: TaskCompletionSummary,
    runs: TaskRunSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRunResumeTarget {
    r#type: String,
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRunLedgerEntry {
    id: String,
    kind: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    specialist_name: Option<String>,
    started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resume_target: Option<TaskRunResumeTarget>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(list_tasks).post(create_task).delete(delete_all_tasks),
        )
        .route(
            "/{id}",
            get(get_task).patch(update_task).delete(delete_task),
        )
        .route(
            "/{id}/artifacts",
            get(list_task_artifacts).post(create_task_artifact),
        )
        .route("/{id}/changes", get(get_task_changes))
        .route("/{id}/changes/file", get(get_task_change_file))
        .route("/{id}/changes/commit", get(get_task_change_commit))
        .route("/{id}/changes/stats", get(get_task_change_stats))
        .route("/{id}/runs", get(list_task_runs))
        .route("/{id}/status", axum::routing::post(update_task_status))
        .route("/ready", get(find_ready_tasks))
}

async fn emit_kanban_workspace_event(
    state: &AppState,
    workspace_id: &str,
    entity: &str,
    action: &str,
    resource_id: Option<&str>,
    source: &str,
) {
    state
        .event_bus
        .emit(AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: format!("kanban-{}", source),
            workspace_id: workspace_id.to_string(),
            data: serde_json::json!({
                "scope": "kanban",
                "entity": entity,
                "action": action,
                "resourceId": resource_id,
                "source": source,
            }),
            timestamp: Utc::now(),
        })
        .await;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskArtifactRequest {
    agent_id: Option<String>,
    #[serde(rename = "type")]
    artifact_type: Option<String>,
    content: Option<String>,
    context: Option<String>,
    request_id: Option<String>,
    metadata: Option<BTreeMap<String, String>>,
}

async fn list_task_artifacts(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    let artifacts = state.artifact_store.list_by_task(&task.id).await?;

    Ok(Json(serde_json::json!({
        "artifacts": artifacts,
    })))
}

async fn list_task_runs(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    Ok(Json(serde_json::json!({
        "runs": build_task_run_ledger(&state, &task).await?
    })))
}

async fn get_task_changes(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    let worktree = match task.worktree_id.as_ref() {
        Some(worktree_id) => state.worktree_store.get(worktree_id).await?,
        None => None,
    };
    let codebase_id = worktree
        .as_ref()
        .map(|item| item.codebase_id.clone())
        .or_else(|| task.codebase_ids.first().cloned())
        .unwrap_or_default();
    let codebase = if codebase_id.is_empty() {
        None
    } else {
        state.codebase_store.get(&codebase_id).await?
    };
    let repo_path = worktree
        .as_ref()
        .map(|item| item.worktree_path.clone())
        .or_else(|| codebase.as_ref().map(|item| item.repo_path.clone()))
        .unwrap_or_default();
    let label = codebase
        .as_ref()
        .and_then(|item| item.label.clone())
        .unwrap_or_else(|| {
            repo_label_from_path(if repo_path.is_empty() {
                "repo"
            } else {
                &repo_path
            })
        });
    let branch = codebase
        .as_ref()
        .and_then(|item| item.branch.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let source = if worktree.is_some() {
        "worktree"
    } else {
        "repo"
    };

    if repo_path.is_empty() {
        return Ok(Json(serde_json::json!({
            "changes": {
                "codebaseId": codebase_id,
                "repoPath": "",
                "label": label,
                "branch": branch,
                "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                "files": [],
                "source": source,
                "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
                "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
                "error": "No repository or worktree linked to this task",
            }
        })));
    }

    if !crate::git::is_git_repository(&repo_path) {
        return Ok(Json(serde_json::json!({
            "changes": {
                "codebaseId": codebase_id,
                "repoPath": repo_path,
                "label": label,
                "branch": branch,
                "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                "files": [],
                "source": source,
                "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
                "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
                "error": "Repository is missing or not a git repository",
            }
        })));
    }

    let changes = crate::git::get_repo_changes(&repo_path);
    Ok(Json(serde_json::json!({
        "changes": {
            "codebaseId": codebase_id,
            "repoPath": repo_path,
            "label": label,
            "branch": changes.branch,
            "status": changes.status,
            "files": changes.files,
            "source": source,
            "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
            "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
        }
    })))
}

#[derive(Debug, Deserialize)]
struct TaskChangeFileQuery {
    path: Option<String>,
    status: Option<String>,
    #[serde(rename = "previousPath")]
    previous_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskChangeCommitQuery {
    sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskChangeStatsQuery {
    paths: Option<String>,
    statuses: Option<String>,
}

fn parse_file_change_status(status: &str) -> FileChangeStatus {
    match status.trim().to_ascii_lowercase().as_str() {
        "added" => FileChangeStatus::Added,
        "deleted" => FileChangeStatus::Deleted,
        "renamed" => FileChangeStatus::Renamed,
        "copied" => FileChangeStatus::Copied,
        "untracked" => FileChangeStatus::Untracked,
        "typechange" => FileChangeStatus::Typechange,
        "conflicted" => FileChangeStatus::Conflicted,
        _ => FileChangeStatus::Modified,
    }
}

async fn resolve_task_repo_path(state: &AppState, task: &Task) -> Result<String, ServerError> {
    let worktree = match task.worktree_id.as_ref() {
        Some(worktree_id) => state.worktree_store.get(worktree_id).await?,
        None => None,
    };
    let codebase_id = worktree
        .as_ref()
        .map(|item| item.codebase_id.clone())
        .or_else(|| task.codebase_ids.first().cloned())
        .unwrap_or_default();
    let codebase = if codebase_id.is_empty() {
        None
    } else {
        state.codebase_store.get(&codebase_id).await?
    };

    Ok(worktree
        .as_ref()
        .map(|item| item.worktree_path.clone())
        .or_else(|| codebase.as_ref().map(|item| item.repo_path.clone()))
        .unwrap_or_default())
}

async fn load_task_and_repo_path(
    state: &AppState,
    task_id: &str,
) -> Result<(Task, String), ServerError> {
    let task = state
        .task_store
        .get(task_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", task_id)))?;
    let repo_path = resolve_task_repo_path(state, &task).await?;
    Ok((task, repo_path))
}

async fn get_task_change_file(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeFileQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing file path or status".to_string()))?;
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing file path or status".to_string()))?;

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let diff = crate::git::get_repo_file_diff(
        &repo_path,
        &GitFileChange {
            path: path.to_string(),
            status: parse_file_change_status(status),
            previous_path: query.previous_path.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
        },
    );

    Ok(Json(serde_json::json!({ "diff": diff })))
}

async fn get_task_change_commit(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeCommitQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let sha = query
        .sha
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing commit sha".to_string()))?;

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let diff = crate::git::get_repo_commit_diff(&repo_path, sha);
    Ok(Json(serde_json::json!({ "diff": diff })))
}

async fn get_task_change_stats(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeStatsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let paths_param = query
        .paths
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing 'paths' query parameter".to_string()))?;

    let requested_paths: Vec<String> = paths_param
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();
    if requested_paths.is_empty() {
        return Err(ServerError::BadRequest("No valid paths provided".to_string()));
    }
    if requested_paths.len() > 100 {
        return Err(ServerError::BadRequest(
            "Too many paths requested. Maximum 100 per request.".to_string(),
        ));
    }

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let statuses: Vec<String> = query
        .statuses
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();

    let stats: Vec<serde_json::Value> = requested_paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let diff = crate::git::get_repo_file_diff(
                &repo_path,
                &GitFileChange {
                    path: path.clone(),
                    status: parse_file_change_status(
                        statuses.get(index).map(String::as_str).unwrap_or("modified"),
                    ),
                    previous_path: None,
                },
            );
            serde_json::json!({
                "path": path,
                "additions": diff.additions,
                "deletions": diff.deletions,
            })
        })
        .collect();

    let successful = stats
        .iter()
        .filter(|entry| entry.get("error").is_none())
        .count();

    Ok(Json(serde_json::json!({
        "stats": stats,
        "requested": requested_paths.len(),
        "successful": successful,
    })))
}

async fn create_task_artifact(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<CreateTaskArtifactRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    let artifact_type = body
        .artifact_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("A valid artifact type is required".to_string()))?;
    let artifact_type = ArtifactType::from_str(artifact_type)
        .ok_or_else(|| ServerError::BadRequest("A valid artifact type is required".to_string()))?;

    let agent_id = body
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ServerError::BadRequest("agentId is required for agent artifact submission".to_string())
        })?;

    let content = body
        .content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Artifact content is required".to_string()))?;

    let now = Utc::now();
    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type,
        task_id: task.id.clone(),
        workspace_id: task.workspace_id.clone(),
        provided_by_agent_id: Some(agent_id.to_string()),
        requested_by_agent_id: None,
        request_id: body
            .request_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        content: Some(content.to_string()),
        context: body
            .context
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        status: routa_core::models::artifact::ArtifactStatus::Provided,
        expires_at: None,
        metadata: body.metadata,
        created_at: now,
        updated_at: now,
    };
    state.artifact_store.save(&artifact).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "agent",
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "artifact": artifact })),
    ))
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

    let mut serialized_tasks = Vec::with_capacity(tasks.len());
    for task in &tasks {
        serialized_tasks.push(serialize_task_with_evidence(&state, task).await?);
    }

    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
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

    Ok(Json(serde_json::json!({
        "task": serialize_task_with_evidence(&state, &task).await?
    })))
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
    test_cases: Option<Vec<String>>,
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
    codebase_ids: Option<Vec<String>>,
    github_id: Option<String>,
    github_number: Option<i64>,
    github_url: Option<String>,
    github_repo: Option<String>,
    github_state: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let service = TaskApplicationService::new(state.clone());
    let plan = service.create_task(create_task_command(body)).await?;
    let mut task = plan.task;
    if let (Some(repo), Some(number)) = (task.github_repo.as_ref(), task.github_number) {
        if let Some(existing) = state
            .task_store
            .list_by_workspace(&task.workspace_id)
            .await?
            .into_iter()
            .find(|candidate| {
                candidate.github_repo.as_deref() == Some(repo.as_str())
                    && candidate.github_number == Some(number)
            })
        {
            return Err(ServerError::Conflict(format!(
                "GitHub issue #{} is already imported as task {}",
                number, existing.id
            )));
        }
        task.github_synced_at = Some(Utc::now());
    }
    let codebase = resolve_codebase(&state, &task.workspace_id, plan.repo_path.as_deref()).await?;

    if plan.create_github_issue {
        match resolve_github_repo_for_codebase(
            codebase
                .as_ref()
                .and_then(|item| item.source_url.as_deref()),
            codebase.as_ref().map(|item| item.repo_path.as_str()),
        ) {
            Some(repo) => match create_github_issue(
                &repo,
                &task.title,
                Some(&build_task_issue_body(
                    &task.objective,
                    task.test_cases.as_ref(),
                )),
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
                task.last_sync_error =
                    Some("Selected codebase is not linked to a GitHub repository.".to_string());
            }
        }
    }

    if plan.should_trigger_agent {
        if plan.entering_dev {
            if let (Some(ref cb), None) = (&codebase, &task.worktree_id) {
                match auto_create_worktree(&state, &task, cb).await {
                    Ok(worktree_id) => {
                        task.worktree_id = Some(worktree_id);
                    }
                    Err(err) => {
                        set_task_column(&mut task, "blocked");
                        task.last_sync_error = Some(format!("Worktree creation failed: {}", err));
                    }
                }
            }
        }

        let trigger_result = trigger_assigned_task_agent(
            &state,
            &mut task,
            codebase.as_ref().map(|item| item.repo_path.as_str()),
            codebase.as_ref().and_then(|item| item.branch.as_deref()),
        )
        .await;

        match trigger_result {
            Ok(()) => {
                task.last_sync_error = None;
            }
            Err(error) => {
                task.last_sync_error = Some(error);
            }
        }
    }

    tracing::info!(
        target: "routa_task_api",
        task_id = %task.id,
        column_id = ?task.column_id,
        trigger_session_id = ?task.trigger_session_id,
        assigned_provider = ?task.assigned_provider,
        assigned_role = ?task.assigned_role,
        status = %task.status.as_str(),
        "api.tasks.update_task before save"
    );
    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "created",
        Some(&task.id),
        "user",
    )
    .await;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "task": serialize_task_with_evidence(&state, &task).await?
        })),
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
    test_cases: Option<Vec<String>>,
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
    codebase_ids: Option<Vec<String>>,
    worktree_id: Option<serde_json::Value>,
}

fn create_task_command(body: CreateTaskRequest) -> CreateTaskCommand {
    CreateTaskCommand {
        title: body.title,
        objective: body.objective,
        workspace_id: body.workspace_id,
        session_id: body.session_id,
        scope: body.scope,
        acceptance_criteria: body.acceptance_criteria,
        verification_commands: body.verification_commands,
        test_cases: body.test_cases,
        dependencies: body.dependencies,
        parallel_group: body.parallel_group,
        board_id: body.board_id,
        column_id: body.column_id,
        position: body.position,
        priority: body.priority,
        labels: body.labels,
        assignee: body.assignee,
        assigned_provider: body.assigned_provider,
        assigned_role: body.assigned_role,
        assigned_specialist_id: body.assigned_specialist_id,
        assigned_specialist_name: body.assigned_specialist_name,
        create_github_issue: body.create_github_issue,
        repo_path: body.repo_path,
        codebase_ids: body.codebase_ids,
        github_id: body.github_id,
        github_number: body.github_number,
        github_url: body.github_url,
        github_repo: body.github_repo,
        github_state: body.github_state,
    }
}

fn update_task_command(body: UpdateTaskRequest) -> UpdateTaskCommand {
    UpdateTaskCommand {
        title: body.title,
        objective: body.objective,
        scope: body.scope,
        acceptance_criteria: body.acceptance_criteria,
        verification_commands: body.verification_commands,
        test_cases: body.test_cases,
        assigned_to: body.assigned_to,
        status: body.status,
        board_id: body.board_id,
        column_id: body.column_id,
        position: body.position,
        priority: body.priority,
        labels: body.labels,
        assignee: body.assignee,
        assigned_provider: body.assigned_provider,
        assigned_role: body.assigned_role,
        assigned_specialist_id: body.assigned_specialist_id,
        assigned_specialist_name: body.assigned_specialist_name,
        trigger_session_id: body.trigger_session_id,
        github_id: body.github_id,
        github_number: body.github_number,
        github_url: body.github_url,
        github_repo: body.github_repo,
        github_state: body.github_state,
        last_sync_error: body.last_sync_error,
        dependencies: body.dependencies,
        parallel_group: body.parallel_group,
        completion_summary: body.completion_summary,
        verification_report: body.verification_report,
        sync_to_github: body.sync_to_github,
        retry_trigger: body.retry_trigger,
        repo_path: body.repo_path,
        codebase_ids: body.codebase_ids,
        worktree_id: body.worktree_id,
    }
}

async fn update_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    ensure_transition_artifacts(&state, &id, &body).await?;
    let service = TaskApplicationService::new(state.clone());
    let plan = service.update_task(&id, update_task_command(body)).await?;
    let mut task = plan.task;

    if plan.should_sync_github {
        if let (Some(repo), Some(issue_number)) = (task.github_repo.clone(), task.github_number) {
            match update_github_issue(
                &repo,
                issue_number,
                &task.title,
                Some(&build_task_issue_body(
                    &task.objective,
                    task.test_cases.as_ref(),
                )),
                &task.labels,
                if task.status == TaskStatus::Completed {
                    "closed"
                } else {
                    "open"
                },
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

    if plan.should_trigger_agent {
        let codebase = if plan.repo_path.is_some() {
            resolve_codebase(&state, &task.workspace_id, plan.repo_path.as_deref()).await?
        } else if let Some(first_id) = task.codebase_ids.first() {
            state.codebase_store.get(first_id).await.ok().flatten()
        } else {
            resolve_codebase(&state, &task.workspace_id, None).await?
        };

        // Auto-create worktree when entering dev column (mirrors Next.js behavior)
        if plan.entering_dev {
            if let (Some(ref cb), None) = (&codebase, &task.worktree_id) {
                match auto_create_worktree(&state, &task, cb).await {
                    Ok(worktree_id) => {
                        task.worktree_id = Some(worktree_id);
                    }
                    Err(err) => {
                        set_task_column(&mut task, "blocked");
                        task.last_sync_error = Some(format!("Worktree creation failed: {}", err));
                        state.task_store.save(&task).await?;
                        emit_kanban_workspace_event(
                            &state,
                            &task.workspace_id,
                            "task",
                            "updated",
                            Some(&task.id),
                            "system",
                        )
                        .await;
                        return Ok(Json(serde_json::json!({ "task": task })));
                    }
                }
            }
        }

        let trigger_result = trigger_assigned_task_agent(
            &state,
            &mut task,
            codebase.as_ref().map(|item| item.repo_path.as_str()),
            codebase.as_ref().and_then(|item| item.branch.as_deref()),
        )
        .await;

        match trigger_result {
            Ok(()) => {
                task.last_sync_error = None;
            }
            Err(error) => {
                task.last_sync_error = Some(error);
            }
        }
    }

    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "user",
    )
    .await;
    Ok(Json(serde_json::json!({
        "task": serialize_task_with_evidence(&state, &task).await?
    })))
}

async fn serialize_task_with_evidence(
    state: &AppState,
    task: &routa_core::models::task::Task,
) -> Result<serde_json::Value, ServerError> {
    let evidence_summary = build_task_evidence_summary(state, task).await?;
    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,
        None => None,
    };
    let story_readiness = build_task_story_readiness(
        task,
        &resolve_next_required_task_fields(board.as_ref(), task.column_id.as_deref()),
    );
    let invest_validation = build_task_invest_validation(task);
    let mut task_value = serde_json::to_value(task)
        .map_err(|error| ServerError::Internal(format!("Failed to serialize task: {error}")))?;
    let task_object = task_value.as_object_mut().ok_or_else(|| {
        ServerError::Internal("Task payload must serialize to a JSON object".to_string())
    })?;
    task_object.insert(
        "artifactSummary".to_string(),
        serde_json::to_value(&evidence_summary.artifact).map_err(|error| {
            ServerError::Internal(format!(
                "Failed to serialize task artifact summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "evidenceSummary".to_string(),
        serde_json::to_value(&evidence_summary).map_err(|error| {
            ServerError::Internal(format!(
                "Failed to serialize task evidence summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "storyReadiness".to_string(),
        serde_json::to_value(&story_readiness).map_err(|error| {
            ServerError::Internal(format!(
                "Failed to serialize task story readiness summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "investValidation".to_string(),
        serde_json::to_value(&invest_validation).map_err(|error| {
            ServerError::Internal(format!(
                "Failed to serialize task INVEST validation summary: {error}"
            ))
        })?,
    );
    Ok(task_value)
}

async fn build_task_run_ledger(
    state: &AppState,
    task: &routa_core::models::task::Task,
) -> Result<Vec<TaskRunLedgerEntry>, ServerError> {
    let mut lane_sessions = task.lane_sessions.clone();
    lane_sessions.sort_by(|left, right| right.started_at.cmp(&left.started_at));

    let mut runs = Vec::with_capacity(lane_sessions.len());
    for lane_session in lane_sessions {
        let session = state
            .acp_session_store
            .get(&lane_session.session_id)
            .await?;
        let is_a2a = lane_session.transport.as_deref() == Some("a2a");
        let resume_target = if is_a2a {
            lane_session
                .external_task_id
                .clone()
                .map(|id| TaskRunResumeTarget {
                    r#type: "external_task".to_string(),
                    id,
                })
        } else {
            Some(TaskRunResumeTarget {
                r#type: "session".to_string(),
                id: lane_session.session_id.clone(),
            })
        };

        runs.push(TaskRunLedgerEntry {
            id: lane_session.session_id.clone(),
            kind: if is_a2a {
                "a2a_task".to_string()
            } else {
                "embedded_acp".to_string()
            },
            status: serde_json::to_value(&lane_session.status)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "unknown".to_string()),
            session_id: Some(lane_session.session_id.clone()),
            external_task_id: lane_session.external_task_id.clone(),
            context_id: lane_session.context_id.clone(),
            column_id: lane_session.column_id.clone(),
            step_id: lane_session.step_id.clone(),
            step_name: lane_session.step_name.clone(),
            provider: lane_session
                .provider
                .clone()
                .or_else(|| session.as_ref().and_then(|row| row.provider.clone())),
            specialist_name: lane_session.specialist_name.clone(),
            started_at: lane_session.started_at.clone(),
            completed_at: lane_session.completed_at.clone(),
            owner_instance_id: None,
            resume_target,
        });
    }

    Ok(runs)
}

async fn build_task_evidence_summary(
    state: &AppState,
    task: &routa_core::models::task::Task,
) -> Result<TaskEvidenceSummary, ServerError> {
    let artifacts = state.artifact_store.list_by_task(&task.id).await?;
    let mut by_type = BTreeMap::new();
    for artifact in &artifacts {
        let key = artifact.artifact_type.as_str().to_string();
        *by_type.entry(key).or_insert(0) += 1;
    }

    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,
        None => None,
    };
    let required_artifacts =
        resolve_next_required_artifacts(board.as_ref(), task.column_id.as_deref());
    let present_artifacts = by_type.keys().cloned().collect::<BTreeSet<_>>();
    let missing_required = required_artifacts
        .into_iter()
        .filter(|artifact| !present_artifacts.contains(artifact))
        .collect::<Vec<_>>();

    let latest_status = task
        .lane_sessions
        .last()
        .map(|session| task_lane_session_status_as_str(&session.status).to_string())
        .unwrap_or_else(|| {
            if task.session_ids.is_empty() {
                "idle".to_string()
            } else {
                "unknown".to_string()
            }
        });

    Ok(TaskEvidenceSummary {
        artifact: TaskArtifactSummary {
            total: artifacts.len(),
            by_type,
            required_satisfied: missing_required.is_empty(),
            missing_required,
        },
        verification: TaskVerificationSummary {
            has_verdict: task.verification_verdict.is_some(),
            verdict: task
                .verification_verdict
                .as_ref()
                .map(|verdict| verdict.as_str().to_string()),
            has_report: task
                .verification_report
                .as_ref()
                .is_some_and(|report| !report.trim().is_empty()),
        },
        completion: TaskCompletionSummary {
            has_summary: task
                .completion_summary
                .as_ref()
                .is_some_and(|summary| !summary.trim().is_empty()),
        },
        runs: TaskRunSummary {
            total: task.session_ids.len(),
            latest_status,
        },
    })
}

fn resolve_next_required_task_fields(
    board: Option<&KanbanBoard>,
    current_column_id: Option<&str>,
) -> Vec<String> {
    let current_column_id = current_column_id.unwrap_or("backlog").to_ascii_lowercase();
    let next_column_id = KANBAN_HAPPY_PATH_COLUMN_ORDER
        .iter()
        .position(|column_id| *column_id == current_column_id)
        .and_then(|index| KANBAN_HAPPY_PATH_COLUMN_ORDER.get(index + 1))
        .copied();
    let Some(next_column_id) = next_column_id else {
        return Vec::new();
    };

    board
        .and_then(|board| {
            board
                .columns
                .iter()
                .find(|column| column.id == next_column_id)
        })
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.required_task_fields.clone())
        .unwrap_or_default()
}

fn resolve_next_required_artifacts(
    board: Option<&KanbanBoard>,
    current_column_id: Option<&str>,
) -> Vec<String> {
    let current_column_id = current_column_id.unwrap_or("backlog").to_ascii_lowercase();
    let next_column_id = KANBAN_HAPPY_PATH_COLUMN_ORDER
        .iter()
        .position(|column_id| *column_id == current_column_id)
        .and_then(|index| KANBAN_HAPPY_PATH_COLUMN_ORDER.get(index + 1))
        .copied();
    let Some(next_column_id) = next_column_id else {
        return Vec::new();
    };

    board
        .and_then(|board| {
            board
                .columns
                .iter()
                .find(|column| column.id == next_column_id)
        })
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.required_artifacts.clone())
        .unwrap_or_default()
}

fn task_lane_session_status_as_str(status: &TaskLaneSessionStatus) -> &'static str {
    match status {
        TaskLaneSessionStatus::Running => "running",
        TaskLaneSessionStatus::Completed => "completed",
        TaskLaneSessionStatus::Failed => "failed",
        TaskLaneSessionStatus::TimedOut => "timed_out",
        TaskLaneSessionStatus::Transitioned => "transitioned",
    }
}

async fn ensure_transition_artifacts(
    state: &AppState,
    task_id: &str,
    body: &UpdateTaskRequest,
) -> Result<(), ServerError> {
    let Some(target_column_id) = body.column_id.as_deref() else {
        return Ok(());
    };
    let existing = state
        .task_store
        .get(task_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", task_id)))?;
    if existing.column_id.as_deref() == Some(target_column_id) {
        return Ok(());
    }

    let Some(board_id) = body.board_id.as_deref().or(existing.board_id.as_deref()) else {
        return Ok(());
    };
    let Some(board) = state.kanban_store.get(board_id).await? else {
        return Ok(());
    };
    let Some(target_column) = board
        .columns
        .iter()
        .find(|column| column.id == target_column_id)
    else {
        return Ok(());
    };

    if let Some(required_task_fields) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_task_fields.as_ref())
    {
        let mut candidate_task = existing.clone();
        if let Some(title) = body.title.as_ref() {
            candidate_task.title = title.clone();
        }
        if let Some(objective) = body.objective.as_ref() {
            candidate_task.objective = objective.clone();
        }
        if let Some(scope) = body.scope.as_ref() {
            candidate_task.scope = Some(scope.clone());
        }
        if let Some(acceptance_criteria) = body.acceptance_criteria.as_ref() {
            candidate_task.acceptance_criteria = Some(acceptance_criteria.clone());
        }
        if let Some(verification_commands) = body.verification_commands.as_ref() {
            candidate_task.verification_commands = Some(verification_commands.clone());
        }
        if let Some(test_cases) = body.test_cases.as_ref() {
            candidate_task.test_cases = Some(test_cases.clone());
        }
        if let Some(dependencies) = body.dependencies.as_ref() {
            candidate_task.dependencies = dependencies.clone();
        }
        if let Some(parallel_group) = body.parallel_group.as_ref() {
            candidate_task.parallel_group = Some(parallel_group.clone());
        }

        let readiness = build_task_story_readiness(&candidate_task, required_task_fields);
        if !readiness.ready {
            let missing_task_fields = readiness
                .missing
                .iter()
                .map(|field| match field.as_str() {
                    "acceptance_criteria" => "acceptance criteria",
                    "verification_commands" => "verification commands",
                    "test_cases" => "test cases",
                    "verification_plan" => "verification plan",
                    "dependencies_declared" => "dependency declaration",
                    other => other,
                })
                .collect::<Vec<_>>();
            return Err(ServerError::BadRequest(format!(
                "Cannot move task to \"{}\": missing required task fields: {}. Please complete this story definition before moving the task.",
                target_column.name,
                missing_task_fields.join(", ")
            )));
        }
    }

    let Some(required_artifacts) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_artifacts.as_ref())
    else {
        return Ok(());
    };

    let mut missing_artifacts = Vec::new();
    for artifact_name in required_artifacts {
        let artifact_type = ArtifactType::from_str(artifact_name).ok_or_else(|| {
            ServerError::BadRequest(format!(
                "Invalid required artifact type configured on column {}: {}",
                target_column.id, artifact_name
            ))
        })?;
        let artifacts = state
            .artifact_store
            .list_by_task_and_type(task_id, &artifact_type)
            .await?;
        if artifacts.is_empty() {
            missing_artifacts.push(artifact_name.clone());
        }
    }

    if missing_artifacts.is_empty() {
        return Ok(());
    }

    Err(ServerError::BadRequest(format!(
        "Cannot move task to \"{}\": missing required artifacts: {}. Please provide these artifacts before moving the task.",
        target_column.name,
        missing_artifacts.join(", ")
    )))
}

async fn delete_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;
    state.task_store.delete(&id).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "deleted",
        Some(&id),
        "user",
    )
    .await;
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
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;
    state.task_store.update_status(&id, &status).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&id),
        "user",
    )
    .await;
    Ok(Json(serde_json::json!({ "updated": true })))
}

async fn find_ready_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    let tasks = state.task_store.find_ready_tasks(workspace_id).await?;
    let mut serialized_tasks = Vec::with_capacity(tasks.len());
    for task in &tasks {
        serialized_tasks.push(serialize_task_with_evidence(&state, task).await?);
    }
    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
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
    if count > 0 {
        emit_kanban_workspace_event(&state, workspace_id, "task", "deleted", None, "user").await;
    }
    Ok(Json(serde_json::json!({ "deleted": count })))
}
