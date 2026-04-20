use chrono::Utc;
use std::collections::HashSet;

use crate::error::ServerError;
use crate::events::{AgentEvent, AgentEventType};
use crate::models::kanban::{KanbanBoard, KanbanColumn};
use crate::models::task::{Task, TaskCreationSource, TaskPriority};
use crate::rpc::error::RpcError;
use crate::state::AppState;

pub(super) fn default_workspace_id() -> String {
    "default".into()
}

pub(super) async fn emit_kanban_workspace_event(
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

pub(super) async fn ensure_workspace_exists(
    state: &AppState,
    workspace_id: &str,
) -> Result<(), ServerError> {
    if workspace_id == "default" {
        state.workspace_store.ensure_default().await?;
        return Ok(());
    }

    if state.workspace_store.get(workspace_id).await?.is_some() {
        Ok(())
    } else {
        Err(ServerError::NotFound(format!(
            "Workspace {workspace_id} not found"
        )))
    }
}

pub(super) async fn resolve_board(
    state: &AppState,
    workspace_id: &str,
    board_id: Option<&str>,
) -> Result<KanbanBoard, RpcError> {
    ensure_workspace_exists(state, workspace_id).await?;

    if let Some(board_id) = board_id {
        match state.kanban_store.get(board_id).await? {
            Some(board) if board.workspace_id == workspace_id => return Ok(board),
            Some(board) => {
                tracing::warn!(
                    board_id = %board_id,
                    board_workspace_id = %board.workspace_id,
                    requested_workspace_id = %workspace_id,
                    "kanban board workspace mismatch; falling back to workspace default board"
                );
            }
            None => {
                tracing::warn!(
                    board_id = %board_id,
                    requested_workspace_id = %workspace_id,
                    "kanban board not found; falling back to workspace default board"
                );
            }
        }
    }

    state
        .kanban_store
        .ensure_default_board(workspace_id)
        .await
        .map_err(Into::into)
}

pub(super) async fn tasks_for_board(
    state: &AppState,
    board: &KanbanBoard,
) -> Result<Vec<Task>, RpcError> {
    Ok(state
        .task_store
        .list_by_workspace(&board.workspace_id)
        .await?
        .into_iter()
        .filter(|task| {
            task.board_id.as_deref() == Some(board.id.as_str())
                && task.creation_source != Some(TaskCreationSource::Session)
        })
        .collect())
}

pub(super) async fn next_position_in_column(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
    column_id: &str,
) -> Result<i64, RpcError> {
    let count = state
        .task_store
        .list_by_workspace(workspace_id)
        .await?
        .into_iter()
        .filter(|task| {
            task.board_id.as_deref() == Some(board_id)
                && task.column_id.as_deref().unwrap_or("backlog") == column_id
        })
        .count();
    Ok(count as i64)
}

pub(super) fn ensure_column_exists(board: &KanbanBoard, column_id: &str) -> Result<(), RpcError> {
    if board.columns.iter().any(|column| column.id == column_id) {
        Ok(())
    } else {
        Err(RpcError::NotFound(format!("Column {column_id} not found")))
    }
}

pub(super) fn build_columns_from_names(names: &[String]) -> Result<Vec<KanbanColumn>, RpcError> {
    if names.is_empty() {
        return Err(RpcError::BadRequest(
            "columns cannot be an empty array".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    let mut columns = Vec::with_capacity(names.len());
    for (index, name) in names.iter().enumerate() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(RpcError::BadRequest(
                "column names cannot be blank".to_string(),
            ));
        }
        let id = slugify(trimmed);
        if !seen.insert(id.clone()) {
            return Err(RpcError::BadRequest(format!(
                "duplicate column id generated from name: {trimmed}"
            )));
        }
        columns.push(KanbanColumn {
            id,
            name: trimmed.to_string(),
            color: None,
            position: index as i64,
            stage: "backlog".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        });
    }
    Ok(columns)
}

pub(super) fn normalize_columns(columns: Vec<KanbanColumn>) -> Result<Vec<KanbanColumn>, RpcError> {
    if columns.is_empty() {
        return Err(RpcError::BadRequest(
            "columns cannot be an empty array".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(columns.len());
    for (index, mut column) in columns.into_iter().enumerate() {
        column.id = column.id.trim().to_string();
        column.name = column.name.trim().to_string();
        if column.id.is_empty() || column.name.is_empty() {
            return Err(RpcError::BadRequest(
                "column id and name cannot be blank".to_string(),
            ));
        }
        if !seen.insert(column.id.clone()) {
            return Err(RpcError::BadRequest(format!(
                "duplicate column id: {}",
                column.id
            )));
        }
        column.position = index as i64;
        normalized.push(column);
    }
    Ok(normalized)
}

pub(super) fn parse_priority(priority: Option<&str>) -> Result<Option<TaskPriority>, RpcError> {
    match priority {
        Some(priority) => TaskPriority::from_str(priority)
            .map(Some)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid priority: {priority}"))),
        None => Ok(None),
    }
}

pub(super) fn slugify(value: &str) -> String {
    value
        .split_whitespace()
        .map(|segment| segment.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::tasks_for_board;
    use crate::db::Database;
    use crate::models::kanban::default_kanban_board;
    use crate::models::task::{Task, TaskCreationSource};
    use crate::models::workspace::Workspace;
    use crate::state::{AppState, AppStateInner};
    use std::sync::Arc;

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .save(&Workspace::new(
                "default".to_string(),
                "Default".to_string(),
                None,
            ))
            .await
            .expect("workspace save should succeed");
        state
    }

    #[tokio::test]
    async fn tasks_for_board_hides_session_created_tasks() {
        let state = setup_state().await;
        let board = default_kanban_board("default".to_string());
        state
            .kanban_store
            .create(&board)
            .await
            .expect("board create should succeed");

        let mut visible_task = Task::new(
            "task-visible".to_string(),
            "Visible".to_string(),
            "Visible objective".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        visible_task.board_id = Some(board.id.clone());

        let mut session_task = Task::new(
            "task-session".to_string(),
            "Session".to_string(),
            "Session objective".to_string(),
            "default".to_string(),
            Some("session-1".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        session_task.board_id = Some(board.id.clone());
        session_task.creation_source = Some(TaskCreationSource::Session);

        state
            .task_store
            .save(&visible_task)
            .await
            .expect("visible task save should succeed");
        state
            .task_store
            .save(&session_task)
            .await
            .expect("session task save should succeed");

        let tasks = tasks_for_board(&state, &board)
            .await
            .expect("tasks for board should succeed");

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task-visible");
    }
}
