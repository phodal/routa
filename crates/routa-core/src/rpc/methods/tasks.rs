//! RPC methods for task management.
//!
//! Methods:
//! - `tasks.list`         — list tasks with optional filters
//! - `tasks.get`          — get a single task by id
//! - `tasks.create`       — create a new task
//! - `tasks.delete`       — delete a task
//! - `tasks.updateStatus` — update a task's status
//! - `tasks.findReady`    — find tasks ready for execution
//! - `tasks.listArtifacts` — list artifacts attached to a task
//! - `tasks.provideArtifact` — attach an artifact to a task

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::models::artifact::{Artifact, ArtifactStatus, ArtifactType};
use crate::models::kanban::KanbanBoard;
use crate::models::task::{
    build_task_invest_validation, build_task_story_readiness, Task, TaskLaneSessionStatus,
    TaskStatus,
};
use crate::rpc::error::RpcError;
use crate::state::AppState;

const KANBAN_HAPPY_PATH_COLUMN_ORDER: [&str; 5] = ["backlog", "todo", "dev", "review", "done"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifactSummary {
    pub total: usize,
    pub by_type: BTreeMap<String, usize>,
    pub required_satisfied: bool,
    pub missing_required: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskVerificationSummary {
    pub has_verdict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    pub has_report: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletionSummary {
    pub has_summary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunSummary {
    pub total: usize,
    pub latest_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvidenceSummary {
    pub artifact: TaskArtifactSummary,
    pub verification: TaskVerificationSummary,
    pub completion: TaskCompletionSummary,
    pub runs: TaskRunSummary,
}

// ---------------------------------------------------------------------------
// tasks.list
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
}

fn default_workspace_id() -> String {
    "default".into()
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub tasks: Vec<serde_json::Value>,
}

pub async fn list(state: &AppState, params: ListParams) -> Result<ListResult, RpcError> {
    let tasks = if let Some(session_id) = &params.session_id {
        // Filter by session_id takes priority
        state.task_store.list_by_session(session_id).await?
    } else if let Some(assignee) = &params.assigned_to {
        state.task_store.list_by_assignee(assignee).await?
    } else if let Some(status_str) = &params.status {
        let status = TaskStatus::from_str(status_str)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {status_str}")))?;
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

    Ok(ListResult {
        tasks: serialize_tasks_with_evidence(state, &tasks).await?,
    })
}

// ---------------------------------------------------------------------------
// tasks.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<serde_json::Value, RpcError> {
    let task = state
        .task_store
        .get(&params.id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Task {} not found", params.id)))?;
    serialize_task_with_evidence(state, &task).await
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
    pub session_id: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateResult {
    pub task: serde_json::Value,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        params.title,
        params.objective,
        params.workspace_id,
        params.session_id,
        params.scope,
        params.acceptance_criteria,
        params.verification_commands,
        params.test_cases,
        params.dependencies,
        params.parallel_group,
    );

    state.task_store.save(&task).await?;
    Ok(CreateResult {
        task: serialize_task_with_evidence(state, &task).await?,
    })
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
    Ok(ListResult {
        tasks: serialize_tasks_with_evidence(state, &tasks).await?,
    })
}

// ---------------------------------------------------------------------------
// tasks.listArtifacts
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArtifactsParams {
    pub task_id: String,
    #[serde(rename = "type")]
    pub artifact_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListArtifactsResult {
    pub artifacts: Vec<Artifact>,
}

pub async fn list_artifacts(
    state: &AppState,
    params: ListArtifactsParams,
) -> Result<ListArtifactsResult, RpcError> {
    let artifacts = if let Some(artifact_type) = params.artifact_type.as_deref() {
        let artifact_type = parse_artifact_type(artifact_type)?;
        state
            .artifact_store
            .list_by_task_and_type(&params.task_id, &artifact_type)
            .await?
    } else {
        state.artifact_store.list_by_task(&params.task_id).await?
    };

    Ok(ListArtifactsResult { artifacts })
}

// ---------------------------------------------------------------------------
// tasks.provideArtifact
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvideArtifactParams {
    pub task_id: String,
    pub agent_id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub content: String,
    pub context: Option<String>,
    pub request_id: Option<String>,
    pub metadata: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct ProvideArtifactResult {
    pub artifact: Artifact,
}

pub async fn provide_artifact(
    state: &AppState,
    params: ProvideArtifactParams,
) -> Result<ProvideArtifactResult, RpcError> {
    let task = state
        .task_store
        .get(&params.task_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Task {} not found", params.task_id)))?;

    let agent_id = params.agent_id.trim();
    if agent_id.is_empty() {
        return Err(RpcError::BadRequest(
            "agentId is required for artifact submission".to_string(),
        ));
    }

    let content = params.content.trim();
    if content.is_empty() {
        return Err(RpcError::BadRequest(
            "artifact content cannot be blank".to_string(),
        ));
    }

    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type: parse_artifact_type(&params.artifact_type)?,
        task_id: task.id,
        workspace_id: task.workspace_id,
        provided_by_agent_id: Some(agent_id.to_string()),
        requested_by_agent_id: None,
        request_id: params.request_id,
        content: Some(content.to_string()),
        context: params
            .context
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        status: ArtifactStatus::Provided,
        expires_at: None,
        metadata: params.metadata,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    state.artifact_store.save(&artifact).await?;
    Ok(ProvideArtifactResult { artifact })
}

fn parse_artifact_type(value: &str) -> Result<ArtifactType, RpcError> {
    ArtifactType::from_str(value).ok_or_else(|| {
        RpcError::BadRequest(format!(
            "Invalid artifact type: {value}. Expected one of: screenshot, test_results, code_diff, logs"
        ))
    })
}

async fn serialize_tasks_with_evidence(
    state: &AppState,
    tasks: &[Task],
) -> Result<Vec<serde_json::Value>, RpcError> {
    let mut serialized = Vec::with_capacity(tasks.len());
    for task in tasks {
        serialized.push(serialize_task_with_evidence(state, task).await?);
    }
    Ok(serialized)
}

async fn serialize_task_with_evidence(
    state: &AppState,
    task: &Task,
) -> Result<serde_json::Value, RpcError> {
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
        .map_err(|error| RpcError::Internal(format!("Failed to serialize task: {error}")))?;
    let task_object = task_value.as_object_mut().ok_or_else(|| {
        RpcError::Internal("Task payload must serialize to a JSON object".to_string())
    })?;
    task_object.insert(
        "artifactSummary".to_string(),
        serde_json::to_value(&evidence_summary.artifact).map_err(|error| {
            RpcError::Internal(format!(
                "Failed to serialize task artifact summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "evidenceSummary".to_string(),
        serde_json::to_value(&evidence_summary).map_err(|error| {
            RpcError::Internal(format!(
                "Failed to serialize task evidence summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "storyReadiness".to_string(),
        serde_json::to_value(&story_readiness).map_err(|error| {
            RpcError::Internal(format!(
                "Failed to serialize task story readiness summary: {error}"
            ))
        })?,
    );
    task_object.insert(
        "investValidation".to_string(),
        serde_json::to_value(&invest_validation).map_err(|error| {
            RpcError::Internal(format!(
                "Failed to serialize task INVEST validation summary: {error}"
            ))
        })?,
    );
    Ok(task_value)
}

async fn build_task_evidence_summary(
    state: &AppState,
    task: &Task,
) -> Result<TaskEvidenceSummary, RpcError> {
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

fn task_lane_session_status_as_str(status: &TaskLaneSessionStatus) -> &'static str {
    match status {
        TaskLaneSessionStatus::Running => "running",
        TaskLaneSessionStatus::Completed => "completed",
        TaskLaneSessionStatus::Failed => "failed",
        TaskLaneSessionStatus::TimedOut => "timed_out",
        TaskLaneSessionStatus::Transitioned => "transitioned",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::kanban::KanbanColumnAutomation;
    use crate::models::task::{TaskLaneSession, VerificationVerdict};
    use crate::{AppState, AppStateInner, Database};
    use std::sync::Arc;

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state: AppState = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        state
    }

    #[tokio::test]
    async fn provide_and_list_artifacts_roundtrip() {
        let state = setup_state().await;
        let created = create(
            &state,
            CreateParams {
                title: "Artifact task".to_string(),
                objective: "Store screenshot evidence".to_string(),
                workspace_id: "default".to_string(),
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
            },
        )
        .await
        .expect("task should be created");
        let created_task_id = created.task["id"]
            .as_str()
            .expect("created task id")
            .to_string();

        let provided = provide_artifact(
            &state,
            ProvideArtifactParams {
                task_id: created_task_id.clone(),
                agent_id: "agent-1".to_string(),
                artifact_type: "screenshot".to_string(),
                content: "base64-content".to_string(),
                context: Some("Verification screenshot".to_string()),
                request_id: None,
                metadata: None,
            },
        )
        .await
        .expect("artifact should be created");

        assert_eq!(provided.artifact.artifact_type, ArtifactType::Screenshot);
        assert_eq!(
            provided.artifact.provided_by_agent_id.as_deref(),
            Some("agent-1")
        );

        let listed = list_artifacts(
            &state,
            ListArtifactsParams {
                task_id: created_task_id,
                artifact_type: Some("screenshot".to_string()),
            },
        )
        .await
        .expect("artifacts should be listed");

        assert_eq!(listed.artifacts.len(), 1);
        assert_eq!(
            listed.artifacts[0].context.as_deref(),
            Some("Verification screenshot")
        );
    }

    #[tokio::test]
    async fn rpc_task_methods_include_evidence_summary() {
        let state = setup_state().await;
        let mut board = state
            .kanban_store
            .ensure_default_board("default")
            .await
            .expect("default board should exist");
        let dev_column = board
            .columns
            .iter_mut()
            .find(|column| column.id == "dev")
            .expect("dev column");
        dev_column.automation = Some(KanbanColumnAutomation {
            enabled: true,
            required_artifacts: Some(vec!["screenshot".to_string()]),
            required_task_fields: Some(vec![
                "scope".to_string(),
                "acceptance_criteria".to_string(),
                "verification_plan".to_string(),
            ]),
            ..Default::default()
        });
        state
            .kanban_store
            .update(&board)
            .await
            .expect("board should update");

        let mut task = Task::new(
            "task-rpc-1".to_string(),
            "RPC evidence".to_string(),
            "Return parity task payload".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.board_id = Some(board.id.clone());
        task.column_id = Some("todo".to_string());
        task.session_ids = vec!["session-1".to_string()];
        task.lane_sessions = vec![TaskLaneSession {
            session_id: "session-1".to_string(),
            routa_agent_id: None,
            column_id: Some("todo".to_string()),
            column_name: Some("Todo".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: None,
            role: None,
            specialist_id: None,
            specialist_name: None,
            transport: None,
            external_task_id: None,
            context_id: None,
            attempt: None,
            loop_mode: None,
            completion_requirement: None,
            objective: None,
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: "2026-03-27T00:00:00Z".to_string(),
            completed_at: None,
        }];
        task.completion_summary = Some("Done".to_string());
        task.verification_verdict = Some(VerificationVerdict::Approved);
        task.verification_report = Some("Verified".to_string());
        state
            .task_store
            .save(&task)
            .await
            .expect("task should save");

        let artifact = Artifact {
            id: "artifact-rpc-1".to_string(),
            artifact_type: ArtifactType::Screenshot,
            task_id: task.id.clone(),
            workspace_id: task.workspace_id.clone(),
            provided_by_agent_id: Some("agent-1".to_string()),
            requested_by_agent_id: None,
            request_id: None,
            content: Some("base64".to_string()),
            context: None,
            status: ArtifactStatus::Provided,
            expires_at: None,
            metadata: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        state
            .artifact_store
            .save(&artifact)
            .await
            .expect("artifact should save");

        let get_value = get(
            &state,
            GetParams {
                id: task.id.clone(),
            },
        )
        .await
        .expect("task should load");
        assert_eq!(get_value["artifactSummary"]["total"], serde_json::json!(1));
        assert_eq!(
            get_value["evidenceSummary"]["artifact"]["requiredSatisfied"],
            serde_json::json!(true)
        );
        assert_eq!(
            get_value["evidenceSummary"]["verification"]["verdict"],
            serde_json::json!("APPROVED")
        );
        assert_eq!(
            get_value["evidenceSummary"]["runs"]["latestStatus"],
            serde_json::json!("running")
        );
        assert_eq!(
            get_value["storyReadiness"]["requiredTaskFields"],
            serde_json::json!(["scope", "acceptance_criteria", "verification_plan"])
        );
        assert_eq!(
            get_value["storyReadiness"]["ready"],
            serde_json::json!(false)
        );
        assert_eq!(
            get_value["investValidation"]["source"],
            serde_json::json!("heuristic")
        );

        let listed = list(
            &state,
            ListParams {
                workspace_id: "default".to_string(),
                session_id: None,
                status: None,
                assigned_to: None,
            },
        )
        .await
        .expect("tasks should list");
        assert_eq!(listed.tasks.len(), 1);
        assert_eq!(
            listed.tasks[0]["evidenceSummary"]["completion"]["hasSummary"],
            serde_json::json!(true)
        );
        assert_eq!(
            listed.tasks[0]["storyReadiness"]["ready"],
            serde_json::json!(false)
        );

        let ready = find_ready(
            &state,
            FindReadyParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("ready tasks should list");
        assert_eq!(ready.tasks.len(), 1);
        assert_eq!(
            ready.tasks[0]["artifactSummary"]["byType"]["screenshot"],
            serde_json::json!(1)
        );
        assert_eq!(
            ready.tasks[0]["investValidation"]["source"],
            serde_json::json!("heuristic")
        );

        let created = create(
            &state,
            CreateParams {
                title: "Fresh task".to_string(),
                objective: "No evidence yet".to_string(),
                workspace_id: "default".to_string(),
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
            },
        )
        .await
        .expect("task should create");
        assert_eq!(
            created.task["artifactSummary"]["total"],
            serde_json::json!(0)
        );
        assert_eq!(
            created.task["evidenceSummary"]["runs"]["latestStatus"],
            serde_json::json!("idle")
        );
        assert_eq!(
            created.task["storyReadiness"]["requiredTaskFields"],
            serde_json::json!([])
        );
    }
}
