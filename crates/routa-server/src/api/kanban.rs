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
use routa_core::models::task::{Task, TaskLaneSessionStatus, TaskStatus};
use routa_core::models::workspace::Workspace;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use tokio::sync::mpsc;

use crate::error::ServerError;
use crate::rpc::RpcRouter;
use crate::state::AppState;

fn lane_session_uses_in_memory_runtime(transport: Option<&str>) -> bool {
    transport != Some("a2a")
}

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

fn get_auto_provider(metadata: &HashMap<String, String>, board_id: &str) -> Option<String> {
    let key = format!("kanbanAutoProvider:{}", board_id);
    metadata
        .get(&key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KanbanDevSessionSupervision {
    mode: String,
    inactivity_timeout_minutes: u32,
    max_recovery_attempts: u32,
    completion_requirement: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KanbanQueueCard {
    card_id: String,
    card_title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KanbanBoardQueueSnapshot {
    board_id: String,
    running_count: usize,
    running_cards: Vec<KanbanQueueCard>,
    queued_count: usize,
    queued_card_ids: Vec<String>,
    queued_cards: Vec<KanbanQueueCard>,
    queued_positions: HashMap<String, usize>,
}

fn default_dev_session_supervision() -> KanbanDevSessionSupervision {
    KanbanDevSessionSupervision {
        mode: "watchdog_retry".to_string(),
        inactivity_timeout_minutes: 10,
        max_recovery_attempts: 1,
        completion_requirement: "turn_complete".to_string(),
    }
}

fn dev_supervision_metadata_key(board_id: &str) -> String {
    format!("kanbanDevSessionSupervision:{}", board_id)
}

fn normalize_dev_session_supervision(
    value: PartialKanbanDevSessionSupervision,
) -> KanbanDevSessionSupervision {
    let defaults = default_dev_session_supervision();
    let mode = match value.mode.as_deref() {
        Some("disabled" | "watchdog_retry" | "ralph_loop") => value.mode.unwrap_or(defaults.mode),
        _ => defaults.mode,
    };
    let inactivity_timeout_minutes = value
        .inactivity_timeout_minutes
        .unwrap_or(defaults.inactivity_timeout_minutes)
        .clamp(1, 120);
    let max_recovery_attempts = value
        .max_recovery_attempts
        .unwrap_or(defaults.max_recovery_attempts)
        .clamp(0, 10);
    let completion_requirement = match value.completion_requirement.as_deref() {
        Some("turn_complete" | "completion_summary" | "verification_report") => value
            .completion_requirement
            .unwrap_or(defaults.completion_requirement),
        _ => defaults.completion_requirement,
    };

    KanbanDevSessionSupervision {
        mode,
        inactivity_timeout_minutes,
        max_recovery_attempts,
        completion_requirement,
    }
}

fn get_dev_session_supervision(
    metadata: &HashMap<String, String>,
    board_id: &str,
) -> KanbanDevSessionSupervision {
    let Some(raw) = metadata.get(&dev_supervision_metadata_key(board_id)) else {
        return default_dev_session_supervision();
    };

    serde_json::from_str::<PartialKanbanDevSessionSupervision>(raw)
        .map(normalize_dev_session_supervision)
        .unwrap_or_else(|_| default_dev_session_supervision())
}

fn set_dev_session_supervision(
    metadata: &HashMap<String, String>,
    board_id: &str,
    value: PartialKanbanDevSessionSupervision,
) -> HashMap<String, String> {
    let mut next = metadata.clone();
    let normalized = normalize_dev_session_supervision(value);
    next.insert(
        dev_supervision_metadata_key(board_id),
        serde_json::to_string(&normalized).unwrap_or_default(),
    );
    next
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialKanbanDevSessionSupervision {
    mode: Option<String>,
    inactivity_timeout_minutes: Option<u32>,
    max_recovery_attempts: Option<u32>,
    completion_requirement: Option<String>,
}

async fn build_board_queue_snapshot(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
) -> Result<KanbanBoardQueueSnapshot, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let running_cards = tasks
        .into_iter()
        .filter(|task| task.board_id.as_deref() == Some(board_id))
        .filter(task_has_running_lane_session)
        .map(|task| KanbanQueueCard {
            card_id: task.id,
            card_title: task.title,
        })
        .collect::<Vec<_>>();

    Ok(KanbanBoardQueueSnapshot {
        board_id: board_id.to_string(),
        running_count: running_cards.len(),
        running_cards,
        queued_count: 0,
        queued_card_ids: Vec::new(),
        queued_cards: Vec::new(),
        queued_positions: HashMap::new(),
    })
}

async fn is_session_actively_running(state: &AppState, session_id: &str) -> bool {
    if state.acp_manager.get_session(session_id).await.is_some() {
        return true;
    }

    let Ok(Some(session)) = state.acp_session_store.get(session_id).await else {
        return false;
    };

    !persisted_session_is_explicitly_terminal(&session.message_history)
}

fn persisted_session_is_explicitly_terminal(history: &[serde_json::Value]) -> bool {
    history
        .iter()
        .rev()
        .find_map(session_history_entry_runtime_state)
        == Some(PersistedSessionRuntimeState::Error)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistedSessionRuntimeState {
    Active,
    Error,
}

fn session_history_entry_runtime_state(
    entry: &serde_json::Value,
) -> Option<PersistedSessionRuntimeState> {
    let update = entry.get("update").and_then(serde_json::Value::as_object);
    let session_update = update
        .and_then(|update| update.get("sessionUpdate"))
        .and_then(serde_json::Value::as_str);

    if session_update == Some("error") {
        return Some(PersistedSessionRuntimeState::Error);
    }

    if session_update == Some("acp_status") {
        let status = update
            .and_then(|update| update.get("status"))
            .and_then(serde_json::Value::as_str);
        return match status {
            Some("error") => Some(PersistedSessionRuntimeState::Error),
            Some("ready" | "connecting") => Some(PersistedSessionRuntimeState::Active),
            _ => None,
        };
    }

    if entry.get("type").and_then(serde_json::Value::as_str) == Some("error") {
        return Some(PersistedSessionRuntimeState::Error);
    }

    None
}

fn resolve_stale_lane_session_terminal_status(task: &Task) -> TaskLaneSessionStatus {
    if task.verification_verdict.is_some()
        || task.verification_report.is_some()
        || task.completion_summary.is_some()
    {
        TaskLaneSessionStatus::Transitioned
    } else {
        TaskLaneSessionStatus::TimedOut
    }
}

fn mark_lane_session_terminal(
    lane_session: &mut routa_core::models::task::TaskLaneSession,
    status: TaskLaneSessionStatus,
) {
    lane_session.status = status;
    lane_session.completed_at = Some(chrono::Utc::now().to_rfc3339());
}

fn apply_lane_automation_defaults(
    task: &mut Task,
    automation: &routa_core::models::kanban::KanbanColumnAutomation,
) {
    let Some(step) = automation.primary_step() else {
        return;
    };

    if task.assigned_provider.is_none() {
        task.assigned_provider = step.provider_id.or_else(|| automation.provider_id.clone());
    }
    if task.assigned_role.is_none() {
        task.assigned_role = step.role.or_else(|| automation.role.clone());
    }
    if task.assigned_specialist_id.is_none() {
        task.assigned_specialist_id = step
            .specialist_id
            .or_else(|| automation.specialist_id.clone());
    }
    if task.assigned_specialist_name.is_none() {
        task.assigned_specialist_name = step
            .specialist_name
            .or_else(|| automation.specialist_name.clone());
    }
}

async fn sanitize_stale_current_lane_automation(
    state: &AppState,
    mut task: Task,
) -> Result<Task, ServerError> {
    let mut mutated = false;
    let terminal_status = resolve_stale_lane_session_terminal_status(&task);

    if let Some(trigger_session_id) = task.trigger_session_id.clone() {
        let trigger_lane_session = task
            .lane_sessions
            .iter()
            .find(|entry| entry.session_id == trigger_session_id);
        let should_check_runtime = trigger_lane_session
            .map(|entry| lane_session_uses_in_memory_runtime(entry.transport.as_deref()))
            .unwrap_or(true);

        if should_check_runtime && !is_session_actively_running(state, &trigger_session_id).await {
            if let Some(entry) = task.lane_sessions.iter_mut().find(|entry| {
                entry.session_id == trigger_session_id
                    && entry.column_id == task.column_id
                    && entry.status == TaskLaneSessionStatus::Running
            }) {
                mark_lane_session_terminal(entry, terminal_status.clone());
            }
            task.trigger_session_id = None;
            mutated = true;
        }
    }

    for entry in &mut task.lane_sessions {
        if entry.column_id != task.column_id
            || entry.status != TaskLaneSessionStatus::Running
            || !lane_session_uses_in_memory_runtime(entry.transport.as_deref())
        {
            continue;
        }

        if !is_session_actively_running(state, &entry.session_id).await {
            mark_lane_session_terminal(entry, terminal_status.clone());
            mutated = true;
        }
    }

    if mutated {
        task.updated_at = chrono::Utc::now();
        state.task_store.save(&task).await?;
    }

    Ok(task)
}

async fn has_active_current_lane_session(
    state: &AppState,
    task: &Task,
    current_column_id: &str,
) -> bool {
    for entry in &task.lane_sessions {
        if entry.column_id.as_deref() != Some(current_column_id)
            || entry.status != TaskLaneSessionStatus::Running
            || !lane_session_uses_in_memory_runtime(entry.transport.as_deref())
        {
            continue;
        }

        if is_session_actively_running(state, &entry.session_id).await {
            return true;
        }
    }

    false
}

async fn revive_missing_entry_automations(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
) -> Result<(), ServerError> {
    let Some(board) = state.kanban_store.get(board_id).await? else {
        return Ok(());
    };

    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    for original_task in tasks {
        if original_task.board_id.as_deref() != Some(board_id) {
            continue;
        }

        let task = sanitize_stale_current_lane_automation(state, original_task).await?;
        if task.trigger_session_id.is_some() {
            continue;
        }

        let Some(current_column_id) = task.column_id.clone() else {
            continue;
        };
        let Some(column) = board
            .columns
            .iter()
            .find(|entry| entry.id == current_column_id)
            .cloned()
        else {
            continue;
        };
        let Some(automation) = column.automation.clone() else {
            continue;
        };
        let transition_type = automation.transition_type.as_deref().unwrap_or("entry");
        if !automation.enabled
            || !matches!(transition_type, "entry" | "both")
            || automation.primary_step().is_none()
            || has_active_current_lane_session(state, &task, &current_column_id).await
        {
            continue;
        }

        let mut task = task;
        apply_lane_automation_defaults(&mut task, &automation);
        match crate::api::tasks_automation::trigger_assigned_task_agent(
            state, &mut task, None, None,
        )
        .await
        {
            Ok(()) => task.last_sync_error = None,
            Err(error) => task.last_sync_error = Some(error),
        }
        task.updated_at = chrono::Utc::now();
        state.task_store.save(&task).await?;
    }

    Ok(())
}

fn task_has_running_lane_session(task: &Task) -> bool {
    if task
        .lane_sessions
        .iter()
        .any(|session| session.status == TaskLaneSessionStatus::Running)
    {
        return true;
    }

    task.trigger_session_id.is_some()
        && matches!(
            task.status,
            TaskStatus::InProgress | TaskStatus::ReviewRequired
        )
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

    for board_id in &board_ids {
        revive_missing_entry_automations(&state, &workspace_id, board_id).await?;
    }

    let mut boards = Vec::with_capacity(board_ids.len());
    for board_id in board_ids {
        let rpc_board = rpc_result(
            &state,
            "kanban.getBoard",
            serde_json::json!({ "boardId": board_id }),
        )
        .await?;
        let mut board = strip_board_cards(&rpc_board);
        add_board_runtime_meta(&state, &mut board, &metadata, &workspace_id).await?;
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
    add_board_runtime_meta(&state, &mut board, &metadata, workspace_id).await?;
    Ok(Json(serde_json::json!({ "board": board })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBoardRequest {
    name: Option<String>,
    columns: Option<serde_json::Value>,
    is_default: Option<bool>,
    auto_provider_id: Option<String>,
    session_concurrency_limit: Option<u32>,
    dev_session_supervision: Option<PartialKanbanDevSessionSupervision>,
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
    if let Some(auto_provider_id) = body.auto_provider_id {
        persist_auto_provider(&state, &workspace_id, &board_id, Some(auto_provider_id)).await?;
    }
    if let Some(dev_session_supervision) = body.dev_session_supervision {
        persist_dev_session_supervision(&state, &workspace_id, &board_id, dev_session_supervision)
            .await?;
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
    add_board_runtime_meta(&state, &mut board, &metadata, &workspace_id).await?;

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

async fn persist_auto_provider(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
    provider_id: Option<String>,
) -> Result<(), ServerError> {
    let workspace = state.workspace_store.get(workspace_id).await.ok().flatten();
    if let Some(mut workspace) = workspace {
        let key = format!("kanbanAutoProvider:{}", board_id);
        if let Some(provider_id) = provider_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            workspace.metadata.insert(key, provider_id);
        } else {
            workspace.metadata.remove(&key);
        }
        state.workspace_store.save(&workspace).await?;
    }
    Ok(())
}

async fn persist_dev_session_supervision(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
    value: PartialKanbanDevSessionSupervision,
) -> Result<(), ServerError> {
    let workspace = state.workspace_store.get(workspace_id).await.ok().flatten();
    if let Some(mut workspace) = workspace {
        workspace.metadata = set_dev_session_supervision(&workspace.metadata, board_id, value);
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

async fn add_board_runtime_meta(
    state: &AppState,
    board: &mut serde_json::Value,
    metadata: &HashMap<String, String>,
    workspace_id: &str,
) -> Result<(), ServerError> {
    let Some(object) = board.as_object_mut() else {
        return Ok(());
    };

    let board_id = object
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let queue = build_board_queue_snapshot(state, workspace_id, &board_id).await?;
    object.insert(
        "sessionConcurrencyLimit".to_string(),
        serde_json::json!(get_session_concurrency_limit(metadata, &board_id)),
    );
    object.insert(
        "autoProviderId".to_string(),
        serde_json::to_value(get_auto_provider(metadata, &board_id))
            .unwrap_or(serde_json::Value::Null),
    );
    object.insert(
        "devSessionSupervision".to_string(),
        serde_json::to_value(get_dev_session_supervision(metadata, &board_id))
            .unwrap_or(serde_json::Value::Null),
    );
    object.insert(
        "queue".to_string(),
        serde_json::to_value(queue).unwrap_or(serde_json::Value::Null),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        default_dev_session_supervision, get_dev_session_supervision,
        normalize_dev_session_supervision, persisted_session_is_explicitly_terminal,
        sanitize_stale_current_lane_automation, translate_agent_event_to_kanban_payload,
        PartialKanbanDevSessionSupervision,
    };
    use chrono::Utc;
    use routa_core::events::{AgentEvent, AgentEventType};
    use routa_core::models::task::{Task, TaskLaneSession, TaskLaneSessionStatus, TaskStatus};
    use routa_core::store::acp_session_store::CreateAcpSessionParams;
    use routa_core::{AppState, AppStateInner, Database};
    use serde_json::json;
    use std::collections::HashMap;
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

    fn build_task(id: &str) -> Task {
        let mut task = Task::new(
            id.to_string(),
            "Review story".to_string(),
            "Recover stale automation".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.board_id = Some("board-1".to_string());
        task.column_id = Some("review".to_string());
        task.status = TaskStatus::ReviewRequired;
        task
    }

    async fn persist_session(state: &AppState, session_id: &str, history: &[serde_json::Value]) {
        state
            .acp_session_store
            .create(CreateAcpSessionParams {
                id: session_id,
                cwd: ".",
                branch: None,
                workspace_id: "default",
                provider: Some("codex-acp"),
                role: Some("GATE"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("session should persist");
        state
            .acp_session_store
            .save_history(session_id, history)
            .await
            .expect("history should persist");
    }

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

    #[test]
    fn dev_session_supervision_defaults_when_missing() {
        let metadata = HashMap::new();

        assert_eq!(
            serde_json::to_value(get_dev_session_supervision(&metadata, "board-1")).unwrap(),
            serde_json::to_value(default_dev_session_supervision()).unwrap()
        );
    }

    #[test]
    fn normalize_dev_session_supervision_clamps_invalid_values() {
        let normalized = normalize_dev_session_supervision(PartialKanbanDevSessionSupervision {
            mode: Some("unknown".to_string()),
            inactivity_timeout_minutes: Some(999),
            max_recovery_attempts: Some(999),
            completion_requirement: Some("bogus".to_string()),
        });

        assert_eq!(normalized.mode, "watchdog_retry");
        assert_eq!(normalized.inactivity_timeout_minutes, 120);
        assert_eq!(normalized.max_recovery_attempts, 10);
        assert_eq!(normalized.completion_requirement, "turn_complete");
    }

    #[tokio::test]
    async fn stale_current_lane_sessions_are_marked_terminal_and_trigger_is_cleared() {
        let state = setup_state().await;
        let mut task = build_task("task-1");
        task.trigger_session_id = Some("session-1".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-1".to_string(),
            routa_agent_id: None,
            column_id: Some("review".to_string()),
            column_name: Some("Review".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: Some("codex-acp".to_string()),
            role: Some("GATE".to_string()),
            specialist_id: None,
            specialist_name: None,
            transport: Some("acp".to_string()),
            external_task_id: None,
            context_id: None,
            attempt: Some(1),
            loop_mode: None,
            completion_requirement: None,
            objective: Some(task.objective.clone()),
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
        });

        let updated = sanitize_stale_current_lane_automation(&state, task)
            .await
            .expect("sanitize should succeed");

        assert_eq!(updated.trigger_session_id, None);
        assert_eq!(updated.lane_sessions.len(), 1);
        assert_eq!(
            updated.lane_sessions[0].status,
            TaskLaneSessionStatus::TimedOut
        );
        assert!(updated.lane_sessions[0].completed_at.is_some());
    }

    #[tokio::test]
    async fn stale_sessions_with_verification_evidence_become_transitioned() {
        let state = setup_state().await;
        let mut task = build_task("task-2");
        task.trigger_session_id = Some("session-2".to_string());
        task.verification_report = Some("approved".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-2".to_string(),
            routa_agent_id: None,
            column_id: Some("review".to_string()),
            column_name: Some("Review".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: Some("codex-acp".to_string()),
            role: Some("GATE".to_string()),
            specialist_id: None,
            specialist_name: None,
            transport: Some("acp".to_string()),
            external_task_id: None,
            context_id: None,
            attempt: Some(1),
            loop_mode: None,
            completion_requirement: None,
            objective: Some(task.objective.clone()),
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
        });

        let updated = sanitize_stale_current_lane_automation(&state, task)
            .await
            .expect("sanitize should succeed");

        assert_eq!(
            updated.lane_sessions[0].status,
            TaskLaneSessionStatus::Transitioned
        );
    }

    #[tokio::test]
    async fn a2a_lane_sessions_are_not_marked_stale_by_missing_acp_runtime() {
        let state = setup_state().await;
        let mut task = build_task("task-3");
        task.trigger_session_id = Some("session-3".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-3".to_string(),
            routa_agent_id: None,
            column_id: Some("review".to_string()),
            column_name: Some("Review".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: None,
            role: None,
            specialist_id: None,
            specialist_name: None,
            transport: Some("a2a".to_string()),
            external_task_id: Some("remote-task-1".to_string()),
            context_id: Some("ctx-1".to_string()),
            attempt: Some(1),
            loop_mode: None,
            completion_requirement: None,
            objective: Some(task.objective.clone()),
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
        });

        let updated = sanitize_stale_current_lane_automation(&state, task)
            .await
            .expect("sanitize should succeed");

        assert_eq!(updated.trigger_session_id.as_deref(), Some("session-3"));
        assert_eq!(
            updated.lane_sessions[0].status,
            TaskLaneSessionStatus::Running
        );
        assert_eq!(updated.lane_sessions[0].completed_at, None);
    }

    #[test]
    fn persisted_session_history_only_becomes_terminal_on_explicit_runtime_error() {
        assert!(!persisted_session_is_explicitly_terminal(&[
            json!({
                "sessionId": "session-4",
                "update": {
                    "sessionUpdate": "acp_status",
                    "status": "ready",
                }
            }),
            json!({
                "sessionId": "session-4",
                "update": {
                    "sessionUpdate": "agent_message",
                    "content": { "text": "still resumable" }
                }
            }),
        ]));

        assert!(!persisted_session_is_explicitly_terminal(&[json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "acp_status",
                "content": { "text": "connected" }
            }
        })]));

        assert!(persisted_session_is_explicitly_terminal(&[json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "acp_status",
                "status": "error",
                "error": "session crashed"
            }
        })]));

        assert!(!persisted_session_is_explicitly_terminal(&[
            json!({
                "sessionId": "session-4",
                "update": {
                    "sessionUpdate": "acp_status",
                    "status": "error",
                    "error": "session crashed"
                }
            }),
            json!({
                "sessionId": "session-4",
                "update": {
                    "sessionUpdate": "acp_status",
                    "status": "ready",
                }
            }),
        ]));
    }

    #[tokio::test]
    async fn persisted_restorable_sessions_keep_lane_ownership_after_restart() {
        let state = setup_state().await;
        persist_session(
            &state,
            "session-4",
            &[json!({
                "sessionId": "session-4",
                "update": {
                    "sessionUpdate": "agent_message",
                    "content": { "text": "restorable" }
                }
            })],
        )
        .await;

        let mut task = build_task("task-4");
        task.trigger_session_id = Some("session-4".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-4".to_string(),
            routa_agent_id: None,
            column_id: Some("review".to_string()),
            column_name: Some("Review".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: Some("codex-acp".to_string()),
            role: Some("GATE".to_string()),
            specialist_id: None,
            specialist_name: None,
            transport: Some("acp".to_string()),
            external_task_id: None,
            context_id: None,
            attempt: Some(1),
            loop_mode: None,
            completion_requirement: None,
            objective: Some(task.objective.clone()),
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
        });

        let updated = sanitize_stale_current_lane_automation(&state, task)
            .await
            .expect("sanitize should succeed");

        assert_eq!(updated.trigger_session_id.as_deref(), Some("session-4"));
        assert_eq!(
            updated.lane_sessions[0].status,
            TaskLaneSessionStatus::Running
        );
        assert_eq!(updated.lane_sessions[0].completed_at, None);
    }

    #[tokio::test]
    async fn persisted_error_sessions_release_lane_ownership_after_restart() {
        let state = setup_state().await;
        persist_session(
            &state,
            "session-5",
            &[json!({
                "sessionId": "session-5",
                "update": {
                    "sessionUpdate": "acp_status",
                    "status": "error",
                    "error": "worker exited"
                }
            })],
        )
        .await;

        let mut task = build_task("task-5");
        task.trigger_session_id = Some("session-5".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-5".to_string(),
            routa_agent_id: None,
            column_id: Some("review".to_string()),
            column_name: Some("Review".to_string()),
            step_id: None,
            step_index: None,
            step_name: None,
            provider: Some("codex-acp".to_string()),
            role: Some("GATE".to_string()),
            specialist_id: None,
            specialist_name: None,
            transport: Some("acp".to_string()),
            external_task_id: None,
            context_id: None,
            attempt: Some(1),
            loop_mode: None,
            completion_requirement: None,
            objective: Some(task.objective.clone()),
            last_activity_at: None,
            recovered_from_session_id: None,
            recovery_reason: None,
            status: TaskLaneSessionStatus::Running,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
        });

        let updated = sanitize_stale_current_lane_automation(&state, task)
            .await
            .expect("sanitize should succeed");

        assert_eq!(updated.trigger_session_id, None);
        assert_eq!(
            updated.lane_sessions[0].status,
            TaskLaneSessionStatus::TimedOut
        );
        assert!(updated.lane_sessions[0].completed_at.is_some());
    }
}
