use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::models::task::{
    Task, TaskLaneHandoff, TaskLaneHandoffRequestType, TaskLaneHandoffStatus, TaskLaneSession,
};
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::shared::emit_kanban_workspace_event;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPreviousLaneHandoffParams {
    pub task_id: String,
    pub request_type: String,
    pub request: String,
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPreviousLaneHandoffResult {
    pub handoff_id: String,
    pub status: TaskLaneHandoffStatus,
    pub target_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitLaneHandoffParams {
    pub task_id: String,
    pub handoff_id: String,
    pub status: String,
    pub summary: String,
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitLaneHandoffResult {
    pub handoff_id: String,
    pub status: TaskLaneHandoffStatus,
    pub responded_at: String,
}

pub async fn request_previous_lane_handoff(
    state: &AppState,
    params: RequestPreviousLaneHandoffParams,
) -> Result<RequestPreviousLaneHandoffResult, RpcError> {
    let request = params.request.trim();
    if request.is_empty() {
        return Err(RpcError::BadRequest("request cannot be blank".to_string()));
    }

    let request_type = parse_request_type(&params.request_type)?;
    let mut task = state
        .task_store
        .get(&params.task_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card not found: {}", params.task_id)))?;
    let board_id = task.board_id.clone().ok_or_else(|| {
        RpcError::BadRequest(format!(
            "Card {} is not associated with a board",
            params.task_id
        ))
    })?;
    let board = state
        .kanban_store
        .get(&board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board not found: {board_id}")))?;

    let previous_lane_session = get_previous_lane_session(&task, &board, task.column_id.as_deref())
        .ok_or_else(|| {
            RpcError::BadRequest(format!(
                "No previous lane session found for card {}",
                params.task_id
            ))
        })?;

    let mut handoff = TaskLaneHandoff {
        id: uuid::Uuid::new_v4().to_string(),
        from_session_id: params.session_id.clone(),
        to_session_id: previous_lane_session.session_id.clone(),
        from_column_id: current_column_id(&task, &params.session_id),
        to_column_id: previous_lane_session.column_id.clone(),
        request_type,
        request: request.to_string(),
        status: TaskLaneHandoffStatus::Requested,
        requested_at: Utc::now().to_rfc3339(),
        responded_at: None,
        response_summary: None,
    };

    upsert_lane_handoff(&mut task, handoff.clone());
    task.updated_at = Utc::now();
    state.task_store.save(&task).await?;

    let delivery_result = state
        .acp_manager
        .prompt(
            &previous_lane_session.session_id,
            &build_previous_lane_handoff_prompt(&task, &handoff),
        )
        .await;

    match delivery_result {
        Ok(_) => {
            handoff.status = TaskLaneHandoffStatus::Delivered;
            update_lane_handoff(&mut task, &handoff)?;
            task.updated_at = Utc::now();
            state.task_store.save(&task).await?;
            emit_kanban_workspace_event(
                state,
                &task.workspace_id,
                "task",
                "updated",
                Some(&task.id),
                "system",
            )
            .await;

            Ok(RequestPreviousLaneHandoffResult {
                handoff_id: handoff.id,
                status: handoff.status,
                target_session_id: previous_lane_session.session_id,
                target_column_id: previous_lane_session.column_id,
                delivery_error: None,
            })
        }
        Err(error) => {
            handoff.status = TaskLaneHandoffStatus::Failed;
            handoff.responded_at = Some(Utc::now().to_rfc3339());
            handoff.response_summary = Some(format!(
                "Unable to deliver handoff request to session {}: {}",
                previous_lane_session.session_id, error
            ));
            update_lane_handoff(&mut task, &handoff)?;
            task.updated_at = Utc::now();
            state.task_store.save(&task).await?;
            emit_kanban_workspace_event(
                state,
                &task.workspace_id,
                "task",
                "updated",
                Some(&task.id),
                "system",
            )
            .await;

            Ok(RequestPreviousLaneHandoffResult {
                handoff_id: handoff.id,
                status: handoff.status,
                target_session_id: previous_lane_session.session_id,
                target_column_id: previous_lane_session.column_id,
                delivery_error: Some(error),
            })
        }
    }
}

pub async fn submit_lane_handoff(
    state: &AppState,
    params: SubmitLaneHandoffParams,
) -> Result<SubmitLaneHandoffResult, RpcError> {
    let summary = params.summary.trim();
    if summary.is_empty() {
        return Err(RpcError::BadRequest("summary cannot be blank".to_string()));
    }

    let status = parse_submit_status(&params.status)?;
    let mut task = state
        .task_store
        .get(&params.task_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card not found: {}", params.task_id)))?;

    let handoff = task
        .lane_handoffs
        .iter_mut()
        .find(|entry| entry.id == params.handoff_id)
        .ok_or_else(|| {
            RpcError::NotFound(format!("Lane handoff not found: {}", params.handoff_id))
        })?;

    if handoff.to_session_id != params.session_id {
        return Err(RpcError::BadRequest(format!(
            "Lane handoff {} is not assigned to this session",
            params.handoff_id
        )));
    }

    handoff.status = status.clone();
    let responded_at = Utc::now().to_rfc3339();
    handoff.response_summary = Some(summary.to_string());
    handoff.responded_at = Some(responded_at.clone());
    let handoff_snapshot = handoff.clone();

    task.updated_at = Utc::now();
    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "system",
    )
    .await;

    if handoff_snapshot.from_session_id != params.session_id {
        let _ = state
            .acp_manager
            .prompt(
                &handoff_snapshot.from_session_id,
                &build_handoff_response_prompt(&task, &handoff_snapshot),
            )
            .await;
    }

    Ok(SubmitLaneHandoffResult {
        handoff_id: handoff_snapshot.id,
        status,
        responded_at,
    })
}

fn parse_request_type(value: &str) -> Result<TaskLaneHandoffRequestType, RpcError> {
    match value {
        "environment_preparation" => Ok(TaskLaneHandoffRequestType::EnvironmentPreparation),
        "runtime_context" => Ok(TaskLaneHandoffRequestType::RuntimeContext),
        "clarification" => Ok(TaskLaneHandoffRequestType::Clarification),
        "rerun_command" => Ok(TaskLaneHandoffRequestType::RerunCommand),
        _ => Err(RpcError::BadRequest(format!(
            "Invalid requestType: {value}"
        ))),
    }
}

fn parse_submit_status(value: &str) -> Result<TaskLaneHandoffStatus, RpcError> {
    match value {
        "completed" => Ok(TaskLaneHandoffStatus::Completed),
        "blocked" => Ok(TaskLaneHandoffStatus::Blocked),
        "failed" => Ok(TaskLaneHandoffStatus::Failed),
        "requested" | "delivered" => Err(RpcError::BadRequest(format!(
            "status {value} is not valid for submitLaneHandoff"
        ))),
        _ => Err(RpcError::BadRequest(format!("Invalid status: {value}"))),
    }
}

fn current_column_id(task: &Task, session_id: &str) -> Option<String> {
    task.lane_sessions
        .iter()
        .find(|entry| entry.session_id == session_id)
        .and_then(|entry| entry.column_id.clone())
        .or_else(|| task.column_id.clone())
}

fn get_previous_lane_session(
    task: &Task,
    board: &crate::models::kanban::KanbanBoard,
    current_column_id: Option<&str>,
) -> Option<TaskLaneSession> {
    let current_column_id = current_column_id?;
    let mut ordered_columns = board.columns.clone();
    ordered_columns.sort_by_key(|column| column.position);
    let current_index = ordered_columns
        .iter()
        .position(|column| column.id == current_column_id)?;
    if current_index == 0 {
        return None;
    }

    let previous_column_id = ordered_columns.get(current_index - 1)?.id.clone();
    task.lane_sessions
        .iter()
        .rev()
        .find(|entry| entry.column_id.as_deref() == Some(previous_column_id.as_str()))
        .cloned()
}

fn upsert_lane_handoff(task: &mut Task, handoff: TaskLaneHandoff) {
    if let Some(existing) = task
        .lane_handoffs
        .iter_mut()
        .find(|entry| entry.id == handoff.id)
    {
        *existing = handoff;
    } else {
        task.lane_handoffs.push(handoff);
    }
}

fn update_lane_handoff(task: &mut Task, handoff: &TaskLaneHandoff) -> Result<(), RpcError> {
    let existing = task
        .lane_handoffs
        .iter_mut()
        .find(|entry| entry.id == handoff.id)
        .ok_or_else(|| RpcError::Internal(format!("Lane handoff {} not persisted", handoff.id)))?;
    *existing = handoff.clone();
    Ok(())
}

fn build_previous_lane_handoff_prompt(task: &Task, handoff: &TaskLaneHandoff) -> String {
    let request_type = match handoff.request_type {
        TaskLaneHandoffRequestType::EnvironmentPreparation => "environment preparation",
        TaskLaneHandoffRequestType::RuntimeContext => "runtime context",
        TaskLaneHandoffRequestType::Clarification => "clarification",
        TaskLaneHandoffRequestType::RerunCommand => "rerun command",
    };

    format!(
        "A neighboring Kanban lane needs support for card \"{}\" (taskId: {}).\n\
\n\
Handoff ID: {}\n\
Request type: {}\n\
From session: {}\n\
Request:\n{}\n\
\n\
After you complete the requested support, call submit_lane_handoff with taskId \"{}\", handoffId \"{}\", your outcome status, and a concise summary.",
        task.title,
        task.id,
        handoff.id,
        request_type,
        handoff.from_session_id,
        handoff.request,
        task.id,
        handoff.id
    )
}

fn build_handoff_response_prompt(task: &Task, handoff: &TaskLaneHandoff) -> String {
    format!(
        "Lane handoff {} for card \"{}\" (taskId: {}) is now {:?}.\nSummary:\n{}",
        handoff.id,
        task.title,
        task.id,
        handoff.status,
        handoff.response_summary.as_deref().unwrap_or("")
    )
}
