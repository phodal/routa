use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;

use crate::error::ServerError;
use crate::models::kanban::default_kanban_board;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/boards", get(list_boards).post(create_board))
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
    state.kanban_store.ensure_default_board(&workspace_id).await?;
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
    let mut board = default_kanban_board(body.workspace_id.clone());
    board.id = uuid::Uuid::new_v4().to_string();
    board.name = body.name;
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