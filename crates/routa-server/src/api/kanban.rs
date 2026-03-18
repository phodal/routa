use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::convert::Infallible;
use tokio_stream::StreamExt;

use crate::error::ServerError;
use crate::rpc::RpcRouter;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(create_board))
        .route("/boards/{boardId}", get(get_board).patch(update_board))
        .route("/events", get(kanban_events))
        .route("/decompose", post(decompose_tasks))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardsQuery {
    workspace_id: Option<String>,
}

fn get_session_concurrency_limit(metadata: &HashMap<String, String>, board_id: &str) -> u32 {
    let key = format!("kanbanSessionConcurrencyLimit:{}", board_id);
    metadata
        .get(&key)
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|&value| value >= 1)
        .unwrap_or(1)
}

async fn list_boards(
    State(state): State<AppState>,
    Query(query): Query<BoardsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.unwrap_or_else(|| "default".to_string());
    let rpc_result = rpc_result(
        &state,
        "kanban.listBoards",
        serde_json::json!({ "workspaceId": workspace_id }),
    )
    .await?;
    let workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .ok()
        .flatten();
    let metadata = workspace
        .map(|workspace| workspace.metadata)
        .unwrap_or_default();

    let boards = rpc_result
        .get("boards")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut board| {
            add_board_runtime_meta(&mut board, &metadata);
            board
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!({ "boards": boards })))
}

async fn kanban_events(
    Query(query): Query<BoardsQuery>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let workspace_id = query.workspace_id.unwrap_or_else(|| "*".to_string());
    let connected = serde_json::json!({
        "type": "connected",
        "workspaceId": workspace_id,
    });

    let initial = tokio_stream::once(Ok(Event::default().data(connected.to_string())));
    let heartbeat = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(15),
    ))
    .map(|_| Ok(Event::default().comment("heartbeat")));

    Sse::new(initial.merge(heartbeat)).keep_alive(KeepAlive::default())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBoardRequest {
    workspace_id: String,
    name: String,
    columns: Option<Vec<String>>,
    is_default: Option<bool>,
}

async fn create_board(
    State(state): State<AppState>,
    Json(body): Json<CreateBoardRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let rpc_result = rpc_result(
        &state,
        "kanban.createBoard",
        serde_json::json!({
            "workspaceId": body.workspace_id,
            "name": body.name,
            "columns": body.columns,
            "isDefault": body.is_default,
        }),
    )
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "board": rpc_result["board"].clone() })),
    ))
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let rpc_result = rpc_result(
        &state,
        "kanban.getBoard",
        serde_json::json!({ "boardId": board_id }),
    )
    .await?;

    let workspace_id = rpc_result
        .get("workspaceId")
        .and_then(|value| value.as_str())
        .unwrap_or("default");
    let workspace = state.workspace_store.get(workspace_id).await.ok().flatten();
    let metadata = workspace
        .map(|workspace| workspace.metadata)
        .unwrap_or_default();

    let mut board = strip_board_cards(&rpc_result);
    add_board_runtime_meta(&mut board, &metadata);
    Ok(Json(serde_json::json!({ "board": board })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBoardRequest {
    name: Option<String>,
    columns: Option<serde_json::Value>,
    is_default: Option<bool>,
    session_concurrency_limit: Option<u32>,
}

async fn update_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<UpdateBoardRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let mut params = serde_json::json!({ "boardId": board_id });
    if let Some(name) = body.name {
        params["name"] = serde_json::json!(name);
    }
    if let Some(columns) = body.columns {
        params["columns"] = columns;
    }
    if let Some(is_default) = body.is_default {
        params["isDefault"] = serde_json::json!(is_default);
    }

    let rpc_result = rpc_result(&state, "kanban.updateBoard", params).await?;
    let board = rpc_result
        .get("board")
        .cloned()
        .ok_or_else(|| ServerError::Internal("Missing board in RPC response".to_string()))?;

    let board_id = board
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let workspace_id = board
        .get("workspaceId")
        .and_then(|value| value.as_str())
        .unwrap_or("default")
        .to_string();

    if let Some(limit) = body.session_concurrency_limit {
        persist_session_concurrency_limit(&state, &workspace_id, &board_id, limit).await?;
    }

    let workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .ok()
        .flatten();
    let metadata = workspace
        .map(|workspace| workspace.metadata)
        .unwrap_or_default();
    let mut board = board;
    add_board_runtime_meta(&mut board, &metadata);

    Ok(Json(serde_json::json!({ "board": board })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecomposeRequest {
    board_id: Option<String>,
    workspace_id: String,
    tasks: Vec<serde_json::Value>,
    column_id: Option<String>,
}

async fn decompose_tasks(
    State(state): State<AppState>,
    Json(body): Json<DecomposeRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let rpc_result = rpc_result(
        &state,
        "kanban.decomposeTasks",
        serde_json::json!({
            "boardId": body.board_id,
            "workspaceId": body.workspace_id,
            "tasks": body.tasks,
            "columnId": body.column_id,
        }),
    )
    .await?;
    Ok(Json(rpc_result))
}

async fn persist_session_concurrency_limit(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
    limit: u32,
) -> Result<(), ServerError> {
    let limit = limit.max(1);
    let workspace = state.workspace_store.get(workspace_id).await.ok().flatten();
    if let Some(mut workspace) = workspace {
        let key = format!("kanbanSessionConcurrencyLimit:{}", board_id);
        workspace.metadata.insert(key, limit.to_string());
        state.workspace_store.save(&workspace).await?;
    }
    Ok(())
}

async fn rpc_result(
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, ServerError> {
    let rpc = RpcRouter::new(state.clone());
    let response = rpc
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .await;

    if let Some(result) = response.get("result") {
        return Ok(result.clone());
    }

    let error = response.get("error").ok_or_else(|| {
        ServerError::Internal(format!("Missing RPC result for method {}", method))
    })?;
    let code = error
        .get("code")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let message = error
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or("RPC error")
        .to_string();

    match code {
        -32001 => Err(ServerError::NotFound(message)),
        -32002 | -32602 => Err(ServerError::BadRequest(message)),
        _ => Err(ServerError::Internal(message)),
    }
}

fn strip_board_cards(board: &serde_json::Value) -> serde_json::Value {
    let mut board = board.clone();
    if let Some(columns) = board
        .get_mut("columns")
        .and_then(|value| value.as_array_mut())
    {
        for column in columns {
            if let Some(object) = column.as_object_mut() {
                object.remove("cards");
            }
        }
    }
    board
}

fn add_board_runtime_meta(board: &mut serde_json::Value, metadata: &HashMap<String, String>) {
    let Some(object) = board.as_object_mut() else {
        return;
    };

    let board_id = object
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    object.insert(
        "sessionConcurrencyLimit".to_string(),
        serde_json::json!(get_session_concurrency_limit(metadata, board_id)),
    );
    object.insert(
        "queue".to_string(),
        serde_json::json!({ "runningCount": 0, "queuedCount": 0 }),
    );
}
