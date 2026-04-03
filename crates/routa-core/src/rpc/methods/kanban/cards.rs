use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::kanban::{set_task_column, sync_task_status_from_column, task_to_card, KanbanCard};
use crate::models::task::Task;
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::automation::{
    ensure_required_artifacts_present, ensure_required_task_fields_present,
    maybe_apply_lane_automation_defaults, maybe_trigger_lane_automation,
    resolve_transition_automation_column,
};
use super::shared::{
    default_workspace_id, emit_kanban_workspace_event, ensure_column_exists,
    next_position_in_column, parse_priority, resolve_board,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCardParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct CreateCardResult {
    pub card: KanbanCard,
}

pub async fn create_card(
    state: &AppState,
    params: CreateCardParams,
) -> Result<CreateCardResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let target_column_id = params.column_id.unwrap_or_else(|| "backlog".to_string());
    ensure_column_exists(&board, &target_column_id)?;
    let target_column = board
        .columns
        .iter()
        .find(|column| column.id == target_column_id)
        .cloned();

    let title = params.title.trim();
    if title.is_empty() {
        return Err(RpcError::BadRequest(
            "card title cannot be blank".to_string(),
        ));
    }

    let position =
        next_position_in_column(state, &board.workspace_id, &board.id, &target_column_id).await?;
    let mut task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        title.to_string(),
        params.description.unwrap_or_default(),
        board.workspace_id.clone(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    task.board_id = Some(board.id.clone());
    task.column_id = Some(target_column_id.clone());
    task.position = position;
    set_task_column(&mut task, target_column_id);
    task.priority = parse_priority(params.priority.as_deref())?;
    task.labels = params.labels.unwrap_or_default();
    maybe_apply_lane_automation_defaults(&mut task, target_column.as_ref());
    task.updated_at = Utc::now();

    state.task_store.save(&task).await?;
    maybe_trigger_lane_automation(state, &mut task, target_column.as_ref()).await;
    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "task",
        "created",
        Some(&task.id),
        "system",
    )
    .await;
    Ok(CreateCardResult {
        card: task_to_card(&task),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCardParams {
    pub card_id: String,
    pub target_column_id: String,
    pub position: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct MoveCardResult {
    pub card: KanbanCard,
}

pub async fn move_card(
    state: &AppState,
    params: MoveCardParams,
) -> Result<MoveCardResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;
    let board_id = task.board_id.clone().ok_or_else(|| {
        RpcError::BadRequest(format!(
            "Card {} is not associated with a board",
            params.card_id
        ))
    })?;
    let board = state
        .kanban_store
        .get(&board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board {} not found", board_id)))?;
    ensure_column_exists(&board, &params.target_column_id)?;
    let target_column = board
        .columns
        .iter()
        .find(|column| column.id == params.target_column_id)
        .cloned()
        .ok_or_else(|| {
            RpcError::NotFound(format!("Column {} not found", params.target_column_id))
        })?;
    let previous_column_id = task.column_id.clone();
    let source_column = previous_column_id
        .as_deref()
        .and_then(|column_id| board.columns.iter().find(|column| column.id == column_id))
        .cloned();
    if previous_column_id.as_deref() != Some(params.target_column_id.as_str()) {
        ensure_required_artifacts_present(state, &task.id, &target_column).await?;
        ensure_required_task_fields_present(&task, &target_column)?;
    }

    task.column_id = Some(params.target_column_id.clone());
    task.position = match params.position {
        Some(position) if position >= 0 => position,
        Some(_) => {
            return Err(RpcError::BadRequest(
                "position must be greater than or equal to zero".to_string(),
            ))
        }
        None => {
            next_position_in_column(
                state,
                &board.workspace_id,
                &board.id,
                &params.target_column_id,
            )
            .await?
        }
    };
    sync_task_status_from_column(&mut task);
    if previous_column_id.as_deref() != Some(params.target_column_id.as_str()) {
        let transition_column =
            resolve_transition_automation_column(source_column.as_ref(), Some(&target_column));
        maybe_apply_lane_automation_defaults(&mut task, transition_column);
        task.trigger_session_id = None;
    }
    task.updated_at = Utc::now();

    let transition_column =
        resolve_transition_automation_column(source_column.as_ref(), Some(&target_column)).cloned();
    tracing::info!(
        target: "routa_kanban_move",
        task_id = %task.id,
        from_column_id = ?previous_column_id,
        to_column_id = ?task.column_id,
        trigger_session_id = ?task.trigger_session_id,
        assigned_provider = ?task.assigned_provider,
        assigned_role = ?task.assigned_role,
        status = %task.status.as_str(),
        "kanban.move_card before save"
    );
    state.task_store.save(&task).await?;
    if previous_column_id.as_deref() != Some(params.target_column_id.as_str()) {
        maybe_trigger_lane_automation(state, &mut task, transition_column.as_ref()).await;
        state.task_store.save(&task).await?;
    }
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "task",
        "moved",
        Some(&task.id),
        "system",
    )
    .await;
    Ok(MoveCardResult {
        card: task_to_card(&task),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCardParams {
    pub card_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub comment: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct UpdateCardResult {
    pub card: KanbanCard,
}

pub async fn update_card(
    state: &AppState,
    params: UpdateCardParams,
) -> Result<UpdateCardResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;
    let stage = resolve_task_stage(state, &task).await?;

    if params.description.is_some() && stage.as_deref().is_some_and(is_description_frozen_stage) {
        return Err(RpcError::BadRequest(format!(
            "Cannot update card description in {}. The story description is frozen from dev onward; update the comment field instead.",
            stage.unwrap_or_else(|| "this stage".to_string())
        )));
    }

    if let Some(title) = params.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err(RpcError::BadRequest(
                "card title cannot be blank".to_string(),
            ));
        }
        task.title = trimmed.to_string();
    }
    if let Some(description) = params.description {
        task.objective = description;
    }
    if let Some(comment) = params.comment {
        task.comment = Some(append_task_comment(task.comment.as_deref(), &comment));
    }
    if params.priority.is_some() {
        task.priority = parse_priority(params.priority.as_deref())?;
    }
    if let Some(labels) = params.labels {
        task.labels = labels;
    }
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
    Ok(UpdateCardResult {
        card: task_to_card(&task),
    })
}

async fn resolve_task_stage(state: &AppState, task: &Task) -> Result<Option<String>, RpcError> {
    let column_id = task
        .column_id
        .clone()
        .unwrap_or_else(|| "backlog".to_string());
    let Some(board_id) = task.board_id.as_deref() else {
        return Ok(Some(column_id));
    };

    let board = state.kanban_store.get(board_id).await?;
    Ok(board
        .and_then(|board| {
            board
                .columns
                .iter()
                .find(|column| column.id == column_id)
                .map(|column| column.stage.clone())
        })
        .or(Some(column_id)))
}

fn is_description_frozen_stage(stage: &str) -> bool {
    matches!(stage, "dev" | "review" | "blocked" | "done")
}

fn append_task_comment(existing: Option<&str>, next: &str) -> String {
    let trimmed_next = next.trim();
    if trimmed_next.is_empty() {
        return existing.unwrap_or_default().to_string();
    }
    let trimmed_existing = existing.unwrap_or_default().trim();
    if trimmed_existing.is_empty() {
        trimmed_next.to_string()
    } else {
        format!("{trimmed_existing}\n\n{trimmed_next}")
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCardParams {
    pub card_id: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteCardResult {
    pub deleted: bool,
    pub card_id: String,
}

pub async fn delete_card(
    state: &AppState,
    params: DeleteCardParams,
) -> Result<DeleteCardResult, RpcError> {
    let task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;
    state.task_store.delete(&params.card_id).await?;
    emit_kanban_workspace_event(
        state,
        &task.workspace_id,
        "task",
        "deleted",
        Some(&params.card_id),
        "system",
    )
    .await;
    Ok(DeleteCardResult {
        deleted: true,
        card_id: params.card_id,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeTaskItem {
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeTasksParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub tasks: Vec<DecomposeTaskItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeTasksResult {
    pub count: usize,
    pub cards: Vec<KanbanCard>,
}

pub async fn decompose_tasks(
    state: &AppState,
    params: DecomposeTasksParams,
) -> Result<DecomposeTasksResult, RpcError> {
    if params.tasks.is_empty() {
        return Err(RpcError::BadRequest(
            "tasks array cannot be empty".to_string(),
        ));
    }
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let target_column_id = params.column_id.unwrap_or_else(|| "backlog".to_string());
    ensure_column_exists(&board, &target_column_id)?;

    let mut position =
        next_position_in_column(state, &board.workspace_id, &board.id, &target_column_id).await?;
    let mut created_cards = Vec::with_capacity(params.tasks.len());

    for item in params.tasks {
        let title = item.title.trim();
        if title.is_empty() {
            return Err(RpcError::BadRequest(
                "decomposed task title cannot be blank".to_string(),
            ));
        }
        let mut task = Task::new(
            uuid::Uuid::new_v4().to_string(),
            title.to_string(),
            item.description.unwrap_or_default(),
            board.workspace_id.clone(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.board_id = Some(board.id.clone());
        task.column_id = Some(target_column_id.clone());
        task.position = position;
        set_task_column(&mut task, target_column_id.clone());
        task.priority = parse_priority(item.priority.as_deref())?;
        task.labels = item.labels.unwrap_or_default();
        task.updated_at = Utc::now();
        state.task_store.save(&task).await?;
        created_cards.push(task_to_card(&task));
        position += 1;
    }
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "task",
        "created",
        None,
        "system",
    )
    .await;

    Ok(DecomposeTasksResult {
        count: created_cards.len(),
        cards: created_cards,
    })
}
