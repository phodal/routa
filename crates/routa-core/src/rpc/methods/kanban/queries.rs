use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::kanban::KanbanCard;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCardsParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    pub status: Option<String>,
    pub column_id: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub priority: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListCardsResult {
    pub cards: Vec<KanbanCard>,
}

pub async fn list_cards(
    state: &AppState,
    params: ListCardsParams,
) -> Result<ListCardsResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let mut tasks = tasks_for_board(state, &board).await?;

    if let Some(column_id) = params.column_id.as_deref() {
        tasks.retain(|task| task.column_id.as_deref().unwrap_or("backlog") == column_id);
    }

    if let Some(status) = params.status.as_deref() {
        let status = TaskStatus::from_str(status)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {status}")))?;
        tasks.retain(|task| task.status == status);
    }

    if let Some(priority) = params.priority.as_deref() {
        let priority = TaskPriority::from_str(priority)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid priority filter: {priority}")))?;
        tasks.retain(|task| task.priority == Some(priority.clone()));
    }

    if let Some(assignee) = params.assignee.as_deref() {
        let needle = assignee.trim().to_ascii_lowercase();
        tasks.retain(|task| {
            task.assignee
                .as_deref()
                .map(|value| value.to_ascii_lowercase() == needle)
                .unwrap_or(false)
        });
    }

    if !params.labels.is_empty() {
        let filters: HashSet<String> = params
            .labels
            .iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .collect();
        tasks.retain(|task| {
            let labels: HashSet<String> = task
                .labels
                .iter()
                .map(|value| value.to_ascii_lowercase())
                .collect();
            filters.iter().all(|value| labels.contains(value))
        });
    }

    Ok(ListCardsResult {
        cards: tasks
            .into_iter()
            .map(|task| crate::kanban::task_to_card(&task))
            .collect(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStatusParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStatusColumn {
    pub id: String,
    pub name: String,
    pub stage: String,
    pub card_count: usize,
    pub automation_enabled: bool,
    pub required_artifacts: Vec<String>,
    pub required_task_fields: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStatusTotals {
    pub total: usize,
    pub by_status: HashMap<String, usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStatusResult {
    pub workspace_id: String,
    pub board_id: String,
    pub board_name: String,
    pub totals: KanbanStatusTotals,
    pub columns: Vec<KanbanStatusColumn>,
}

pub async fn kanban_status(
    state: &AppState,
    params: KanbanStatusParams,
) -> Result<KanbanStatusResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let tasks = tasks_for_board(state, &board).await?;
    let mut by_status: HashMap<String, usize> = HashMap::new();
    for task in &tasks {
        *by_status
            .entry(task.status.as_str().to_string())
            .or_insert(0) += 1;
    }

    let columns = board
        .columns
        .iter()
        .map(|column| {
            let card_count = tasks
                .iter()
                .filter(|task| task.column_id.as_deref().unwrap_or("backlog") == column.id)
                .count();
            KanbanStatusColumn {
                id: column.id.clone(),
                name: column.name.clone(),
                stage: column.stage.clone(),
                card_count,
                automation_enabled: column
                    .automation
                    .as_ref()
                    .is_some_and(|automation| automation.enabled),
                required_artifacts: column
                    .automation
                    .as_ref()
                    .and_then(|automation| automation.required_artifacts.clone())
                    .unwrap_or_default(),
                required_task_fields: column
                    .automation
                    .as_ref()
                    .and_then(|automation| automation.required_task_fields.clone())
                    .unwrap_or_default(),
            }
        })
        .collect();

    Ok(KanbanStatusResult {
        workspace_id: params.workspace_id,
        board_id: board.id.clone(),
        board_name: board.name,
        totals: KanbanStatusTotals {
            total: tasks.len(),
            by_status,
        },
        columns,
    })
}
