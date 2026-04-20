use crate::application::tasks::{CreateTaskCommand, TaskApplicationService};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use routa_core::workflow::schema::{WorkflowDefinition, WorkflowStep};
use serde::Deserialize;
use std::path::PathBuf;

use crate::error::ServerError;
use crate::state::AppState;

const FLOWS_SUBDIR: &str = "resources/flows";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_workflows).post(create_workflow))
        .route(
            "/{id}",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route("/{id}/trigger", axum::routing::post(trigger_workflow))
}

fn flows_dir() -> Result<PathBuf, ServerError> {
    let cwd = std::env::current_dir()
        .map_err(|e| ServerError::Internal(format!("Failed to get cwd: {e}")))?;
    let dir = cwd.join(FLOWS_SUBDIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| ServerError::Internal(format!("Failed to create flows dir: {e}")))?;
    }
    Ok(dir)
}

fn parse_workflow(id: &str, content: &str) -> serde_json::Value {
    let parsed: serde_yaml::Value = serde_yaml::from_str(content).unwrap_or_default();
    let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or(id);
    let description = parsed
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let version = parsed
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("1.0");
    let trigger = parsed
        .get("trigger")
        .map(|v| serde_json::to_value(v).unwrap_or_default())
        .unwrap_or(serde_json::Value::Null);
    let steps = parsed
        .get("steps")
        .map(|v| serde_json::to_value(v).unwrap_or_default())
        .unwrap_or(serde_json::json!([]));

    serde_json::json!({
        "id": id,
        "name": name,
        "description": description,
        "version": version,
        "trigger": trigger,
        "steps": steps,
        "yamlContent": content,
    })
}

fn workflow_file_path(id: &str) -> Result<PathBuf, ServerError> {
    Ok(flows_dir()?.join(format!("{id}.yaml")))
}

fn load_workflow_definition(id: &str) -> Result<WorkflowDefinition, ServerError> {
    let file_path = workflow_file_path(id)?;
    if !file_path.exists() {
        return Err(ServerError::NotFound("Workflow not found".to_string()));
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| ServerError::Internal(format!("Failed to read workflow: {e}")))?;

    serde_yaml::from_str(&content)
        .map_err(|e| ServerError::BadRequest(format!("Invalid workflow YAML: {e}")))
}

fn require_workspace_id(value: &str) -> Result<String, ServerError> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ServerError::BadRequest(
            "workspaceId is required".to_string(),
        ));
    }
    Ok(normalized.to_string())
}

fn group_steps_by_parallel(steps: &[WorkflowStep]) -> Vec<Vec<WorkflowStep>> {
    let mut groups: Vec<Vec<WorkflowStep>> = Vec::new();
    let mut current_group: Vec<WorkflowStep> = Vec::new();
    let mut current_parallel_group: Option<String> = None;

    for step in steps {
        if let Some(parallel_group) = &step.parallel_group {
            if current_parallel_group.as_deref() == Some(parallel_group.as_str()) {
                current_group.push(step.clone());
            } else {
                if !current_group.is_empty() {
                    groups.push(current_group);
                }
                current_group = vec![step.clone()];
                current_parallel_group = Some(parallel_group.clone());
            }
        } else {
            if !current_group.is_empty() {
                groups.push(current_group);
                current_group = Vec::new();
            }
            groups.push(vec![step.clone()]);
            current_parallel_group = None;
        }
    }

    if !current_group.is_empty() {
        groups.push(current_group);
    }

    groups
}

fn build_step_prompt(
    step: &WorkflowStep,
    definition: &WorkflowDefinition,
    trigger_payload: Option<&str>,
) -> String {
    let mut prompt = step.input.clone().unwrap_or_default();
    prompt = prompt.replace("${trigger.payload}", trigger_payload.unwrap_or_default());

    for (key, value) in &definition.variables {
        prompt = prompt.replace(&format!("${{variables.{key}}}"), value);
        prompt = prompt.replace(&format!("${{{key}}}"), value);
    }

    if prompt.trim().is_empty() {
        format!("Execute step: {}", step.name)
    } else {
        prompt
    }
}

/// GET /api/workflows — List all workflow YAML definitions.
async fn list_workflows() -> Result<Json<serde_json::Value>, ServerError> {
    let dir = flows_dir()?;
    let mut workflows = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| ServerError::Internal(format!("Failed to read flows dir: {e}")))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "yaml" && ext != "yml" {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(content) => workflows.push(parse_workflow(&id, &content)),
            Err(_) => continue,
        }
    }

    Ok(Json(serde_json::json!({ "workflows": workflows })))
}

#[derive(Debug, Deserialize)]
struct CreateWorkflowInput {
    id: String,
    #[serde(rename = "yamlContent")]
    yaml_content: String,
}

/// POST /api/workflows — Create a new workflow YAML file.
async fn create_workflow(
    Json(body): Json<CreateWorkflowInput>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    // Validate ID format
    let id_re = regex::Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap();
    if !id_re.is_match(&body.id) {
        return Err(ServerError::BadRequest(
            "ID must contain only letters, numbers, hyphens, and underscores".to_string(),
        ));
    }

    // Validate YAML
    let parsed: serde_yaml::Value = serde_yaml::from_str(&body.yaml_content)
        .map_err(|e| ServerError::BadRequest(format!("Invalid YAML: {e}")))?;

    let has_name = parsed.get("name").and_then(|v| v.as_str()).is_some();
    let has_steps = parsed
        .get("steps")
        .and_then(|v| v.as_sequence())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if !has_name || !has_steps {
        return Err(ServerError::BadRequest(
            "Workflow YAML must have name and at least one step".to_string(),
        ));
    }

    let dir = flows_dir()?;
    let file_path = dir.join(format!("{}.yaml", body.id));

    if file_path.exists() {
        return Err(ServerError::Conflict(format!(
            "Workflow with id \"{}\" already exists",
            body.id
        )));
    }

    std::fs::write(&file_path, &body.yaml_content)
        .map_err(|e| ServerError::Internal(format!("Failed to write workflow: {e}")))?;

    let workflow = parse_workflow(&body.id, &body.yaml_content);
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "workflow": workflow })),
    ))
}

/// GET /api/workflows/{id} — Get a specific workflow.
async fn get_workflow(Path(id): Path<String>) -> Result<Json<serde_json::Value>, ServerError> {
    let file_path = workflow_file_path(&id)?;
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| ServerError::Internal(format!("Failed to read workflow: {e}")))?;

    Ok(Json(
        serde_json::json!({ "workflow": parse_workflow(&id, &content) }),
    ))
}

#[derive(Debug, Deserialize)]
struct UpdateWorkflowInput {
    #[serde(rename = "yamlContent")]
    yaml_content: String,
}

/// PUT /api/workflows/{id} — Update a workflow YAML file.
async fn update_workflow(
    Path(id): Path<String>,
    Json(body): Json<UpdateWorkflowInput>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let dir = flows_dir()?;
    let file_path = dir.join(format!("{id}.yaml"));

    if !file_path.exists() {
        return Err(ServerError::NotFound("Workflow not found".to_string()));
    }

    // Validate YAML
    let parsed: serde_yaml::Value = serde_yaml::from_str(&body.yaml_content)
        .map_err(|e| ServerError::BadRequest(format!("Invalid YAML: {e}")))?;

    let has_name = parsed.get("name").and_then(|v| v.as_str()).is_some();
    let has_steps = parsed
        .get("steps")
        .and_then(|v| v.as_sequence())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if !has_name || !has_steps {
        return Err(ServerError::BadRequest(
            "Workflow YAML must have name and at least one step".to_string(),
        ));
    }

    std::fs::write(&file_path, &body.yaml_content)
        .map_err(|e| ServerError::Internal(format!("Failed to write workflow: {e}")))?;

    Ok(Json(
        serde_json::json!({ "workflow": parse_workflow(&id, &body.yaml_content) }),
    ))
}

/// DELETE /api/workflows/{id} — Delete a workflow YAML file.
async fn delete_workflow(Path(id): Path<String>) -> Result<Json<serde_json::Value>, ServerError> {
    let dir = flows_dir()?;
    let file_path = dir.join(format!("{id}.yaml"));

    if !file_path.exists() {
        return Err(ServerError::NotFound("Workflow not found".to_string()));
    }

    std::fs::remove_file(&file_path)
        .map_err(|e| ServerError::Internal(format!("Failed to delete workflow: {e}")))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriggerWorkflowInput {
    workspace_id: String,
    trigger_payload: Option<String>,
}

/// POST /api/workflows/{id}/trigger — start a workflow run inside a workspace.
async fn trigger_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<TriggerWorkflowInput>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let workspace_id = require_workspace_id(&body.workspace_id)?;
    let Some(_) = state.workspace_store.get(&workspace_id).await? else {
        return Err(ServerError::NotFound("Workspace not found".to_string()));
    };

    let definition = load_workflow_definition(&id)?;
    let workflow_run_id = uuid::Uuid::new_v4().to_string();
    let task_service = TaskApplicationService::new(state.clone());
    let mut task_ids = Vec::new();

    for group in group_steps_by_parallel(&definition.steps) {
        let dependencies = if task_ids.is_empty() {
            None
        } else {
            Some(task_ids.clone())
        };

        for step in group {
            let plan = task_service
                .create_task(CreateTaskCommand {
                    title: format!("[{}] {}", definition.name, step.name),
                    objective: build_step_prompt(
                        &step,
                        &definition,
                        body.trigger_payload.as_deref(),
                    ),
                    workspace_id: Some(workspace_id.clone()),
                    session_id: None,
                    scope: None,
                    acceptance_criteria: None,
                    verification_commands: None,
                    test_cases: None,
                    dependencies: dependencies.clone(),
                    parallel_group: step.parallel_group.clone(),
                    board_id: None,
                    column_id: None,
                    position: None,
                    priority: None,
                    labels: Some(vec![
                        "workflow".to_string(),
                        id.clone(),
                        workflow_run_id.clone(),
                    ]),
                    assignee: None,
                    assigned_provider: None,
                    assigned_role: None,
                    assigned_specialist_id: Some(step.specialist.clone()),
                    assigned_specialist_name: Some(step.specialist.clone()),
                    create_github_issue: Some(false),
                    repo_path: None,
                    codebase_ids: None,
                    github_id: None,
                    github_number: None,
                    github_url: None,
                    github_repo: None,
                    github_state: None,
                })
                .await?;

            state.task_store.save(&plan.task).await?;
            task_ids.push(plan.task.id);
        }
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "workflowRunId": workflow_run_id,
            "taskIds": task_ids,
        })),
    ))
}
