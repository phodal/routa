use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::ServerError;
use crate::models::kanban::{default_kanban_board, KanbanColumn};
use crate::models::task::{Task, TaskPriority, TaskStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(create_board))
        .route("/boards/{boardId}", get(get_board).patch(update_board))
        .route("/decompose", post(decompose_tasks))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardsQuery {
    workspace_id: Option<String>,
}

async fn list_boards(
    State(state): State<AppState>,
    Query(query): Query<BoardsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.unwrap_or_else(|| "default".to_string());
    state
        .kanban_store
        .ensure_default_board(&workspace_id)
        .await?;
    let boards = state.kanban_store.list_by_workspace(&workspace_id).await?;
    Ok(Json(serde_json::json!({ "boards": boards })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBoardRequest {
    workspace_id: String,
    name: String,
    is_default: Option<bool>,
}

async fn create_board(
    State(state): State<AppState>,
    Json(body): Json<CreateBoardRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ServerError::BadRequest(
            "board name cannot be blank".to_string(),
        ));
    }

    let mut board = default_kanban_board(body.workspace_id.clone());
    board.id = uuid::Uuid::new_v4().to_string();
    board.name = name.to_string();
    board.is_default = body.is_default.unwrap_or(false);
    board.created_at = Utc::now();
    board.updated_at = board.created_at;

    state.kanban_store.create(&board).await?;
    if board.is_default {
        state
            .kanban_store
            .set_default_for_workspace(&body.workspace_id, &board.id)
            .await?;
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "board": board })),
    ))
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let board = state.kanban_store.get(&board_id).await?;
    match board {
        Some(b) => Ok(Json(serde_json::json!({ "board": b }))),
        None => Err(ServerError::NotFound(format!(
            "Board not found: {}",
            board_id
        ))),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBoardRequest {
    name: Option<String>,
    columns: Option<Vec<KanbanColumn>>,
    is_default: Option<bool>,
}

async fn update_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<UpdateBoardRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let existing = state.kanban_store.get(&board_id).await?;
    let mut board = match existing {
        Some(b) => b,
        None => {
            return Err(ServerError::NotFound(format!(
                "Board not found: {}",
                board_id
            )))
        }
    };

    // Update fields
    if let Some(name) = body.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            board.name = trimmed.to_string();
        }
    }
    if let Some(columns) = body.columns {
        board.columns = columns;
    }
    if let Some(is_default) = body.is_default {
        board.is_default = is_default;
    }
    board.updated_at = Utc::now();

    state.kanban_store.update(&board).await?;

    // If setting as default, update other boards
    if body.is_default == Some(true) {
        state
            .kanban_store
            .set_default_for_workspace(&board.workspace_id, &board.id)
            .await?;
    }

    Ok(Json(serde_json::json!({ "board": board })))
}

// Helper function to convert column_id to TaskStatus
fn column_id_to_task_status(column_id: &str) -> TaskStatus {
    match column_id {
        "backlog" => TaskStatus::Pending,
        "todo" => TaskStatus::Pending,
        "dev" => TaskStatus::InProgress,
        "review" => TaskStatus::ReviewRequired,
        "blocked" => TaskStatus::Blocked,
        "done" => TaskStatus::Completed,
        _ => TaskStatus::Pending,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecomposeTaskItem {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<String>,
    #[serde(default)]
    labels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecomposeRequest {
    board_id: String,
    workspace_id: String,
    tasks: Vec<DecomposeTaskItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CardResponse {
    id: String,
    title: String,
    description: String,
    status: String,
    column_id: String,
    position: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<String>,
    labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assignee: Option<String>,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
}

async fn decompose_tasks(
    State(state): State<AppState>,
    Json(body): Json<DecomposeRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Validate board exists
    let board = state.kanban_store.get(&body.board_id).await?;
    let board = match board {
        Some(b) => b,
        None => {
            return Err(ServerError::NotFound(format!(
                "Board not found: {}",
                body.board_id
            )))
        }
    };

    if board.workspace_id != body.workspace_id {
        return Err(ServerError::BadRequest(format!(
            "workspace mismatch: board {} belongs to workspace {}",
            body.board_id, board.workspace_id
        )));
    }

    // Validate tasks array is not empty
    if body.tasks.is_empty() {
        return Err(ServerError::BadRequest(
            "tasks array cannot be empty".to_string(),
        ));
    }

    // Determine target column
    let target_column_id = body.column_id.unwrap_or_else(|| "backlog".to_string());
    let column = board.columns.iter().find(|c| c.id == target_column_id);
    if column.is_none() {
        return Err(ServerError::NotFound(format!(
            "Column not found: {}",
            target_column_id
        )));
    }

    // Get existing tasks in the column to determine starting position
    let existing_tasks = state
        .task_store
        .list_by_workspace(&board.workspace_id)
        .await?;
    let backlog = String::from("backlog");
    let column_tasks: Vec<_> = existing_tasks
        .iter()
        .filter(|t| {
            t.board_id.as_ref() == Some(&body.board_id)
                && t.column_id.as_ref().unwrap_or(&backlog) == &target_column_id
        })
        .collect();
    let mut position = column_tasks.len() as i64;

    // Create tasks
    let mut created_cards = Vec::new();
    for item in body.tasks {
        let task_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let status = column_id_to_task_status(&target_column_id);
        let priority = item
            .priority
            .as_ref()
            .and_then(|p| TaskPriority::from_str(p));

        let task = Task {
            id: task_id.clone(),
            title: item.title.clone(),
            objective: item.description.clone().unwrap_or_default(),
            scope: None,
            acceptance_criteria: None,
            verification_commands: None,
            assigned_to: None,
            status: status.clone(),
            board_id: Some(body.board_id.clone()),
            column_id: Some(target_column_id.clone()),
            position,
            priority: priority.clone(),
            labels: item.labels.clone(),
            assignee: None,
            assigned_provider: None,
            assigned_role: None,
            assigned_specialist_id: None,
            assigned_specialist_name: None,
            trigger_session_id: None,
            github_id: None,
            github_number: None,
            github_url: None,
            github_repo: None,
            github_state: None,
            github_synced_at: None,
            last_sync_error: None,
            dependencies: Vec::new(),
            parallel_group: None,
            workspace_id: body.workspace_id.clone(),
            session_id: None,
            created_at: now,
            updated_at: now,
            completion_summary: None,
            verification_verdict: None,
            verification_report: None,
        };

        state.task_store.save(&task).await?;

        created_cards.push(CardResponse {
            id: task_id,
            title: item.title,
            description: item.description.unwrap_or_default(),
            status: status.as_str().to_string(),
            column_id: target_column_id.clone(),
            position,
            priority: priority.map(|p| p.as_str().to_string()),
            labels: item.labels,
            assignee: None,
            created_at: now,
            updated_at: now,
        });

        position += 1;
    }

    Ok(Json(serde_json::json!({
        "count": created_cards.len(),
        "cards": created_cards
    })))
}
