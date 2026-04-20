use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use routa_core::events::{AgentEvent, AgentEventType};
use routa_core::kanban::set_task_column;
use routa_core::models::artifact::{Artifact, ArtifactType};

use super::changes;
use super::dto::{
    CreateTaskArtifactRequest, CreateTaskRequest, ListTasksQuery, UpdateStatusRequest,
    UpdateTaskRequest,
};
use super::evidence::{
    build_task_run_ledger, ensure_transition_artifacts, serialize_task_with_evidence,
    serialize_tasks_batch,
};

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
        .route("/{id}/changes", get(changes::get_task_changes))
        .route("/{id}/changes/file", get(changes::get_task_change_file))
        .route("/{id}/changes/commit", get(changes::get_task_change_commit))
        .route("/{id}/changes/stats", get(changes::get_task_change_stats))
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
            agent_id: format!("kanban-{source}"),
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

async fn list_task_artifacts(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

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
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

    Ok(Json(serde_json::json!({
        "runs": build_task_run_ledger(&state, &task).await?
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
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

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
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {status_str}")))?;
        state
            .task_store
            .list_by_status(workspace_id, &status)
            .await?
    } else {
        state.task_store.list_by_workspace(workspace_id).await?
    };

    // Use batch serialization to avoid N+1 queries
    let serialized_tasks = serialize_tasks_batch(&state, &tasks).await?;

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
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

    Ok(Json(serde_json::json!({
        "task": serialize_task_with_evidence(&state, &task).await?
    })))
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

    let mut trigger_cwd = codebase.as_ref().map(|item| item.repo_path.clone());
    let mut trigger_branch = codebase.as_ref().and_then(|item| item.branch.clone());

    if plan.should_trigger_agent {
        if plan.entering_dev {
            if let (Some(ref cb), None) = (&codebase, &task.worktree_id) {
                match auto_create_worktree(&state, &task, cb).await {
                    Ok(worktree_id) => {
                        if let Ok(Some(worktree)) = state.worktree_store.get(&worktree_id).await {
                            trigger_cwd = Some(worktree.worktree_path);
                            trigger_branch = Some(worktree.branch);
                        }
                        task.worktree_id = Some(worktree_id);
                    }
                    Err(err) => {
                        set_task_column(&mut task, "blocked");
                        task.last_sync_error = Some(format!("Worktree creation failed: {err}"));
                    }
                }
            }
        }

        let trigger_result = trigger_assigned_task_agent(
            &state,
            &mut task,
            trigger_cwd.as_deref(),
            trigger_branch.as_deref(),
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
        verification_verdict: body.verification_verdict,
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
        let mut trigger_cwd = codebase.as_ref().map(|item| item.repo_path.clone());
        let mut trigger_branch = codebase.as_ref().and_then(|item| item.branch.clone());

        // Auto-create worktree when entering dev column (mirrors Next.js behavior)
        if plan.entering_dev {
            if let (Some(ref cb), None) = (&codebase, &task.worktree_id) {
                match auto_create_worktree(&state, &task, cb).await {
                    Ok(worktree_id) => {
                        if let Ok(Some(worktree)) = state.worktree_store.get(&worktree_id).await {
                            trigger_cwd = Some(worktree.worktree_path);
                            trigger_branch = Some(worktree.branch);
                        }
                        task.worktree_id = Some(worktree_id);
                    }
                    Err(err) => {
                        set_task_column(&mut task, "blocked");
                        task.last_sync_error = Some(format!("Worktree creation failed: {err}"));
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
            trigger_cwd.as_deref(),
            trigger_branch.as_deref(),
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

async fn delete_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

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

    Ok(Json(serde_json::json!({ "success": true })))
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
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;
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

    // Use batch serialization to avoid N+1 queries
    let serialized_tasks = serialize_tasks_batch(&state, &tasks).await?;

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
