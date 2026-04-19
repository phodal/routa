use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Filter by labels (returns cards that contain all provided labels)
    #[serde(default)]
    pub labels: Vec<String>,
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
            return Err(RpcError::NotFound(format!("Column {column_id} not found")));
        }
        tasks.retain(|task| task.column_id.as_deref().unwrap_or("backlog") == column_id);
    }

    if let Some(ref status) = status_filter {
        tasks.retain(|task| &task.status == status);
    }

    if let Some(ref priority) = priority_filter {
        tasks.retain(|task| task.priority.as_ref() == Some(priority));
    }

    let mut label_filters = params
        .labels
        .into_iter()
        .map(|label| label.trim().to_ascii_lowercase())
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    if let Some(label) = params.label {
        let label = label.trim().to_ascii_lowercase();
        if !label.is_empty() {
            label_filters.push(label);
        }
    }
    if !label_filters.is_empty() {
        tasks.retain(|task| {
            label_filters.iter().all(|label| {
                task.labels
                    .iter()
                    .any(|task_label| task_label.to_ascii_lowercase() == *label)
            })
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
    pub required_artifacts: Vec<String>,
    pub required_task_fields: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardStatusTotals {
    pub total: usize,
    pub by_status: HashMap<String, usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardStatusResult {
    pub board_id: String,
    pub board_name: String,
    pub workspace_id: String,
    pub total_cards: usize,
    pub totals: BoardStatusTotals,
    pub columns: Vec<ColumnStatus>,
}

pub async fn board_status(
    state: &AppState,
    params: BoardStatusParams,
) -> Result<BoardStatusResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let tasks = tasks_for_board(state, &board).await?;
    let mut by_status = HashMap::new();
    for task in &tasks {
        *by_status
            .entry(task.status.as_str().to_string())
            .or_insert(0) += 1;
    }

    let columns: Vec<ColumnStatus> = board
        .columns
        .iter()
        .map(|column| {
            let card_count = tasks
                .iter()
                .filter(|task| task.column_id.as_deref().unwrap_or("backlog") == column.id)
                .count();
            let automation_enabled = column.automation.as_ref().is_some_and(|a| a.enabled);
            ColumnStatus {
                id: column.id.clone(),
                name: column.name.clone(),
                stage: column.stage.clone(),
                card_count,
                automation_enabled,
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
        totals: BoardStatusTotals {
            total: total_cards,
            by_status,
        },
        columns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    use crate::db::Database;
    use crate::kanban::set_task_column;
    use crate::models::kanban::KanbanColumnAutomation;
    use crate::models::task::{Task, TaskPriority};
    use crate::state::{AppState, AppStateInner};
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
    async fn list_cards_supports_multiple_label_filters() {
        let state = setup_state().await;
        let board = state
            .kanban_store
            .ensure_default_board("default")
            .await
            .expect("default board should exist");

        let mut high_task = Task::new(
            "task-high".to_string(),
            "High priority".to_string(),
            "Objective".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        high_task.board_id = Some(board.id.clone());
        set_task_column(&mut high_task, "dev");
        high_task.priority = Some(TaskPriority::High);
        high_task.labels = vec!["feature".to_string(), "kanban".to_string()];
        state.task_store.save(&high_task).await.expect("save");

        let mut low_task = Task::new(
            "task-low".to_string(),
            "Low priority".to_string(),
            "Objective".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        low_task.board_id = Some(board.id.clone());
        set_task_column(&mut low_task, "todo");
        low_task.priority = Some(TaskPriority::Low);
        low_task.labels = vec!["feature".to_string()];
        state.task_store.save(&low_task).await.expect("save");

        let filtered = list_cards(
            &state,
            ListCardsParams {
                workspace_id: "default".to_string(),
                board_id: Some(board.id),
                column_id: None,
                status: None,
                priority: None,
                label: None,
                labels: vec!["feature".to_string(), "kanban".to_string()],
            },
        )
        .await
        .expect("list cards should succeed");

        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.cards[0].id, "task-high");
    }

    #[tokio::test]
    async fn board_status_reports_totals_and_column_requirements() {
        let state = setup_state().await;
        let mut board = state
            .kanban_store
            .ensure_default_board("default")
            .await
            .expect("default board should exist");
        let dev = board
            .columns
            .iter_mut()
            .find(|column| column.id == "dev")
            .expect("dev column should exist");
        dev.automation = Some(KanbanColumnAutomation {
            enabled: true,
            required_artifacts: Some(vec!["code_diff".to_string()]),
            required_task_fields: Some(vec![
                "acceptance_criteria".to_string(),
                "test_cases".to_string(),
            ]),
            ..Default::default()
        });
        state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let mut backlog_task = Task::new(
            "task-backlog".to_string(),
            "Backlog task".to_string(),
            "Objective".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        backlog_task.board_id = Some(board.id.clone());
        set_task_column(&mut backlog_task, "backlog");
        state.task_store.save(&backlog_task).await.expect("save");

        let mut dev_task = Task::new(
            "task-dev".to_string(),
            "Dev task".to_string(),
            "Objective".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        dev_task.board_id = Some(board.id.clone());
        set_task_column(&mut dev_task, "dev");
        dev_task.updated_at = Utc::now();
        state.task_store.save(&dev_task).await.expect("save");

        let status = board_status(
            &state,
            BoardStatusParams {
                workspace_id: "default".to_string(),
                board_id: Some(board.id),
            },
        )
        .await
        .expect("status should succeed");

        assert_eq!(status.total_cards, 2);
        assert_eq!(status.totals.total, 2);
        assert_eq!(status.totals.by_status.get("IN_PROGRESS").copied(), Some(1));

        let dev = status
            .columns
            .iter()
            .find(|column| column.id == "dev")
            .expect("dev column should exist");
        assert_eq!(dev.card_count, 1);
        assert_eq!(dev.required_artifacts, vec!["code_diff".to_string()]);
        assert_eq!(
            dev.required_task_fields,
            vec!["acceptance_criteria".to_string(), "test_cases".to_string()]
        );
    }
}
