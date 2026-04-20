use routa_core::models::artifact::{Artifact, ArtifactType};
use routa_core::models::kanban::KanbanBoard;
use routa_core::models::task::{
    build_task_invest_validation, build_task_story_readiness, Task, TaskLaneSessionStatus,
};
use std::collections::{BTreeMap, BTreeSet};

use super::dto::{
    TaskArtifactSummary, TaskCompletionSummary, TaskEvidenceSummary, TaskRunLedgerEntry,
    TaskRunResumeTarget, TaskRunSummary, TaskVerificationSummary, UpdateTaskRequest,
};
use crate::error::ServerError;
use crate::state::AppState;

const KANBAN_HAPPY_PATH_COLUMN_ORDER: [&str; 5] = ["backlog", "todo", "dev", "review", "done"];

/// Serialize task with evidence, readiness, and validation summaries
/// Queries board and artifacts if not already loaded (for single-task operations)
pub async fn serialize_task_with_evidence(
    state: &AppState,
    task: &Task,
) -> Result<serde_json::Value, ServerError> {
    // Load board once
    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,
        None => None,
    };

    // Build evidence summary with pre-loaded board
    let evidence_summary =
        build_task_evidence_summary_with_board(state, task, board.as_ref()).await?;

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

/// Build task run ledger from lane sessions
pub async fn build_task_run_ledger(
    state: &AppState,
    task: &Task,
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
            started_at: Some(lane_session.started_at.clone()),
            completed_at: lane_session.completed_at.clone(),
            owner_instance_id: None,
            resume_target,
        });
    }

    Ok(runs)
}

/// Build task evidence summary including artifacts, verification, completion, and runs
/// Queries artifacts and board (for backward compatibility)
pub async fn build_task_evidence_summary(
    state: &AppState,
    task: &Task,
) -> Result<TaskEvidenceSummary, ServerError> {
    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,
        None => None,
    };
    build_task_evidence_summary_with_board(state, task, board.as_ref()).await
}

/// Build task evidence summary with pre-loaded board to avoid duplicate queries
async fn build_task_evidence_summary_with_board(
    state: &AppState,
    task: &Task,
    board: Option<&KanbanBoard>,
) -> Result<TaskEvidenceSummary, ServerError> {
    let artifacts = state.artifact_store.list_by_task(&task.id).await?;
    let mut by_type = BTreeMap::new();
    for artifact in &artifacts {
        let key = artifact.artifact_type.as_str().to_string();
        *by_type.entry(key).or_insert(0) += 1;
    }

    let required_artifacts = resolve_next_required_artifacts(board, task.column_id.as_deref());
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

/// Resolve required task fields for next column transition
pub fn resolve_next_required_task_fields(
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

/// Resolve required artifacts for next column transition
pub fn resolve_next_required_artifacts(
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

/// Convert TaskLaneSessionStatus to string
pub fn task_lane_session_status_as_str(status: &TaskLaneSessionStatus) -> &'static str {
    match status {
        TaskLaneSessionStatus::Running => "running",
        TaskLaneSessionStatus::Completed => "completed",
        TaskLaneSessionStatus::Failed => "failed",
        TaskLaneSessionStatus::TimedOut => "timed_out",
        TaskLaneSessionStatus::Transitioned => "transitioned",
    }
}

/// Ensure required artifacts exist before task column transition
pub async fn ensure_transition_artifacts(
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
        .ok_or_else(|| ServerError::NotFound(format!("Task {task_id} not found")))?;
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

/// Batch serialize tasks with evidence - optimized to avoid N+1 queries
/// Preloads all artifacts and boards in batch before serializing
pub async fn serialize_tasks_batch(
    state: &AppState,
    tasks: &[Task],
) -> Result<Vec<serde_json::Value>, ServerError> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    // Step 1: Collect all unique task_ids and board_ids
    let task_ids: Vec<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let board_ids: Vec<String> = tasks
        .iter()
        .filter_map(|t| t.board_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    // Step 2: Batch load all artifacts and boards
    let artifacts_map = state.artifact_store.list_by_tasks(&task_ids).await?;
    let boards_map = state.kanban_store.get_many(&board_ids).await?;

    // Step 3: Serialize each task with pre-loaded data
    let mut results = Vec::with_capacity(tasks.len());
    for task in tasks {
        let artifacts = artifacts_map
            .get(&task.id)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        let board = task.board_id.as_ref().and_then(|id| boards_map.get(id));

        let serialized = serialize_task_with_preloaded_data(task, artifacts, board).await?;
        results.push(serialized);
    }

    Ok(results)
}

/// Serialize a single task with pre-loaded artifacts and board (no queries)
async fn serialize_task_with_preloaded_data(
    task: &Task,
    artifacts: &[Artifact],
    board: Option<&KanbanBoard>,
) -> Result<serde_json::Value, ServerError> {
    // Build evidence summary from pre-loaded data
    let evidence_summary = build_task_evidence_summary_from_artifacts(task, artifacts, board)?;

    // Build story readiness
    let story_readiness = build_task_story_readiness(
        task,
        &resolve_next_required_task_fields(board, task.column_id.as_deref()),
    );

    // Build INVEST validation
    let invest_validation = build_task_invest_validation(task);

    // Serialize task and add computed fields
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

/// Build evidence summary from pre-loaded artifacts (no queries)
fn build_task_evidence_summary_from_artifacts(
    task: &Task,
    artifacts: &[Artifact],
    board: Option<&KanbanBoard>,
) -> Result<TaskEvidenceSummary, ServerError> {
    // Count artifacts by type
    let mut by_type = BTreeMap::new();
    for artifact in artifacts {
        let key = artifact.artifact_type.as_str().to_string();
        *by_type.entry(key).or_insert(0) += 1;
    }

    // Determine required artifacts
    let required_artifacts = resolve_next_required_artifacts(board, task.column_id.as_deref());
    let present_artifacts = by_type.keys().cloned().collect::<BTreeSet<_>>();
    let missing_required = required_artifacts
        .into_iter()
        .filter(|artifact| !present_artifacts.contains(artifact))
        .collect::<Vec<_>>();

    // Get latest status
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
