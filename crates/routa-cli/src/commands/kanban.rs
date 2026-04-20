//! `routa kanban` — Kanban board, card, and column commands.

use std::{
    collections::{BTreeMap, HashSet},
    env,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use reqwest::Client;
use routa_core::models::kanban::KanbanColumn;
use routa_core::models::kanban_config::{KanbanBoardConfig, KanbanColumnConfig, KanbanConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{format_rfc3339_timestamp, print_json, truncate_text};

pub const DEFAULT_KANBAN_SERVER_URL: &str = "http://127.0.0.1:3210";

const KANBAN_SERVER_URL_ENV: &str = "ROUTA_SERVER_URL";
const KANBAN_JSON_ENV: &str = "ROUTA_KANBAN_JSON";

static KANBAN_SERVER_FALLBACK_WARNED: AtomicBool = AtomicBool::new(false);

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
    let result = call_rpc(
        state,
        "kanban.listBoards",
        json!({ "workspaceId": workspace_id }),
    )
    .await?;
    render_result(&result, |value| format_board_list_text(value, workspace_id));
    Ok(())
}

pub async fn create_board(
    state: &AppState,
    workspace_id: &str,
    name: &str,
    columns: Option<Vec<String>>,
    is_default: bool,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
        "name": name,
    });
    if let Some(columns) = columns {
        params["columns"] = json!(columns);
    }
    if is_default {
        params["isDefault"] = json!(true);
    }

    let result = call_rpc(state, "kanban.createBoard", params).await?;
    render_result(&result, |value| {
        value
            .get("board")
            .and_then(|board| format_board_text(board, "Created board"))
    });
    Ok(())
}

pub async fn get_board(state: &AppState, board_id: &str) -> Result<(), String> {
    let result = call_rpc(state, "kanban.getBoard", json!({ "boardId": board_id })).await?;
    render_result(&result, |value| format_board_text(value, "Board"));
    Ok(())
}

pub async fn update_board(
    state: &AppState,
    board_id: &str,
    name: Option<&str>,
    columns_json: Option<&str>,
    set_default: bool,
) -> Result<(), String> {
    let mut params = json!({ "boardId": board_id });
    if let Some(name) = name {
        params["name"] = json!(name);
    }
    if let Some(columns_json) = columns_json {
        let columns: Value = serde_json::from_str(columns_json)
            .map_err(|error| format!("Invalid --columns-json value: {error}"))?;
        params["columns"] = columns;
    }
    if set_default {
        params["isDefault"] = json!(true);
    }

    let result = call_rpc(state, "kanban.updateBoard", params).await?;
    render_result(&result, |value| {
        value
            .get("board")
            .and_then(|board| format_board_text(board, "Updated board"))
    });
    Ok(())
}

pub async fn create_card(state: &AppState, options: CreateCardOptions<'_>) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": options.workspace_id,
        "title": options.title,
    });
    if let Some(board_id) = options.board_id {
        params["boardId"] = json!(board_id);
    }
    if let Some(column_id) = options.column_id {
        params["columnId"] = json!(column_id);
    }
    if let Some(description) = options.description {
        params["description"] = json!(description);
    }
    if let Some(priority) = options.priority {
        params["priority"] = json!(priority);
    }
    if let Some(labels) = options.labels.as_ref() {
        params["labels"] = json!(labels);
    }

    let result = call_rpc(state, "kanban.createCard", params).await?;
    render_result(&result, |value| {
        value
            .get("card")
            .and_then(|card| format_card_text(card, "Created card"))
    });
    Ok(())
}

pub async fn move_card(
    state: &AppState,
    card_id: &str,
    target_column_id: &str,
    position: Option<i64>,
) -> Result<(), String> {
    let mut params = json!({
        "cardId": card_id,
        "targetColumnId": target_column_id,
    });
    if let Some(position) = position {
        params["position"] = json!(position);
    }

    let result = call_rpc(state, "kanban.moveCard", params).await?;
    render_result(&result, |value| {
        value
            .get("card")
            .and_then(|card| format_card_text(card, "Moved card"))
    });
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
    let mut params = json!({ "cardId": card_id });
    if let Some(title) = title {
        params["title"] = json!(title);
    }
    if let Some(description) = description {
        params["description"] = json!(description);
    }
    if let Some(priority) = priority {
        params["priority"] = json!(priority);
    }
    if let Some(labels) = labels {
        params["labels"] = json!(labels);
    }

    let result = call_rpc(state, "kanban.updateCard", params).await?;
    render_result(&result, |value| {
        value
            .get("card")
            .and_then(|card| format_card_text(card, "Updated card"))
    });
    Ok(())
}

pub async fn get_card(state: &AppState, card_id: &str) -> Result<(), String> {
    let result = call_rpc(state, "tasks.get", json!({ "id": card_id })).await?;
    render_result(&result, format_card_detail_text);
    Ok(())
}

pub async fn delete_card(state: &AppState, card_id: &str) -> Result<(), String> {
    let result = call_rpc(state, "kanban.deleteCard", json!({ "cardId": card_id })).await?;
    render_result(&result, format_delete_card_text);
    Ok(())
}

pub async fn create_issue_from_card(
    state: &AppState,
    card_id: &str,
    repo: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({ "cardId": card_id });
    if let Some(repo) = repo {
        params["repo"] = json!(repo);
    }

    let result = call_rpc(state, "kanban.createIssueFromCard", params).await?;
    render_result(&result, format_issue_created_text);
    Ok(())
}

pub async fn create_column(
    state: &AppState,
    board_id: &str,
    name: &str,
    color: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({
        "boardId": board_id,
        "name": name,
    });
    if let Some(color) = color {
        params["color"] = json!(color);
    }

    let result = call_rpc(state, "kanban.createColumn", params).await?;
    render_result(&result, |value| {
        value
            .get("board")
            .and_then(|board| format_board_text(board, "Updated board"))
    });
    Ok(())
}

pub async fn delete_column(
    state: &AppState,
    board_id: &str,
    column_id: &str,
    delete_cards: bool,
) -> Result<(), String> {
    let result = call_rpc(
        state,
        "kanban.deleteColumn",
        json!({
            "boardId": board_id,
            "columnId": column_id,
            "deleteCards": delete_cards
        }),
    )
    .await?;
    render_result(&result, format_delete_column_text);
    Ok(())
}

pub async fn search_cards(
    state: &AppState,
    workspace_id: &str,
    query: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
        "query": query,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = json!(board_id);
    }

    let result = call_rpc(state, "kanban.searchCards", params).await?;
    render_result(&result, |value| {
        format_cards_text(
            value,
            &format!("Search results for \"{query}\" in workspace {workspace_id}"),
            value_str(value, "boardId"),
        )
    });
    Ok(())
}

pub async fn list_cards_by_column(
    state: &AppState,
    workspace_id: &str,
    column_id: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
        "columnId": column_id,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = json!(board_id);
    }

    let result = call_rpc(state, "kanban.listCardsByColumn", params).await?;
    render_result(&result, |value| {
        let column_name = value_str(value, "columnName").unwrap_or(column_id);
        format_cards_text(
            value,
            &format!("Cards in column {column_name} ({column_id})"),
            value_str(value, "boardId"),
        )
    });
    Ok(())
}

pub struct ListCardsOptions<'a> {
    pub workspace_id: &'a str,
    pub board_id: Option<&'a str>,
    pub column_id: Option<&'a str>,
    pub status: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub labels: Option<Vec<&'a str>>,
}

pub async fn list_cards(state: &AppState, options: ListCardsOptions<'_>) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": options.workspace_id,
    });
    if let Some(board_id) = options.board_id {
        params["boardId"] = json!(board_id);
    }
    if let Some(column_id) = options.column_id {
        params["columnId"] = json!(column_id);
    }
    if let Some(status) = options.status {
        params["status"] = json!(status);
    }
    if let Some(priority) = options.priority {
        params["priority"] = json!(priority);
    }
    if let Some(labels) = options.labels.as_ref() {
        params["labels"] = json!(labels);
    }

    let result = call_rpc(state, "kanban.listCards", params).await?;
    render_result(&result, |value| {
        let mut filters = Vec::new();
        if let Some(column_id) = options.column_id {
            filters.push(format!("column={column_id}"));
        }
        if let Some(status) = options.status {
            filters.push(format!("status={status}"));
        }
        if let Some(priority) = options.priority {
            filters.push(format!("priority={priority}"));
        }
        if let Some(labels) = options.labels.as_ref() {
            if !labels.is_empty() {
                filters.push(format!("labels={}", labels.join(",")));
            }
        }
        let mut header = format!("Cards in workspace {}", options.workspace_id);
        if !filters.is_empty() {
            header.push_str(&format!(" [{}]", filters.join(" ")));
        }
        format_cards_text(value, &header, value_str(value, "boardId"))
    });
    Ok(())
}

pub async fn board_status(
    state: &AppState,
    workspace_id: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = json!(board_id);
    }

    let result = call_rpc(state, "kanban.boardStatus", params).await?;
    render_result(&result, format_board_status_text);
    Ok(())
}

pub async fn list_automations(
    state: &AppState,
    workspace_id: &str,
    board_id: Option<&str>,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = json!(board_id);
    }

    let result = call_rpc(state, "kanban.listAutomations", params).await?;
    render_result(&result, format_automation_list_text);
    Ok(())
}

pub async fn trigger_automation(
    state: &AppState,
    card_id: &str,
    column_id: Option<&str>,
    force: bool,
    dry_run: bool,
) -> Result<(), String> {
    let mut params = json!({
        "cardId": card_id,
        "force": force,
        "dryRun": dry_run,
    });
    if let Some(column_id) = column_id {
        params["columnId"] = json!(column_id);
    }

    let result = call_rpc(state, "kanban.triggerAutomation", params).await?;
    render_result(&result, format_trigger_automation_text);
    Ok(())
}

pub struct SyncGithubIssuesOptions<'a> {
    pub board_id: Option<&'a str>,
    pub column_id: Option<&'a str>,
    pub repo: Option<&'a str>,
    pub codebase_id: Option<&'a str>,
    pub state_filter: Option<&'a str>,
    pub dry_run: bool,
}

pub async fn sync_github_issues(
    state: &AppState,
    workspace_id: &str,
    options: SyncGithubIssuesOptions<'_>,
) -> Result<(), String> {
    let mut params = json!({
        "workspaceId": workspace_id,
        "dryRun": options.dry_run,
    });
    if let Some(board_id) = options.board_id {
        params["boardId"] = json!(board_id);
    }
    if let Some(column_id) = options.column_id {
        params["columnId"] = json!(column_id);
    }
    if let Some(repo) = options.repo {
        params["repo"] = json!(repo);
    }
    if let Some(codebase_id) = options.codebase_id {
        params["codebaseId"] = json!(codebase_id);
    }
    if let Some(state_filter) = options.state_filter {
        params["state"] = json!(state_filter);
    }

    let result = call_rpc(state, "kanban.syncGitHubIssues", params).await?;
    render_result(&result, format_sync_summary_text);
    Ok(())
}

pub async fn decompose_tasks(
    state: &AppState,
    workspace_id: &str,
    board_id: Option<&str>,
    column_id: Option<&str>,
    tasks_json: &str,
) -> Result<(), String> {
    let tasks: Value = serde_json::from_str(tasks_json)
        .map_err(|error| format!("Invalid --tasks-json value: {error}"))?;
    let mut params = json!({
        "workspaceId": workspace_id,
        "tasks": tasks,
    });
    if let Some(board_id) = board_id {
        params["boardId"] = json!(board_id);
    }
    if let Some(column_id) = column_id {
        params["columnId"] = json!(column_id);
    }

    let result = call_rpc(state, "kanban.decomposeTasks", params).await?;
    render_result(&result, |_| None);
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

fn render_result<F>(result: &Value, formatter: F)
where
    F: FnOnce(&Value) -> Option<String>,
{
    if json_output_enabled() {
        print_json(result);
        return;
    }

    if let Some(text) = formatter(result) {
        println!("{text}");
    } else {
        print_json(result);
    }
}

fn json_output_enabled() -> bool {
    env::var(KANBAN_JSON_ENV)
        .ok()
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn kanban_server_endpoint() -> String {
    let base = env::var(KANBAN_SERVER_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_KANBAN_SERVER_URL.to_string());
    let trimmed = base.trim_end_matches('/');
    if trimmed.ends_with("/api/rpc") {
        trimmed.to_string()
    } else if trimmed.ends_with("/api") {
        format!("{trimmed}/rpc")
    } else {
        format!("{trimmed}/api/rpc")
    }
}

fn local_db_path() -> String {
    env::var("ROUTA_DB_PATH").unwrap_or_else(|_| "routa.db".to_string())
}

fn should_attempt_remote() -> bool {
    env::var("ROUTA_DB_PATH")
        .ok()
        .map(|value| {
            let trimmed = value.trim();
            !trimmed.is_empty() && trimmed != ":memory:" && trimmed != "file::memory:"
        })
        .unwrap_or(false)
}

fn warn_remote_fallback_once(endpoint: &str, error: &str) {
    if !KANBAN_SERVER_FALLBACK_WARNED.swap(true, Ordering::SeqCst) {
        eprintln!(
            "Warning: Kanban RPC server {endpoint} is unavailable ({error}). Falling back to local database {}.",
            local_db_path()
        );
    }
}

fn to_rpc_error_text(response: &Value) -> String {
    let code = response
        .get("error")
        .and_then(|e| e.get("code"))
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let message = response
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown RPC error");
    format!("RPC error ({code}): {message}")
}

fn extract_rpc_result(response: &Value) -> Result<Value, String> {
    if response.get("error").is_some() {
        return Err(to_rpc_error_text(response));
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| "Missing `result` field in RPC response".to_string())
}

async fn call_remote_rpc(request: &Value) -> Result<Option<Value>, String> {
    if !should_attempt_remote() {
        return Ok(None);
    }

    let endpoint = kanban_server_endpoint();
    let client = Client::builder()
        .connect_timeout(Duration::from_millis(800))
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("Failed to build Kanban HTTP client: {error}"))?;

    let response = match client.post(&endpoint).json(request).send().await {
        Ok(response) => response,
        Err(error) => {
            warn_remote_fallback_once(&endpoint, &error.to_string());
            return Ok(None);
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.lines().next().unwrap_or_default().trim();
        if detail.is_empty() {
            return Err(format!(
                "Kanban RPC server {endpoint} returned HTTP {status}"
            ));
        }
        return Err(format!(
            "Kanban RPC server {endpoint} returned HTTP {status}: {}",
            truncate_text(detail, 120)
        ));
    }

    let decoded = response.json::<Value>().await.map_err(|error| {
        format!("Failed to decode Kanban RPC response from {endpoint}: {error}")
    })?;

    Ok(Some(decoded))
}

async fn call_rpc(state: &AppState, method: &str, params: Value) -> Result<Value, String> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    });

    if let Some(response) = call_remote_rpc(&request).await? {
        return extract_rpc_result(&response);
    }

    let router = RpcRouter::new(state.clone());
    let response = router.handle_value(request).await;
    extract_rpc_result(&response)
}

fn value_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn value_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn value_array<'a>(value: &'a Value, key: &str) -> Option<&'a [Value]> {
    value.get(key).and_then(Value::as_array).map(Vec::as_slice)
}

fn format_board_list_text(result: &Value, workspace_id: &str) -> Option<String> {
    let boards = value_array(result, "boards")?;
    let mut lines = vec![format!(
        "Boards ({}) in workspace {}:",
        boards.len(),
        workspace_id
    )];

    if boards.is_empty() {
        lines.push("  (no boards)".to_string());
        return Some(lines.join("\n"));
    }

    for board in boards {
        let marker = if value_bool(board, "isDefault").unwrap_or(false) {
            "*"
        } else {
            " "
        };
        let name = value_str(board, "name").unwrap_or("unnamed");
        let id = value_str(board, "id").unwrap_or("?");
        let column_count = value_u64(board, "columnCount").unwrap_or(0);
        lines.push(format!(
            "  {} {}  columns={}  id={}",
            marker,
            truncate_text(name, 48),
            column_count,
            id
        ));
    }

    Some(lines.join("\n"))
}

fn format_board_text(board: &Value, heading: &str) -> Option<String> {
    let id = value_str(board, "id")?;
    let name = value_str(board, "name").unwrap_or("unnamed");
    let workspace_id = value_str(board, "workspaceId").unwrap_or("default");
    let is_default = value_bool(board, "isDefault").unwrap_or(false);
    let columns = value_array(board, "columns").unwrap_or(&[]);

    let mut lines = vec![format!(
        "{}: {} [{}] workspace={}{}",
        heading,
        name,
        id,
        workspace_id,
        if is_default { " default=true" } else { "" }
    )];

    if columns.is_empty() {
        lines.push("  columns: (none)".to_string());
        return Some(lines.join("\n"));
    }

    lines.push(format!("  columns ({}):", columns.len()));
    for column in columns {
        let column_id = value_str(column, "id").unwrap_or("?");
        let column_name = value_str(column, "name").unwrap_or("unnamed");
        let stage = value_str(column, "stage").unwrap_or(column_id);
        let card_count = value_array(column, "cards").map_or(0, |cards| cards.len());
        lines.push(format!(
            "    {column_id}  {column_name}  stage={stage} cards={card_count}"
        ));
    }

    Some(lines.join("\n"))
}

fn format_card_text(card: &Value, heading: &str) -> Option<String> {
    let id = value_str(card, "id")?;
    let title = value_str(card, "title").unwrap_or("untitled");
    let column_id = value_str(card, "columnId").unwrap_or("backlog");
    let status = value_str(card, "status").unwrap_or("unknown");
    let priority = value_str(card, "priority").unwrap_or("-");
    let updated_at = format_rfc3339_timestamp(card.get("updatedAt").and_then(Value::as_str));
    let labels = format_labels(card.get("labels"));

    let mut lines = vec![format!("{}: {} [{}]", heading, title, id)];
    lines.push(format!(
        "  column={column_id} status={status} priority={priority} updated={updated_at}"
    ));
    if !labels.is_empty() {
        lines.push(format!("  labels={labels}"));
    }
    if let Some(assignee) = value_str(card, "assignee") {
        if !assignee.is_empty() {
            lines.push(format!("  assignee={assignee}"));
        }
    }

    Some(lines.join("\n"))
}

fn format_card_detail_text(card: &Value) -> Option<String> {
    let id = value_str(card, "id")?;
    let title = value_str(card, "title").unwrap_or("untitled");
    let workspace_id = value_str(card, "workspaceId").unwrap_or("default");
    let board_id = value_str(card, "boardId").unwrap_or("-");
    let column_id = value_str(card, "columnId").unwrap_or("backlog");
    let position = card.get("position").and_then(Value::as_i64).unwrap_or(0);
    let status = value_str(card, "status").unwrap_or("unknown");
    let priority = value_str(card, "priority").unwrap_or("-");
    let created_at = format_rfc3339_timestamp(card.get("createdAt").and_then(Value::as_str));
    let updated_at = format_rfc3339_timestamp(card.get("updatedAt").and_then(Value::as_str));
    let labels = format_labels(card.get("labels"));

    let mut lines = vec![format!("Card: {title} [{id}]")];
    lines.push(format!(
        "  workspace={workspace_id} board={board_id} column={column_id} position={position}"
    ));
    lines.push(format!(
        "  status={status} priority={priority} created={created_at} updated={updated_at}"
    ));

    if !labels.is_empty() {
        lines.push(format!("  labels={labels}"));
    }

    let mut assignment = Vec::new();
    if let Some(assignee) = value_str(card, "assignee").filter(|value| !value.is_empty()) {
        assignment.push(format!("assignee={assignee}"));
    }
    if let Some(provider) = value_str(card, "assignedProvider").filter(|value| !value.is_empty()) {
        assignment.push(format!("provider={provider}"));
    }
    if let Some(role) = value_str(card, "assignedRole").filter(|value| !value.is_empty()) {
        assignment.push(format!("role={role}"));
    }
    if let Some(specialist) =
        value_str(card, "assignedSpecialistName").filter(|value| !value.is_empty())
    {
        assignment.push(format!("specialist={specialist}"));
    }
    if !assignment.is_empty() {
        lines.push(format!("  {}", assignment.join(" ")));
    }

    if let Some(trigger_session_id) =
        value_str(card, "triggerSessionId").filter(|value| !value.is_empty())
    {
        lines.push(format!("  activeSession={trigger_session_id}"));
    }

    if let Some(repo) = value_str(card, "githubRepo").filter(|value| !value.is_empty()) {
        let number = card
            .get("githubNumber")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let state = value_str(card, "githubState").unwrap_or("unknown");
        let url = value_str(card, "githubUrl").unwrap_or("-");
        lines.push(format!("  github={repo}#{number} state={state} url={url}"));
    }

    if let Some(sync_error) = value_str(card, "lastSyncError").filter(|value| !value.is_empty()) {
        lines.push(format!("  lastSyncError={sync_error}"));
    }

    push_text_block(&mut lines, "Objective", value_str(card, "objective"));
    push_text_block(&mut lines, "Comment", value_str(card, "comment"));
    push_text_block(&mut lines, "Scope", value_str(card, "scope"));
    push_string_list_block(
        &mut lines,
        "Acceptance criteria",
        card.get("acceptanceCriteria"),
    );
    push_string_list_block(
        &mut lines,
        "Verification commands",
        card.get("verificationCommands"),
    );
    push_string_list_block(&mut lines, "Test cases", card.get("testCases"));
    push_string_list_block(&mut lines, "Dependencies", card.get("dependencies"));
    push_string_list_block(&mut lines, "Codebases", card.get("codebaseIds"));

    if let Some(story_readiness) = card.get("storyReadiness") {
        let ready = story_readiness
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let missing = format_string_array(story_readiness.get("missing"));
        let required_fields = format_string_array(story_readiness.get("requiredTaskFields"));
        let mut row = format!("Story readiness: ready={}", yes_no(ready));
        if !missing.is_empty() {
            row.push_str(&format!(" missing={missing}"));
        }
        if !required_fields.is_empty() {
            row.push_str(&format!(" requiredFields={required_fields}"));
        }
        lines.push(row);
    }

    if let Some(evidence_summary) = card.get("evidenceSummary") {
        let artifact = evidence_summary.get("artifact").unwrap_or(&Value::Null);
        let verification = evidence_summary.get("verification").unwrap_or(&Value::Null);
        let completion = evidence_summary.get("completion").unwrap_or(&Value::Null);
        let runs = evidence_summary.get("runs").unwrap_or(&Value::Null);
        let artifact_total = artifact.get("total").and_then(Value::as_u64).unwrap_or(0);
        let required_satisfied = artifact
            .get("requiredSatisfied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let missing_required = format_string_array(artifact.get("missingRequired"));
        let verification_report = verification
            .get("hasReport")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let verification_verdict = verification
            .get("verdict")
            .and_then(Value::as_str)
            .unwrap_or("-");
        let completion_summary = completion
            .get("hasSummary")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let run_total = runs.get("total").and_then(Value::as_u64).unwrap_or(0);
        let latest_status = runs
            .get("latestStatus")
            .and_then(Value::as_str)
            .unwrap_or("none");

        let mut artifact_row = format!(
            "Evidence: artifacts={} requiredSatisfied={}",
            artifact_total,
            yes_no(required_satisfied)
        );
        if !missing_required.is_empty() {
            artifact_row.push_str(&format!(" missingRequired={missing_required}"));
        }
        lines.push(artifact_row);
        lines.push(format!(
            "Verification: report={} verdict={verification_verdict}",
            yes_no(verification_report)
        ));
        lines.push(format!(
            "Runs: total={} latestStatus={} completionSummary={}",
            run_total,
            latest_status,
            yes_no(completion_summary)
        ));
    }

    if let Some(invest_validation) = card.get("investValidation") {
        let source = invest_validation
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let overall_status = invest_validation
            .get("overallStatus")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let issues = format_string_array(invest_validation.get("issues"));
        let mut row = format!("INVEST: overall={overall_status} source={source}");
        if !issues.is_empty() {
            row.push_str(&format!(" issues={issues}"));
        }
        lines.push(row);
    }

    push_text_block(
        &mut lines,
        "Completion summary",
        value_str(card, "completionSummary"),
    );
    push_text_block(
        &mut lines,
        "Verification report",
        value_str(card, "verificationReport"),
    );

    Some(lines.join("\n"))
}

fn format_delete_card_text(result: &Value) -> Option<String> {
    let card_id = value_str(result, "cardId").or_else(|| value_str(result, "card_id"))?;
    let deleted = value_bool(result, "deleted").unwrap_or(false);
    Some(format!("Deleted card: id={card_id} deleted={deleted}"))
}

fn format_delete_column_text(result: &Value) -> Option<String> {
    let column_id = value_str(result, "columnId")?;
    let deleted = value_bool(result, "deleted").unwrap_or(false);
    let cards_deleted = value_u64(result, "cardsDeleted").unwrap_or(0);
    let cards_moved = value_u64(result, "cardsMoved").unwrap_or(0);
    Some(format!(
        "Deleted column: id={column_id} deleted={deleted} cardsMoved={cards_moved} cardsDeleted={cards_deleted}"
    ))
}

fn format_issue_created_text(result: &Value) -> Option<String> {
    let card_id = value_str(result, "cardId")?;
    let issue = result.get("issue")?;
    let repo = value_str(issue, "repo").unwrap_or("unknown");
    let number = value_u64(issue, "number").unwrap_or(0);
    let url = value_str(issue, "url").unwrap_or("-");
    Some(format!(
        "Created GitHub issue: cardId={card_id} issue={repo}#{number} url={url}"
    ))
}

fn format_cards_text(result: &Value, header: &str, board_id: Option<&str>) -> Option<String> {
    let cards = value_array(result, "cards")?;
    let total = value_u64(result, "total").unwrap_or(cards.len() as u64);
    let mut lines = if let Some(board_id) = board_id {
        vec![format!("{header} ({total}) on board {board_id}:")]
    } else {
        vec![format!("{header} ({total}):")]
    };

    if cards.is_empty() {
        lines.push("  (no cards)".to_string());
        return Some(lines.join("\n"));
    }

    for card in cards {
        lines.push(format_card_row(card));
    }

    Some(lines.join("\n"))
}

fn format_card_row(card: &Value) -> String {
    let column_id = value_str(card, "columnId").unwrap_or("backlog");
    let status = value_str(card, "status").unwrap_or("unknown");
    let priority = value_str(card, "priority").unwrap_or("-");
    let updated_at = format_rfc3339_timestamp(card.get("updatedAt").and_then(Value::as_str));
    let id = value_str(card, "id").unwrap_or("?");
    let title = value_str(card, "title").unwrap_or("untitled");
    let labels = format_labels(card.get("labels"));
    let label_suffix = if labels.is_empty() {
        String::new()
    } else {
        format!("  labels={labels}")
    };

    format!(
        "  {:<10} {:<16} {:<8} {:<16} {}  {}{}",
        column_id,
        status,
        priority,
        updated_at,
        short_id(id),
        truncate_text(title, 52),
        label_suffix
    )
}

fn format_board_status_text(result: &Value) -> Option<String> {
    let board_id = value_str(result, "boardId")?;
    let board_name = value_str(result, "boardName").unwrap_or("unnamed");
    let workspace_id = value_str(result, "workspaceId").unwrap_or("default");
    let total_cards = value_u64(result, "totalCards").unwrap_or(0);
    let columns = value_array(result, "columns").unwrap_or(&[]);

    let mut lines = vec![format!(
        "Board status: {} [{}] workspace={}",
        board_name, board_id, workspace_id
    )];
    lines.push(format!("Total cards: {total_cards}"));
    lines.push(format!(
        "Status totals: {}",
        format_status_totals(result.get("totals"))
    ));
    lines.push("Columns:".to_string());

    if columns.is_empty() {
        lines.push("  (no columns)".to_string());
        return Some(lines.join("\n"));
    }

    for column in columns {
        let column_id = value_str(column, "id").unwrap_or("?");
        let column_name = value_str(column, "name").unwrap_or("unnamed");
        let stage = value_str(column, "stage").unwrap_or(column_id);
        let card_count = value_u64(column, "cardCount").unwrap_or(0);
        let automation = if value_bool(column, "automationEnabled").unwrap_or(false) {
            "on"
        } else {
            "off"
        };
        let required_artifacts = format_string_array(column.get("requiredArtifacts"));
        let required_fields = format_string_array(column.get("requiredTaskFields"));
        let mut row = format!(
            "  {column_id}  {column_name}  stage={stage} cards={card_count} automation={automation}"
        );
        if !required_artifacts.is_empty() {
            row.push_str(&format!(" requiredArtifacts={required_artifacts}"));
        }
        if !required_fields.is_empty() {
            row.push_str(&format!(" requiredFields={required_fields}"));
        }
        lines.push(row);
    }

    Some(lines.join("\n"))
}

fn format_automation_list_text(result: &Value) -> Option<String> {
    let board_id = value_str(result, "boardId")?;
    let columns = value_array(result, "columns").unwrap_or(&[]);
    let mut lines = vec![format!("Automations for board {}:", board_id)];

    if columns.is_empty() {
        lines.push("  (no columns)".to_string());
        return Some(lines.join("\n"));
    }

    for column in columns {
        let column_id = value_str(column, "columnId").unwrap_or("?");
        let column_name = value_str(column, "columnName").unwrap_or("unnamed");
        let stage = value_str(column, "stage").unwrap_or(column_id);
        let card_count = value_u64(column, "cardCount").unwrap_or(0);
        let enabled = value_bool(column, "automationEnabled").unwrap_or(false);
        lines.push(format!(
            "  {}  {}  stage={} cards={} automation={}",
            column_id,
            column_name,
            stage,
            card_count,
            if enabled { "on" } else { "off" }
        ));
    }

    Some(lines.join("\n"))
}

fn format_trigger_automation_text(result: &Value) -> Option<String> {
    let card_id = value_str(result, "cardId")?;
    let triggered = value_bool(result, "triggered").unwrap_or(false);
    let mut lines = vec![format!(
        "Automation trigger: cardId={} triggered={}",
        card_id, triggered
    )];
    if let Some(session_id) = value_str(result, "sessionId") {
        lines.push(format!("  sessionId={session_id}"));
    }
    if let Some(message) = value_str(result, "message") {
        if !message.is_empty() {
            lines.push(format!("  message={message}"));
        }
    }
    if let Some(error) = value_str(result, "error") {
        if !error.is_empty() {
            lines.push(format!("  error={error}"));
        }
    }
    Some(lines.join("\n"))
}

fn format_sync_summary_text(result: &Value) -> Option<String> {
    let repo = value_str(result, "repo")?;
    let board_id = value_str(result, "boardId").unwrap_or("?");
    let column_id = value_str(result, "columnId").unwrap_or("backlog");
    let dry_run = value_bool(result, "dryRun").unwrap_or(false);
    let created = value_u64(result, "created").unwrap_or(0);
    let updated = value_u64(result, "updated").unwrap_or(0);
    let skipped = value_u64(result, "skipped").unwrap_or(0);
    let tasks = value_array(result, "tasks").unwrap_or(&[]);

    let mut lines = vec![format!(
        "GitHub sync: repo={} board={} column={} dryRun={}",
        repo, board_id, column_id, dry_run
    )];
    lines.push(format!(
        "  created={created} updated={updated} skipped={skipped}"
    ));

    if !tasks.is_empty() {
        lines.push("  tasks:".to_string());
        for task in tasks {
            let card_id = value_str(task, "cardId").unwrap_or("?");
            let github_number = value_u64(task, "githubNumber").unwrap_or(0);
            let action = value_str(task, "action").unwrap_or("unknown");
            let title = value_str(task, "title").unwrap_or("untitled");
            lines.push(format!(
                "    {}  #{}  {}  {}",
                action,
                github_number,
                short_id(card_id),
                truncate_text(title, 60)
            ));
        }
    }

    Some(lines.join("\n"))
}

fn format_status_totals(totals: Option<&Value>) -> String {
    let by_status = totals
        .and_then(|value| value.get("byStatus"))
        .and_then(Value::as_object);
    let Some(by_status) = by_status else {
        return "none".to_string();
    };

    let mut ordered = Vec::new();
    let mut remaining = BTreeMap::new();
    for (key, value) in by_status {
        remaining.insert(key.clone(), value.as_u64().unwrap_or(0));
    }

    for key in [
        "PENDING",
        "IN_PROGRESS",
        "REVIEW_REQUIRED",
        "NEEDS_FIX",
        "BLOCKED",
        "COMPLETED",
        "CANCELLED",
    ] {
        if let Some(value) = remaining.remove(key) {
            ordered.push(format!("{key}={value}"));
        }
    }

    for (key, value) in remaining {
        ordered.push(format!("{key}={value}"));
    }

    if ordered.is_empty() {
        "none".to_string()
    } else {
        ordered.join(", ")
    }
}

fn format_labels(value: Option<&Value>) -> String {
    format_string_array(value)
}

fn format_string_array(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default()
}

fn push_text_block(lines: &mut Vec<String>, heading: &str, value: Option<&str>) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };

    lines.push(format!("{heading}:"));
    for line in value.lines() {
        if line.is_empty() {
            lines.push("  ".to_string());
        } else {
            lines.push(format!("  {line}"));
        }
    }
}

fn push_string_list_block(lines: &mut Vec<String>, heading: &str, value: Option<&Value>) {
    let values: Vec<&str> = value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if values.is_empty() {
        return;
    }

    lines.push(format!("{heading}:"));
    for value in values {
        lines.push(format!("  - {value}"));
    }
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
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
            json!({ "workspaceId": config.workspace_id }),
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
        plan.push(json!({
            "action": action,
            "boardId": board.id,
            "boardName": board.name,
            "workspaceId": config.workspace_id,
            "columns": board.columns.len()
        }));
    }

    if dry_run {
        print_json(&json!({
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
                json!({
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
                json!({
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
                        json!({
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
                applied.push(json!({
                    "boardId": board.id,
                    "result": result
                }));
            }
            Err(error) => {
                failures.push(json!({
                    "boardId": board.id,
                    "error": error
                }));
                if !continue_on_error {
                    break;
                }
            }
        }
    }

    print_json(&json!({
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
        json!({ "workspaceId": workspace_id }),
    )
    .await?;
    let parsed: ListBoardsResponse =
        serde_json::from_value(result).map_err(|error| error.to_string())?;

    let mut boards = Vec::new();
    for board in parsed.boards {
        let board_result =
            call_rpc(state, "kanban.getBoard", json!({ "boardId": board.id })).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_status_text_is_human_readable() {
        let rendered = format_board_status_text(&json!({
            "boardId": "board-1",
            "boardName": "Default Board",
            "workspaceId": "default",
            "totalCards": 3,
            "totals": {
                "total": 3,
                "byStatus": {
                    "PENDING": 2,
                    "IN_PROGRESS": 1
                }
            },
            "columns": [
                {
                    "id": "backlog",
                    "name": "Backlog",
                    "stage": "backlog",
                    "cardCount": 2,
                    "automationEnabled": false,
                    "requiredArtifacts": [],
                    "requiredTaskFields": []
                },
                {
                    "id": "dev",
                    "name": "Dev",
                    "stage": "dev",
                    "cardCount": 1,
                    "automationEnabled": true,
                    "requiredArtifacts": ["patch"],
                    "requiredTaskFields": ["acceptance_criteria"]
                }
            ]
        }))
        .expect("status text");

        assert!(rendered.contains("Board status: Default Board [board-1] workspace=default"));
        assert!(rendered.contains("Status totals: PENDING=2, IN_PROGRESS=1"));
        assert!(rendered.contains("dev  Dev  stage=dev cards=1 automation=on"));
        assert!(rendered.contains("requiredArtifacts=patch"));
    }

    #[test]
    fn board_list_text_marks_default_board() {
        let rendered = format_board_list_text(
            &json!({
                "boards": [
                    {
                        "id": "board-1",
                        "name": "Default Board",
                        "isDefault": true,
                        "columnCount": 6
                    },
                    {
                        "id": "board-2",
                        "name": "Ops",
                        "isDefault": false,
                        "columnCount": 3
                    }
                ]
            }),
            "default",
        )
        .expect("board list");

        assert!(rendered.contains("Boards (2) in workspace default"));
        assert!(rendered.contains("* Default Board  columns=6  id=board-1"));
        assert!(rendered.contains("Ops  columns=3  id=board-2"));
    }

    #[test]
    fn cards_text_handles_empty_results() {
        let rendered = format_cards_text(
            &json!({
                "boardId": "board-1",
                "total": 0,
                "cards": []
            }),
            "Cards in workspace default",
            Some("board-1"),
        )
        .expect("cards text");

        assert!(rendered.contains("Cards in workspace default (0) on board board-1"));
        assert!(rendered.contains("(no cards)"));
    }

    #[test]
    fn card_detail_text_is_human_readable() {
        let rendered = format_card_detail_text(&json!({
            "id": "card-1",
            "title": "Investigate flaky review lane",
            "objective": "Find the root cause and capture the mitigation plan.",
            "scope": "Review the review lane automation and evidence gate.",
            "workspaceId": "default",
            "boardId": "board-1",
            "columnId": "review",
            "position": 2,
            "status": "REVIEW_REQUIRED",
            "priority": "high",
            "labels": ["bug", "automation"],
            "assignee": "phodal",
            "assignedProvider": "codex",
            "assignedRole": "DEVELOPER",
            "assignedSpecialistName": "KanbanTask Agent",
            "triggerSessionId": "session-1",
            "githubRepo": "phodal/routa",
            "githubNumber": 503,
            "githubState": "open",
            "githubUrl": "https://github.com/phodal/routa/issues/503",
            "acceptanceCriteria": ["Root cause identified", "Follow-up issue created"],
            "verificationCommands": ["cargo test -p routa-cli kanban"],
            "testCases": ["Create a card from CLI and verify live refresh"],
            "dependencies": ["card-0"],
            "codebaseIds": ["phodal/routa"],
            "storyReadiness": {
                "ready": false,
                "missing": ["verification_plan"],
                "requiredTaskFields": ["verification_plan"]
            },
            "evidenceSummary": {
                "artifact": {
                    "total": 2,
                    "requiredSatisfied": false,
                    "missingRequired": ["screenshot"]
                },
                "verification": {
                    "hasReport": true,
                    "verdict": "APPROVED"
                },
                "completion": {
                    "hasSummary": false
                },
                "runs": {
                    "total": 1,
                    "latestStatus": "completed"
                }
            },
            "investValidation": {
                "source": "lane_rules",
                "overallStatus": "warning",
                "issues": ["verification_plan missing"]
            },
            "completionSummary": "Verification complete.",
            "verificationReport": "All checks passed.",
            "createdAt": "2026-04-20T06:00:00Z",
            "updatedAt": "2026-04-20T06:30:00Z"
        }))
        .expect("card detail text");

        assert!(rendered.contains("Card: Investigate flaky review lane [card-1]"));
        assert!(rendered.contains("workspace=default board=board-1 column=review position=2"));
        assert!(rendered.contains("github=phodal/routa#503 state=open"));
        assert!(rendered.contains("Acceptance criteria:"));
        assert!(rendered.contains("Story readiness: ready=no missing=verification_plan"));
        assert!(rendered
            .contains("Evidence: artifacts=2 requiredSatisfied=no missingRequired=screenshot"));
        assert!(rendered.contains("Verification report:"));
    }
}
