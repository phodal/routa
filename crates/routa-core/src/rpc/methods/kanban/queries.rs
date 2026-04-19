use serde::{Deserialize, Serialize};

use crate::kanban::KanbanCard;
use crate::models::kanban::KanbanColumnAutomation;
use crate::models::task::{TaskPriority, TaskStatus};
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::shared::{
    default_workspace_id, ensure_workspace_exists, resolve_board, tasks_for_board,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCardsParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub query: String,
    pub board_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchCardsResult {
    pub cards: Vec<KanbanCard>,
}

pub async fn search_cards(
    state: &AppState,
    params: SearchCardsParams,
) -> Result<SearchCardsResult, RpcError> {
    ensure_workspace_exists(state, &params.workspace_id).await?;
    let query = params.query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return Err(RpcError::BadRequest("query cannot be blank".to_string()));
    }

    let tasks = state
        .task_store
        .list_by_workspace(&params.workspace_id)
        .await?;
    let cards = tasks
        .into_iter()
        .filter(|task| {
            if let Some(board_id) = params.board_id.as_deref() {
                if task.board_id.as_deref() != Some(board_id) {
                    return false;
                }
            }
            task.board_id.is_some()
                && (task.title.to_ascii_lowercase().contains(&query)
                    || task
                        .labels
                        .iter()
                        .any(|label| label.to_ascii_lowercase().contains(&query))
                    || task
                        .assignee
                        .as_ref()
                        .map(|assignee| assignee.to_ascii_lowercase().contains(&query))
                        .unwrap_or(false))
        })
        .map(|task| crate::kanban::task_to_card(&task))
        .collect();

    Ok(SearchCardsResult { cards })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCardsByColumnParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    pub column_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCardsByColumnResult {
    pub board_id: String,
    pub column_id: String,
    pub column_name: String,
    pub cards: Vec<KanbanCard>,
}

pub async fn list_cards_by_column(
    state: &AppState,
    params: ListCardsByColumnParams,
) -> Result<ListCardsByColumnResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let column = board
        .columns
        .iter()
        .find(|column| column.id == params.column_id)
        .ok_or_else(|| RpcError::NotFound(format!("Column {} not found", params.column_id)))?;
    let mut tasks = tasks_for_board(state, &board).await?;
    tasks.retain(|task| task.column_id.as_deref().unwrap_or("backlog") == params.column_id);
    tasks.sort_by_key(|task| task.position);

    Ok(ListCardsByColumnResult {
        board_id: board.id,
        column_id: params.column_id,
        column_name: column.name.clone(),
        cards: tasks
            .into_iter()
            .map(|task| crate::kanban::task_to_card(&task))
            .collect(),
    })
}

// ---- kanban.listCards ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCardsParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    /// Filter by column id
    pub column_id: Option<String>,
    /// Filter by task status (e.g. "PENDING", "IN_PROGRESS")
    pub status: Option<String>,
    /// Filter by priority (e.g. "low", "medium", "high", "urgent")
    pub priority: Option<String>,
    /// Filter by label (returns cards that have this label)
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCardsResult {
    pub board_id: String,
    pub total: usize,
    pub cards: Vec<KanbanCard>,
}

pub async fn list_cards(
    state: &AppState,
    params: ListCardsParams,
) -> Result<ListCardsResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;

    let status_filter = params
        .status
        .as_deref()
        .map(|s| {
            TaskStatus::from_str(s).ok_or_else(|| {
                RpcError::BadRequest(format!(
                    "Invalid status: {s}. Valid values are: PENDING, IN_PROGRESS, REVIEW_REQUIRED, COMPLETED, NEEDS_FIX, BLOCKED, CANCELLED"
                ))
            })
        })
        .transpose()?;

    let priority_filter = params
        .priority
        .as_deref()
        .map(|p| {
            TaskPriority::from_str(p).ok_or_else(|| {
                RpcError::BadRequest(format!(
                    "Invalid priority: {p}. Valid values are: low, medium, high, urgent"
                ))
            })
        })
        .transpose()?;

    let mut tasks = tasks_for_board(state, &board).await?;

    if let Some(column_id) = params.column_id.as_deref() {
        if !board.columns.iter().any(|c| c.id == column_id) {
            return Err(RpcError::NotFound(format!(
                "Column {column_id} not found"
            )));
        }
        tasks.retain(|task| task.column_id.as_deref().unwrap_or("backlog") == column_id);
    }

    if let Some(ref status) = status_filter {
        tasks.retain(|task| &task.status == status);
    }

    if let Some(ref priority) = priority_filter {
        tasks.retain(|task| task.priority.as_ref() == Some(priority));
    }

    if let Some(ref label) = params.label {
        let label_lower = label.to_ascii_lowercase();
        tasks.retain(|task| {
            task.labels
                .iter()
                .any(|l| l.to_ascii_lowercase() == label_lower)
        });
    }

    tasks.sort_by(|a, b| {
        a.column_id
            .cmp(&b.column_id)
            .then_with(|| a.position.cmp(&b.position))
    });

    let cards: Vec<KanbanCard> = tasks
        .into_iter()
        .map(|task| crate::kanban::task_to_card(&task))
        .collect();
    let total = cards.len();

    Ok(ListCardsResult {
        board_id: board.id,
        total,
        cards,
    })
}

// ---- kanban.boardStatus ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardStatusParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnStatus {
    pub id: String,
    pub name: String,
    pub stage: String,
    pub card_count: usize,
    pub automation_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardStatusResult {
    pub board_id: String,
    pub board_name: String,
    pub workspace_id: String,
    pub total_cards: usize,
    pub columns: Vec<ColumnStatus>,
}

pub async fn board_status(
    state: &AppState,
    params: BoardStatusParams,
) -> Result<BoardStatusResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let tasks = tasks_for_board(state, &board).await?;

    let columns: Vec<ColumnStatus> = board
        .columns
        .iter()
        .map(|column| {
            let card_count = tasks
                .iter()
                .filter(|task| task.column_id.as_deref().unwrap_or("backlog") == column.id)
                .count();
            let automation_enabled = column
                .automation
                .as_ref()
                .is_some_and(|a| a.enabled);
            ColumnStatus {
                id: column.id.clone(),
                name: column.name.clone(),
                stage: column.stage.clone(),
                card_count,
                automation_enabled,
                automation: column.automation.clone(),
            }
        })
        .collect();

    let total_cards = tasks.len();

    Ok(BoardStatusResult {
        board_id: board.id,
        board_name: board.name,
        workspace_id: board.workspace_id,
        total_cards,
        columns,
    })
}
