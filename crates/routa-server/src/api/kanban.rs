use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use routa_core::events::{AgentEvent, AgentEventType, EventBus};
use routa_core::models::kanban::KanbanColumn;
use routa_core::models::kanban_config::{KanbanBoardConfig, KanbanColumnConfig, KanbanConfig};
use routa_core::models::workspace::Workspace;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use tokio::sync::mpsc;

use crate::error::ServerError;
use crate::rpc::RpcRouter;
use crate::state::AppState;

fn automation_has_effective_config(
    automation: &routa_core::models::kanban::KanbanColumnAutomation,
) -> bool {
    automation.provider_id.is_some()
        || automation.role.is_some()
        || automation.specialist_id.is_some()
        || automation.specialist_name.is_some()
        || automation
            .steps
            .as_ref()
            .is_some_and(|steps| !steps.is_empty())
}

fn normalize_column_automation(column: &mut KanbanColumn) {
    if let Some(automation) = column.automation.as_mut() {
        if !automation.enabled && automation_has_effective_config(automation) {
            automation.enabled = true;
        }
    }
}

fn imported_board_id(
    workspace_id: &str,
    board_id: &str,
    conflicting_ids: &HashSet<String>,
) -> String {
    if !conflicting_ids.contains(board_id) {
        return board_id.to_string();
    }

    let workspace_prefix = workspace_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let scoped_id = format!("{}--{}", workspace_prefix, board_id);
    if !conflicting_ids.contains(&scoped_id) {
        return scoped_id;
    }

    format!("{}--{}", scoped_id, uuid::Uuid::new_v4())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(create_board))
        .route("/boards/{boardId}", get(get_board).patch(update_board))
        .route("/export", get(export_config))
        .route("/import", post(import_config))
        .route("/events", get(kanban_events))
        .route("/decompose", post(decompose_tasks))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardsQuery {
    workspace_id: Option<String>,
}

struct EventBusSubscriptionGuard {
    event_bus: EventBus,
    handler_key: String,
}

impl EventBusSubscriptionGuard {
    fn new(event_bus: EventBus, handler_key: String) -> Self {
        Self {
            event_bus,
            handler_key,
        }
    }
}

impl Drop for EventBusSubscriptionGuard {
    fn drop(&mut self) {
        let event_bus = self.event_bus.clone();
        let handler_key = self.handler_key.clone();
        tokio::spawn(async move {
            event_bus.off(&handler_key).await;
        });
    }
}

fn translate_agent_event_to_kanban_payload(event: &AgentEvent) -> Option<serde_json::Value> {
    match event.event_type {
        AgentEventType::WorkspaceUpdated => {
            if event.data.get("scope").and_then(|value| value.as_str()) != Some("kanban") {
                return None;
            }

            Some(serde_json::json!({
                "type": "kanban:changed",
                "workspaceId": event.workspace_id,
                "entity": event.data.get("entity").and_then(|value| value.as_str()).unwrap_or("task"),
                "action": event.data.get("action").and_then(|value| value.as_str()).unwrap_or("updated"),
                "resourceId": event.data.get("resourceId").and_then(|value| value.as_str()),
                "source": event.data.get("source").and_then(|value| value.as_str()).unwrap_or("system"),
                "timestamp": event.timestamp.to_rfc3339(),
            }))
        }
        AgentEventType::TaskStatusChanged
        | AgentEventType::TaskCompleted
        | AgentEventType::TaskFailed
        | AgentEventType::ReportSubmitted => Some(serde_json::json!({
            "type": "kanban:changed",
            "workspaceId": event.workspace_id,
            "entity": "task",
            "action": "updated",
            "resourceId": event.data.get("taskId").and_then(|value| value.as_str()),
            "source": if event.agent_id.is_empty() { "system" } else { "agent" },
            "timestamp": event.timestamp.to_rfc3339(),
        })),
        _ => None,
    }
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
    let list_result = rpc_result(
        &state,
        "kanban.listBoards",
        serde_json::json!({ "workspaceId": workspace_id.clone() }),
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

    let board_ids = list_result
        .get("boards")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|board| {
            board
                .get("id")
                .and_then(|value| value.as_str())
                .map(|id| id.to_string())
        })
        .collect::<Vec<_>>();

    let mut boards = Vec::with_capacity(board_ids.len());
    for board_id in board_ids {
        let rpc_board = rpc_result(
            &state,
            "kanban.getBoard",
            serde_json::json!({ "boardId": board_id }),
        )
        .await?;
        let mut board = strip_board_cards(&rpc_board);
        add_board_runtime_meta(&mut board, &metadata);
        boards.push(board);
    }

    Ok(Json(serde_json::json!({ "boards": boards })))
}

async fn kanban_events(
    State(state): State<AppState>,
    Query(query): Query<BoardsQuery>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let workspace_id = query.workspace_id.unwrap_or_else(|| "*".to_string());
    let connected = serde_json::json!({
        "type": "connected",
        "workspaceId": workspace_id,
    });
    let (tx, mut rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let workspace_filter = workspace_id.clone();
    let handler_key = format!("kanban-events-{}", uuid::Uuid::new_v4());

    state
        .event_bus
        .on(&handler_key, move |event| {
            if workspace_filter != "*" && event.workspace_id != workspace_filter {
                return;
            }
            if let Some(payload) = translate_agent_event_to_kanban_payload(&event) {
                let _ = tx.send(payload);
            }
        })
        .await;

    let event_bus = state.event_bus.clone();
    let stream = async_stream::stream! {
        let _guard = EventBusSubscriptionGuard::new(event_bus, handler_key);
        yield Ok(Event::default().data(connected.to_string()));
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tokio::select! {
                message = rx.recv() => {
                    match message {
                        Some(payload) => yield Ok(Event::default().data(payload.to_string())),
                        None => break,
                    }
                }
                _ = heartbeat.tick() => yield Ok(Event::default().comment("heartbeat")),
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportConfigRequest {
    yaml_content: String,
    workspace_id: Option<String>,
}

fn build_export_filename(workspace_id: &str) -> String {
    let safe_id = workspace_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!(
        "kanban-{}.yaml",
        if safe_id.is_empty() {
            "default"
        } else {
            &safe_id
        }
    )
}

async fn export_config(
    State(state): State<AppState>,
    Query(query): Query<BoardsQuery>,
) -> Result<(HeaderMap, String), ServerError> {
    let workspace_id = query
        .workspace_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;

    state
        .kanban_store
        .ensure_default_board(&workspace_id)
        .await?;

    let workspace = state.workspace_store.get(&workspace_id).await?;
    let boards = state.kanban_store.list_by_workspace(&workspace_id).await?;
    let config = KanbanConfig {
        version: 1,
        name: workspace.and_then(|workspace| {
            let title = workspace.title.trim();
            if title.is_empty() {
                None
            } else {
                Some(format!("{title} Kanban"))
            }
        }),
        workspace_id: workspace_id.clone(),
        boards: boards
            .into_iter()
            .map(|board| {
                let mut columns = board.columns;
                columns.sort_by_key(|column| column.position);
                KanbanBoardConfig {
                    id: board.id,
                    name: board.name,
                    is_default: board.is_default,
                    columns: columns
                        .into_iter()
                        .map(|mut column| {
                            normalize_column_automation(&mut column);
                            KanbanColumnConfig {
                                id: column.id,
                                name: column.name,
                                color: column.color,
                                stage: column.stage,
                                automation: column.automation,
                                visible: column.visible,
                                width: column.width,
                            }
                        })
                        .collect(),
                }
            })
            .collect(),
    };

    let yaml_content = config.to_yaml().map_err(ServerError::Internal)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        "content-type",
        "application/yaml; charset=utf-8".parse().unwrap(),
    );
    headers.insert("cache-control", "no-store".parse().unwrap());
    headers.insert(
        "content-disposition",
        format!(
            "attachment; filename=\"{}\"",
            build_export_filename(&workspace_id)
        )
        .parse()
        .unwrap(),
    );

    Ok((headers, yaml_content))
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

async fn import_config(
    State(state): State<AppState>,
    Json(body): Json<ImportConfigRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    if body.yaml_content.trim().is_empty() {
        return Err(ServerError::BadRequest(
            "yamlContent is required".to_string(),
        ));
    }

    let mut config =
        KanbanConfig::from_yaml(&body.yaml_content).map_err(ServerError::BadRequest)?;
    if let Some(workspace_id) = body.workspace_id.filter(|value| !value.trim().is_empty()) {
        config.workspace_id = workspace_id;
    }
    if let Err(errors) = config.validate() {
        return Err(ServerError::BadRequest(format!(
            "Kanban config validation failed:\n- {}",
            errors.join("\n- ")
        )));
    }

    if state
        .workspace_store
        .get(&config.workspace_id)
        .await?
        .is_none()
    {
        let workspace = Workspace::new(
            config.workspace_id.clone(),
            config
                .name
                .clone()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| config.workspace_id.clone()),
            None,
        );
        state.workspace_store.save(&workspace).await?;
    }

    let board_ids = existing_board_ids(&state, &config.workspace_id).await?;
    let mut global_board_ids = state
        .kanban_store
        .list_all()
        .await?
        .into_iter()
        .map(|board| board.id)
        .collect::<HashSet<_>>();
    let mut applied = Vec::new();

    for board in &config.boards {
        let board_id = if board_ids.contains(&board.id) {
            board.id.clone()
        } else {
            imported_board_id(&config.workspace_id, &board.id, &global_board_ids)
        };
        global_board_ids.insert(board_id.clone());

        let columns: Vec<KanbanColumn> = board
            .columns
            .iter()
            .enumerate()
            .map(|(idx, col)| {
                let mut column = KanbanColumn {
                    id: col.id.clone(),
                    name: col.name.clone(),
                    color: col.color.clone(),
                    position: idx as i64,
                    stage: col.stage.clone(),
                    automation: col.automation.clone(),
                    visible: col.visible,
                    width: col.width.clone(),
                };
                normalize_column_automation(&mut column);
                column
            })
            .collect();

        let action = if board_ids.contains(&board_id) {
            rpc_result(
                &state,
                "kanban.updateBoard",
                serde_json::json!({
                    "boardId": board_id,
                    "name": board.name,
                    "isDefault": board.is_default,
                    "columns": columns,
                }),
            )
            .await?;
            "updated"
        } else {
            rpc_result(
                &state,
                "kanban.createBoard",
                serde_json::json!({
                    "workspaceId": config.workspace_id,
                    "id": board_id,
                    "name": board.name,
                    "isDefault": board.is_default,
                    "columns": board.columns.iter().map(|col| col.name.clone()).collect::<Vec<_>>(),
                }),
            )
            .await?;
            rpc_result(
                &state,
                "kanban.updateBoard",
                serde_json::json!({
                    "boardId": board_id,
                    "columns": columns,
                }),
            )
            .await?;
            "created"
        };

        applied.push(serde_json::json!({
            "boardId": board_id,
            "requestedBoardId": board.id,
            "boardName": board.name,
            "action": action,
            "columns": board.columns.len(),
        }));
    }

    Ok(Json(serde_json::json!({
        "workspaceId": config.workspace_id,
        "importedBoards": applied.len(),
        "applied": applied,
    })))
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

async fn existing_board_ids(
    state: &AppState,
    workspace_id: &str,
) -> Result<HashSet<String>, ServerError> {
    Ok(state
        .kanban_store
        .list_by_workspace(workspace_id)
        .await?
        .into_iter()
        .map(|board| board.id)
        .collect())
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

#[cfg(test)]
mod tests {
    use super::translate_agent_event_to_kanban_payload;
    use chrono::Utc;
    use routa_core::events::{AgentEvent, AgentEventType};
    use serde_json::json;

    #[test]
    fn translates_workspace_updated_kanban_event() {
        let event = AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: "user-1".to_string(),
            workspace_id: "ws-1".to_string(),
            data: json!({
                "scope": "kanban",
                "entity": "task",
                "action": "moved",
                "resourceId": "task-1",
                "source": "user",
            }),
            timestamp: Utc::now(),
        };

        let payload =
            translate_agent_event_to_kanban_payload(&event).expect("payload should exist");
        assert_eq!(payload["type"].as_str(), Some("kanban:changed"));
        assert_eq!(payload["workspaceId"].as_str(), Some("ws-1"));
        assert_eq!(payload["entity"].as_str(), Some("task"));
        assert_eq!(payload["action"].as_str(), Some("moved"));
        assert_eq!(payload["resourceId"].as_str(), Some("task-1"));
        assert_eq!(payload["source"].as_str(), Some("user"));
    }

    #[test]
    fn ignores_non_kanban_workspace_updates() {
        let event = AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: "user-1".to_string(),
            workspace_id: "ws-1".to_string(),
            data: json!({
                "scope": "notes",
                "entity": "note",
                "action": "updated",
            }),
            timestamp: Utc::now(),
        };

        assert!(translate_agent_event_to_kanban_payload(&event).is_none());
    }

    #[test]
    fn translates_task_status_change_to_kanban_update() {
        let event = AgentEvent {
            event_type: AgentEventType::TaskStatusChanged,
            agent_id: "agent-1".to_string(),
            workspace_id: "ws-1".to_string(),
            data: json!({
                "taskId": "task-42",
                "status": "COMPLETED",
            }),
            timestamp: Utc::now(),
        };

        let payload =
            translate_agent_event_to_kanban_payload(&event).expect("payload should exist");
        assert_eq!(payload["type"].as_str(), Some("kanban:changed"));
        assert_eq!(payload["entity"].as_str(), Some("task"));
        assert_eq!(payload["action"].as_str(), Some("updated"));
        assert_eq!(payload["resourceId"].as_str(), Some("task-42"));
        assert_eq!(payload["source"].as_str(), Some("agent"));
    }
}
