use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::kanban::{set_task_column, task_to_card, KanbanCard};
use crate::models::kanban::{default_kanban_board, KanbanBoard, KanbanColumn};
use crate::models::task::Task;
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::shared::{
    build_columns_from_names, default_workspace_id, emit_kanban_workspace_event,
    ensure_workspace_exists, next_position_in_column, normalize_columns, tasks_for_board,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumnWithCards {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub position: i64,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<crate::models::kanban::KanbanColumnAutomation>,
    pub cards: Vec<KanbanCard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBoardsParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
}

#[derive(Debug, Serialize)]
pub struct ListBoardsResult {
    pub boards: Vec<KanbanBoardSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoardSummary {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub column_count: usize,
}

pub async fn list_boards(
    state: &AppState,
    params: ListBoardsParams,
) -> Result<ListBoardsResult, RpcError> {
    ensure_workspace_exists(state, &params.workspace_id).await?;
    state
        .kanban_store
        .ensure_default_board(&params.workspace_id)
        .await?;
    let boards = state
        .kanban_store
        .list_by_workspace(&params.workspace_id)
        .await?;
    Ok(ListBoardsResult {
        boards: boards
            .into_iter()
            .map(|board| KanbanBoardSummary {
                id: board.id,
                name: board.name,
                is_default: board.is_default,
                column_count: board.columns.len(),
            })
            .collect(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBoardParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub name: String,
    pub columns: Option<Vec<String>>,
    pub is_default: Option<bool>,
    pub id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateBoardResult {
    pub board: KanbanBoard,
}

pub async fn create_board(
    state: &AppState,
    params: CreateBoardParams,
) -> Result<CreateBoardResult, RpcError> {
    ensure_workspace_exists(state, &params.workspace_id).await?;
    let name = params.name.trim();
    if name.is_empty() {
        return Err(RpcError::BadRequest(
            "board name cannot be blank".to_string(),
        ));
    }

    let want_default = params.is_default.unwrap_or(false);
    let mut board = default_kanban_board(params.workspace_id.clone());
    board.id = params
        .id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    board.name = name.to_string();
    board.is_default = false;
    if let Some(columns) = params.columns {
        board.columns = build_columns_from_names(&columns)?;
    }
    board.created_at = Utc::now();
    board.updated_at = board.created_at;

    state.kanban_store.create(&board).await?;
    if want_default {
        state
            .kanban_store
            .set_default_for_workspace(&board.workspace_id, &board.id)
            .await?;
        board.is_default = true;
    }
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "board",
        "created",
        Some(&board.id),
        "system",
    )
    .await;

    Ok(CreateBoardResult { board })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBoardParams {
    pub board_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBoardResult {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub is_default: bool,
    pub columns: Vec<KanbanColumnWithCards>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

pub async fn get_board(
    state: &AppState,
    params: GetBoardParams,
) -> Result<GetBoardResult, RpcError> {
    let board = state
        .kanban_store
        .get(&params.board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board {} not found", params.board_id)))?;
    build_board_result(state, board).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBoardParams {
    pub board_id: String,
    pub name: Option<String>,
    pub columns: Option<Vec<KanbanColumn>>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UpdateBoardResult {
    pub board: KanbanBoard,
}

pub async fn update_board(
    state: &AppState,
    params: UpdateBoardParams,
) -> Result<UpdateBoardResult, RpcError> {
    let mut board = state
        .kanban_store
        .get(&params.board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board {} not found", params.board_id)))?;

    if let Some(name) = params.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(RpcError::BadRequest(
                "board name cannot be blank".to_string(),
            ));
        }
        board.name = trimmed.to_string();
    }

    if let Some(columns) = params.columns {
        board.columns = normalize_columns(columns)?;
    }

    if let Some(is_default) = params.is_default {
        board.is_default = is_default;
    }

    board.updated_at = Utc::now();
    state.kanban_store.update(&board).await?;
    if board.is_default {
        state
            .kanban_store
            .set_default_for_workspace(&board.workspace_id, &board.id)
            .await?;
        board =
            state.kanban_store.get(&board.id).await?.ok_or_else(|| {
                RpcError::NotFound(format!("Board {} not found", params.board_id))
            })?;
    }
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "board",
        "updated",
        Some(&board.id),
        "system",
    )
    .await;

    Ok(UpdateBoardResult { board })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateColumnParams {
    pub board_id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateColumnResult {
    pub board: KanbanBoard,
}

pub async fn create_column(
    state: &AppState,
    params: CreateColumnParams,
) -> Result<CreateColumnResult, RpcError> {
    let mut board = state
        .kanban_store
        .get(&params.board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board {} not found", params.board_id)))?;
    let name = params.name.trim();
    if name.is_empty() {
        return Err(RpcError::BadRequest(
            "column name cannot be blank".to_string(),
        ));
    }

    let column_id = super::shared::slugify(name);
    if board.columns.iter().any(|column| column.id == column_id) {
        return Err(RpcError::BadRequest(format!(
            "Column already exists: {column_id}"
        )));
    }

    board.columns.push(KanbanColumn {
        id: column_id.clone(),
        name: name.to_string(),
        color: params.color,
        position: board.columns.len() as i64,
        stage: "backlog".to_string(),
        automation: None,
        visible: Some(true),
        width: None,
    });
    board.updated_at = Utc::now();
    state.kanban_store.update(&board).await?;
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "column",
        "created",
        Some(&column_id),
        "system",
    )
    .await;

    Ok(CreateColumnResult { board })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteColumnParams {
    pub board_id: String,
    pub column_id: String,
    pub delete_cards: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteColumnResult {
    pub deleted: bool,
    pub column_id: String,
    pub cards_deleted: usize,
    pub cards_moved: usize,
    pub board: KanbanBoard,
}

pub async fn delete_column(
    state: &AppState,
    params: DeleteColumnParams,
) -> Result<DeleteColumnResult, RpcError> {
    if params.column_id == "backlog" {
        return Err(RpcError::BadRequest(
            "backlog column cannot be deleted".to_string(),
        ));
    }

    let mut board = state
        .kanban_store
        .get(&params.board_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Board {} not found", params.board_id)))?;
    let column_index = board
        .columns
        .iter()
        .position(|column| column.id == params.column_id)
        .ok_or_else(|| RpcError::NotFound(format!("Column {} not found", params.column_id)))?;

    let tasks = state
        .task_store
        .list_by_workspace(&board.workspace_id)
        .await?;
    let column_tasks: Vec<Task> = tasks
        .into_iter()
        .filter(|task| {
            task.board_id.as_deref() == Some(board.id.as_str())
                && task.column_id.as_deref().unwrap_or("backlog") == params.column_id
        })
        .collect();

    let delete_cards = params.delete_cards.unwrap_or(false);
    let mut cards_deleted = 0usize;
    let mut cards_moved = 0usize;

    for mut task in column_tasks {
        if delete_cards {
            state.task_store.delete(&task.id).await?;
            cards_deleted += 1;
        } else {
            set_task_column(&mut task, "backlog");
            task.position =
                next_position_in_column(state, &board.workspace_id, &board.id, "backlog").await?;
            task.updated_at = Utc::now();
            state.task_store.save(&task).await?;
            cards_moved += 1;
        }
    }

    board.columns.remove(column_index);
    for (index, column) in board.columns.iter_mut().enumerate() {
        column.position = index as i64;
    }
    board.updated_at = Utc::now();
    state.kanban_store.update(&board).await?;
    emit_kanban_workspace_event(
        state,
        &board.workspace_id,
        "column",
        "deleted",
        Some(&params.column_id),
        "system",
    )
    .await;

    Ok(DeleteColumnResult {
        deleted: true,
        column_id: params.column_id,
        cards_deleted,
        cards_moved,
        board,
    })
}

pub(super) async fn build_board_result(
    state: &AppState,
    board: KanbanBoard,
) -> Result<GetBoardResult, RpcError> {
    let mut tasks = tasks_for_board(state, &board).await?;
    tasks.sort_by_key(|task| task.position);

    let columns = board
        .columns
        .iter()
        .map(|column| {
            let mut cards: Vec<KanbanCard> = tasks
                .iter()
                .filter(|task| task.column_id.as_deref().unwrap_or("backlog") == column.id)
                .map(task_to_card)
                .collect();
            cards.sort_by_key(|card| card.position);
            KanbanColumnWithCards {
                id: column.id.clone(),
                name: column.name.clone(),
                color: column.color.clone(),
                position: column.position,
                stage: column.stage.clone(),
                automation: column.automation.clone(),
                cards,
            }
        })
        .collect();

    Ok(GetBoardResult {
        id: board.id,
        workspace_id: board.workspace_id,
        name: board.name,
        is_default: board.is_default,
        columns,
        created_at: board.created_at,
        updated_at: board.updated_at,
    })
}
