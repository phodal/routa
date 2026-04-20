//! `routa kanban` — Kanban board, card, and column commands.

use std::collections::HashSet;

use routa_core::models::kanban::KanbanColumn;
use routa_core::models::kanban_config::{KanbanBoardConfig, KanbanColumnConfig, KanbanConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use serde::Deserialize;

use super::print_json;

pub struct CreateCardOptions<'a> {
    pub workspace_id: &'a str,
    pub board_id: Option<&'a str>,
    pub column_id: Option<&'a str>,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub labels: Option<Vec<String>>,
}

pub async fn list_boards(state: &AppState, workspace_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.listBoards",
            "params": { "workspaceId": workspace_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn create_board(
    state: &AppState,
    workspace_id: &str,
    name: &str,
    columns: Option<Vec<String>>,
    is_default: bool,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "workspaceId": workspace_id,
        "name": name,
    });
    if let Some(columns) = columns {
        params["columns"] = serde_json::json!(columns);
    }
    if is_default {
        params["isDefault"] = serde_json::json!(true);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.createBoard",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn get_board(state: &AppState, board_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.getBoard",
            "params": { "boardId": board_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn update_board(
    state: &AppState,
    board_id: &str,
    name: Option<&str>,
    columns_json: Option<&str>,
    set_default: bool,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({ "boardId": board_id });
    if let Some(name) = name {
        params["name"] = serde_json::json!(name);
    }
    if let Some(columns_json) = columns_json {
        let columns: serde_json::Value = serde_json::from_str(columns_json)
            .map_err(|error| format!("Invalid --columns-json value: {error}"))?;
        params["columns"] = columns;
    }
    if set_default {
        params["isDefault"] = serde_json::json!(true);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.updateBoard",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn create_card(state: &AppState, options: CreateCardOptions<'_>) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "workspaceId": options.workspace_id,
        "title": options.title,
    });
    if let Some(board_id) = options.board_id {
        params["boardId"] = serde_json::json!(board_id);
    }
    if let Some(column_id) = options.column_id {
        params["columnId"] = serde_json::json!(column_id);
    }
    if let Some(description) = options.description {
        params["description"] = serde_json::json!(description);
    }
    if let Some(priority) = options.priority {
        params["priority"] = serde_json::json!(priority);
    }
    if let Some(labels) = options.labels {
        params["labels"] = serde_json::json!(labels);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.createCard",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn move_card(
    state: &AppState,
    card_id: &str,
    target_column_id: &str,
    position: Option<i64>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "cardId": card_id,
        "targetColumnId": target_column_id,
    });
    if let Some(position) = position {
        params["position"] = serde_json::json!(position);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.moveCard",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn update_card(
    state: &AppState,
    card_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    priority: Option<&str>,
    labels: Option<Vec<String>>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({ "cardId": card_id });
    if let Some(title) = title {
        params["title"] = serde_json::json!(title);
    }
    if let Some(description) = description {
        params["description"] = serde_json::json!(description);
    }
    if let Some(priority) = priority {
        params["priority"] = serde_json::json!(priority);
    }
    if let Some(labels) = labels {
        params["labels"] = serde_json::json!(labels);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.updateCard",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn delete_card(state: &AppState, card_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.deleteCard",
            "params": { "cardId": card_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn create_column(
    state: &AppState,
    board_id: &str,
    name: &str,
    color: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "boardId": board_id,
        "name": name,
    });
    if let Some(color) = color {
        params["color"] = serde_json::json!(color);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.createColumn",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn delete_column(
    state: &AppState,
    board_id: &str,
    column_id: &str,
    delete_cards: bool,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.deleteColumn",
            "params": {
                "boardId": board_id,
                "columnId": column_id,
                "deleteCards": delete_cards
            }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn search_cards(
    state: &AppState,
    workspace_id: &str,
    query: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "workspaceId": workspace_id,
        "query": query,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = serde_json::json!(board_id);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.searchCards",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn list_cards_by_column(
    state: &AppState,
    workspace_id: &str,
    column_id: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "workspaceId": workspace_id,
        "columnId": column_id,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = serde_json::json!(board_id);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.listCardsByColumn",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn decompose_tasks(
    state: &AppState,
    workspace_id: &str,
    board_id: Option<&str>,
    column_id: Option<&str>,
    tasks_json: &str,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let tasks: serde_json::Value = serde_json::from_str(tasks_json)
        .map_err(|error| format!("Invalid --tasks-json value: {error}"))?;
    let mut params = serde_json::json!({
        "workspaceId": workspace_id,
        "tasks": tasks,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = serde_json::json!(board_id);
    }
    if let Some(column_id) = column_id {
        params["columnId"] = serde_json::json!(column_id);
    }

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.decomposeTasks",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListBoardsResponse {
    boards: Vec<BoardSummary>,
}

#[derive(Debug, Deserialize)]
struct BoardSummary {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetBoardResponse {
    id: String,
    name: String,
    is_default: bool,
    columns: Vec<ExportColumn>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportColumn {
    id: String,
    name: String,
    color: Option<String>,
    stage: String,
    automation: Option<routa_core::models::kanban::KanbanColumnAutomation>,
    visible: Option<bool>,
    width: Option<String>,
}

fn to_rpc_error_text(response: &serde_json::Value) -> String {
    let code = response
        .get("error")
        .and_then(|e| e.get("code"))
        .and_then(|v| v.as_i64())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let message = response
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown RPC error");
    format!("RPC error ({code}): {message}")
}

async fn call_rpc(
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .await;

    if response.get("error").is_some() {
        return Err(to_rpc_error_text(&response));
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| "Missing `result` field in RPC response".to_string())
}

pub async fn validate_config(file: &str) -> Result<(), String> {
    let config = KanbanConfig::from_file(file)?;
    match config.validate() {
        Ok(()) => {
            println!(
                "Kanban config is valid: {} board(s), workspaceId={}",
                config.boards.len(),
                config.workspace_id
            );
            Ok(())
        }
        Err(errors) => Err(format!(
            "Kanban config validation failed:\n- {}",
            errors.join("\n- ")
        )),
    }
}

pub async fn apply_config(
    state: &AppState,
    file: &str,
    workspace_id_override: Option<&str>,
    dry_run: bool,
    continue_on_error: bool,
) -> Result<(), String> {
    let mut config = KanbanConfig::from_file(file)?;
    if let Some(workspace_id) = workspace_id_override {
        config.workspace_id = workspace_id.to_string();
    }

    if let Err(errors) = config.validate() {
        return Err(format!(
            "Kanban config validation failed:\n- {}",
            errors.join("\n- ")
        ));
    }

    let board_ids: HashSet<String> = {
        let result = call_rpc(
            state,
            "kanban.listBoards",
            serde_json::json!({ "workspaceId": config.workspace_id }),
        )
        .await?;
        let parsed: ListBoardsResponse =
            serde_json::from_value(result).map_err(|error| error.to_string())?;
        parsed.boards.into_iter().map(|board| board.id).collect()
    };

    let mut plan = Vec::new();
    for board in &config.boards {
        let action = if board_ids.contains(&board.id) {
            "update"
        } else {
            "create"
        };
        plan.push(serde_json::json!({
            "action": action,
            "boardId": board.id,
            "boardName": board.name,
            "workspaceId": config.workspace_id,
            "columns": board.columns.len()
        }));
    }

    if dry_run {
        print_json(&serde_json::json!({
            "dryRun": true,
            "workspaceId": config.workspace_id,
            "plan": plan
        }));
        return Ok(());
    }

    let mut applied = Vec::new();
    let mut failures = Vec::new();

    for board in &config.boards {
        let columns: Vec<KanbanColumn> = board
            .columns
            .iter()
            .enumerate()
            .map(|(idx, col)| KanbanColumn {
                id: col.id.clone(),
                name: col.name.clone(),
                color: col.color.clone(),
                position: idx as i64,
                stage: col.stage.clone(),
                automation: col.automation.clone(),
                visible: col.visible,
                width: col.width.clone(),
            })
            .collect();

        let result = if board_ids.contains(&board.id) {
            call_rpc(
                state,
                "kanban.updateBoard",
                serde_json::json!({
                "boardId": board.id,
                "name": board.name,
                "isDefault": board.is_default,
                "columns": columns,
                }),
            )
            .await
        } else {
            let create_result = call_rpc(
                state,
                "kanban.createBoard",
                serde_json::json!({
                    "workspaceId": config.workspace_id,
                    "id": board.id,
                    "name": board.name,
                    "isDefault": board.is_default,
                    "columns": board.columns.iter().map(|col| col.name.clone()).collect::<Vec<_>>(),
                }),
            )
            .await;

            match create_result {
                Ok(result) => {
                    let update_result = call_rpc(
                        state,
                        "kanban.updateBoard",
                        serde_json::json!({
                            "boardId": board.id,
                            "columns": columns,
                        }),
                    )
                    .await;

                    match update_result {
                        Ok(_) => Ok(result),
                        Err(error) => Err(format!(
                            "Created board but failed to apply column details: {error}"
                        )),
                    }
                }
                Err(error) => Err(error),
            }
        };

        match result {
            Ok(result) => {
                applied.push(serde_json::json!({
                    "boardId": board.id,
                    "result": result
                }));
            }
            Err(error) => {
                failures.push(serde_json::json!({
                    "boardId": board.id,
                    "error": error
                }));
                if !continue_on_error {
                    break;
                }
            }
        }
    }

    print_json(&serde_json::json!({
        "workspaceId": config.workspace_id,
        "applied": applied,
        "failures": failures
    }));

    if failures.is_empty() {
        Ok(())
    } else {
        Err("Some boards failed to apply".to_string())
    }
}

pub async fn export_config(
    state: &AppState,
    workspace_id: &str,
    output: Option<&str>,
) -> Result<(), String> {
    let result = call_rpc(
        state,
        "kanban.listBoards",
        serde_json::json!({ "workspaceId": workspace_id }),
    )
    .await?;
    let parsed: ListBoardsResponse =
        serde_json::from_value(result).map_err(|error| error.to_string())?;

    let mut boards = Vec::new();
    for board in parsed.boards {
        let board_result = call_rpc(
            state,
            "kanban.getBoard",
            serde_json::json!({ "boardId": board.id }),
        )
        .await?;
        let detailed: GetBoardResponse =
            serde_json::from_value(board_result).map_err(|error| error.to_string())?;
        boards.push(KanbanBoardConfig {
            id: detailed.id,
            name: detailed.name,
            is_default: detailed.is_default,
            columns: detailed
                .columns
                .into_iter()
                .map(|col| KanbanColumnConfig {
                    id: col.id,
                    name: col.name,
                    color: col.color,
                    stage: col.stage,
                    automation: col.automation,
                    visible: col.visible,
                    width: col.width,
                })
                .collect(),
        });
    }

    let config = KanbanConfig {
        version: 1,
        name: Some(format!("kanban-{workspace_id}")),
        workspace_id: workspace_id.to_string(),
        boards,
    };

    let yaml = config.to_yaml()?;
    if let Some(path) = output {
        std::fs::write(path, yaml).map_err(|error| format!("Failed to write '{path}': {error}"))?;
        println!("Exported Kanban config to {path}");
    } else {
        println!("{yaml}");
    }

    Ok(())
}
