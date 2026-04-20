use chrono::Utc;
use reqwest::header::{HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::events::{AgentEvent, AgentEventType};
use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanTransport};
use crate::models::task::{
    build_task_evidence_summary, build_task_invest_validation, build_task_story_readiness, Task,
    TaskLaneSessionStatus,
};
use crate::state::AppState;

use super::{
    apply_trigger_result, build_task_prompt, resolve_next_required_artifacts,
    resolve_next_required_task_fields, AgentTriggerResult,
};

const A2A_POLL_INTERVAL: Duration = Duration::from_secs(1);
const A2A_MAX_WAIT: Duration = Duration::from_secs(300);
const A2A_AUTH_CONFIGS_ENV: &str = "ROUTA_A2A_AUTH_CONFIGS";

pub(super) fn is_a2a_step(step: Option<&KanbanAutomationStep>) -> bool {
    step.is_some_and(|value| {
        matches!(value.transport, Some(KanbanTransport::A2a)) || value.agent_card_url.is_some()
    })
}

pub(super) async fn trigger_assigned_task_a2a_agent(
    state: &AppState,
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
) -> Result<(), String> {
    let step = step.ok_or_else(|| "A2A automation requires a resolved column step".to_string())?;
    let agent_card_url = step
        .agent_card_url
        .as_deref()
        .ok_or_else(|| "A2A automation requires agentCardUrl".to_string())?;
    let auth_headers = resolve_a2a_auth_headers(step.auth_config_id.as_deref())?;

    let mut ordered_columns = board.map(|value| value.columns.clone()).unwrap_or_default();
    ordered_columns.sort_by_key(|column| column.position);
    let next_column_id = ordered_columns
        .iter()
        .position(|column| Some(column.id.as_str()) == task.column_id.as_deref())
        .and_then(|index| ordered_columns.get(index + 1))
        .map(|column| column.id.clone());
    let available_columns = if ordered_columns.is_empty() {
        "- unavailable".to_string()
    } else {
        ordered_columns
            .iter()
            .map(|column| {
                format!(
                    "- {} ({}) stage={} position={}",
                    column.id, column.name, column.stage, column.position
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let prompt = build_task_prompt(
        task,
        board
            .map(|value| value.id.as_str())
            .or(task.board_id.as_deref()),
        next_column_id.as_deref(),
        &available_columns,
        Some(&build_task_story_readiness(
            task,
            &resolve_next_required_task_fields(board, task.column_id.as_deref()),
        )),
        Some(&build_task_invest_validation(task)),
        Some(&build_task_evidence_summary(
            task,
            &state
                .artifact_store
                .list_by_task(&task.id)
                .await
                .map_err(|error| format!("Failed to load task artifacts: {error}"))?,
            &resolve_next_required_artifacts(board, task.column_id.as_deref()),
        )),
    );

    let client = reqwest::Client::new();
    let rpc_endpoint =
        resolve_a2a_rpc_endpoint(&client, agent_card_url, auth_headers.as_ref()).await?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let response = apply_a2a_auth_headers(
        client
            .post(&rpc_endpoint)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "SendMessage",
                "params": {
                    "message": {
                        "messageId": message_id,
                        "role": "user",
                        "parts": [{ "text": prompt }]
                    },
                    "metadata": {
                        "workspaceId": task.workspace_id,
                        "taskId": task.id,
                        "boardId": task.board_id,
                        "columnId": task.column_id,
                        "stepId": step.id,
                        "skillId": step.skill_id,
                        "authConfigId": step.auth_config_id,
                        "role": task.assigned_role,
                    }
                }
            })),
        auth_headers.as_ref(),
    )?
    .send()
    .await
    .map_err(|error| format!("Failed to send A2A request: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "A2A request failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode A2A response: {error}"))?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown A2A error");
        return Err(format!("A2A JSON-RPC error: {message}"));
    }

    let task_result = payload
        .get("result")
        .and_then(|value| value.get("task"))
        .ok_or_else(|| "A2A response missing result.task".to_string())?;
    let external_task_id = task_result
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "A2A response missing task.id".to_string())?
        .to_string();
    let context_id = task_result
        .get("contextId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let session_id = format!("a2a-{}", uuid::Uuid::new_v4());

    apply_trigger_result(
        task,
        board,
        Some(step),
        AgentTriggerResult {
            session_id: session_id.clone(),
            transport: "a2a".to_string(),
            external_task_id: Some(external_task_id.clone()),
            context_id,
        },
    );

    let state_clone = state.clone();
    let task_id = task.id.clone();
    let workspace_id = task.workspace_id.clone();
    tokio::spawn(async move {
        monitor_a2a_task_completion(
            &state_clone,
            &workspace_id,
            &task_id,
            &session_id,
            &rpc_endpoint,
            &external_task_id,
            auth_headers,
        )
        .await;
    });

    Ok(())
}

#[derive(Debug)]
struct A2ATaskTerminalUpdate {
    status: TaskLaneSessionStatus,
    completed_at: String,
    last_activity_at: String,
    context_id: Option<String>,
    error: Option<String>,
}

async fn monitor_a2a_task_completion(
    state: &AppState,
    workspace_id: &str,
    task_id: &str,
    session_id: &str,
    rpc_endpoint: &str,
    external_task_id: &str,
    auth_headers: Option<HashMap<String, String>>,
) {
    let client = reqwest::Client::new();
    let terminal = match wait_for_a2a_completion(
        &client,
        rpc_endpoint,
        external_task_id,
        auth_headers.as_ref(),
    )
    .await
    {
        Ok(terminal) => terminal,
        Err(error) => {
            let now = Utc::now().to_rfc3339();
            let status = if error.contains("did not complete within") {
                TaskLaneSessionStatus::TimedOut
            } else {
                TaskLaneSessionStatus::Failed
            };
            A2ATaskTerminalUpdate {
                status,
                completed_at: now.clone(),
                last_activity_at: now,
                context_id: None,
                error: Some(error),
            }
        }
    };

    if let Err(error) =
        reconcile_a2a_lane_session(state, task_id, session_id, external_task_id, terminal).await
    {
        tracing::warn!(
            target: "routa_a2a",
            workspace_id = %workspace_id,
            task_id = %task_id,
            session_id = %session_id,
            external_task_id = %external_task_id,
            error = %error,
            "failed to persist A2A terminal state"
        );
        return;
    }

    emit_kanban_workspace_event(state, workspace_id, task_id).await;
}

async fn wait_for_a2a_completion(
    client: &reqwest::Client,
    rpc_endpoint: &str,
    task_id: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<A2ATaskTerminalUpdate, String> {
    let started_at = Instant::now();

    loop {
        let terminal = get_a2a_task_update(client, rpc_endpoint, task_id, auth_headers).await?;
        if let Some(terminal) = terminal {
            return Ok(terminal);
        }
        if started_at.elapsed() >= A2A_MAX_WAIT {
            return Err(format!(
                "A2A task {task_id} did not complete within {}ms",
                A2A_MAX_WAIT.as_millis()
            ));
        }
        tokio::time::sleep(A2A_POLL_INTERVAL).await;
    }
}

async fn get_a2a_task_update(
    client: &reqwest::Client,
    rpc_endpoint: &str,
    task_id: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<Option<A2ATaskTerminalUpdate>, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = apply_a2a_auth_headers(
        client
            .post(rpc_endpoint)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "GetTask",
                "params": { "id": task_id }
            })),
        auth_headers,
    )?
    .send()
    .await
    .map_err(|error| format!("Failed to poll A2A task: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "A2A GetTask failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode A2A task payload: {error}"))?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown A2A error");
        return Err(format!("A2A JSON-RPC error: {message}"));
    }

    let task = payload
        .get("result")
        .and_then(|value| value.get("task"))
        .ok_or_else(|| "A2A response missing result.task".to_string())?;
    let state = task
        .get("status")
        .and_then(|value| value.get("state"))
        .and_then(Value::as_str)
        .ok_or_else(|| "A2A task missing status.state".to_string())?;
    if !is_terminal_a2a_state(state) {
        return Ok(None);
    }

    let timestamp = task
        .get("status")
        .and_then(|value| value.get("timestamp"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let context_id = task
        .get("contextId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let error = if state == "completed" {
        None
    } else {
        Some(
            extract_a2a_status_message(task)
                .unwrap_or_else(|| format!("A2A task ended in state: {state}")),
        )
    };

    Ok(Some(A2ATaskTerminalUpdate {
        status: map_a2a_terminal_status(state),
        completed_at: timestamp.clone(),
        last_activity_at: timestamp,
        context_id,
        error,
    }))
}

fn extract_a2a_status_message(task: &Value) -> Option<String> {
    let parts = task
        .get("status")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.get("parts"))
        .and_then(Value::as_array)?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

fn is_terminal_a2a_state(state: &str) -> bool {
    matches!(
        state,
        "completed" | "failed" | "canceled" | "rejected" | "auth-required"
    )
}

fn map_a2a_terminal_status(state: &str) -> TaskLaneSessionStatus {
    match state {
        "completed" => TaskLaneSessionStatus::Completed,
        _ => TaskLaneSessionStatus::Failed,
    }
}

async fn reconcile_a2a_lane_session(
    state: &AppState,
    task_id: &str,
    session_id: &str,
    external_task_id: &str,
    terminal: A2ATaskTerminalUpdate,
) -> Result<(), String> {
    let mut task = wait_for_task_persistence(state, task_id, session_id).await?;
    let lane_session = task
        .lane_sessions
        .iter_mut()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| format!("Task {task_id} missing lane session {session_id}"))?;

    lane_session.status = terminal.status;
    lane_session.completed_at = Some(terminal.completed_at.clone());
    lane_session.last_activity_at = Some(terminal.last_activity_at.clone());
    if lane_session.external_task_id.is_none() {
        lane_session.external_task_id = Some(external_task_id.to_string());
    }
    if terminal.context_id.is_some() {
        lane_session.context_id = terminal.context_id.clone();
    }

    if task.trigger_session_id.as_deref() == Some(session_id) {
        task.trigger_session_id = None;
    }
    task.last_sync_error = terminal.error;
    task.updated_at = Utc::now();

    state
        .task_store
        .save(&task)
        .await
        .map_err(|error| format!("Failed to save A2A task reconciliation: {error}"))
}

async fn wait_for_task_persistence(
    state: &AppState,
    task_id: &str,
    session_id: &str,
) -> Result<Task, String> {
    for _ in 0..20 {
        if let Some(task) = state
            .task_store
            .get(task_id)
            .await
            .map_err(|error| format!("Failed to load task {task_id}: {error}"))?
        {
            if task
                .lane_sessions
                .iter()
                .any(|session| session.session_id == session_id)
            {
                return Ok(task);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Err(format!(
        "Task {task_id} did not persist lane session {session_id} before A2A reconciliation"
    ))
}

async fn emit_kanban_workspace_event(state: &AppState, workspace_id: &str, task_id: &str) {
    state
        .event_bus
        .emit(AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: "kanban-a2a".to_string(),
            workspace_id: workspace_id.to_string(),
            data: serde_json::json!({
                "scope": "kanban",
                "entity": "task",
                "action": "updated",
                "resourceId": task_id,
                "source": "system",
            }),
            timestamp: Utc::now(),
        })
        .await;
}

fn resolve_a2a_auth_headers(
    auth_config_id: Option<&str>,
) -> Result<Option<HashMap<String, String>>, String> {
    let Some(auth_config_id) = auth_config_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let raw = std::env::var(A2A_AUTH_CONFIGS_ENV).unwrap_or_default();
    if raw.trim().is_empty() {
        return Err(format!(
            "A2A auth config \"{auth_config_id}\" was not found in {A2A_AUTH_CONFIGS_ENV}."
        ));
    }

    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid {A2A_AUTH_CONFIGS_ENV} JSON: {error}"))?;
    let config = parsed.get(auth_config_id).ok_or_else(|| {
        format!("A2A auth config \"{auth_config_id}\" was not found in {A2A_AUTH_CONFIGS_ENV}.")
    })?;
    let headers = config.get("headers").unwrap_or(config);
    let headers_obj = headers.as_object().ok_or_else(|| {
        format!(
            "{A2A_AUTH_CONFIGS_ENV}.{auth_config_id} must be a header map or contain a string header map in \"headers\"."
        )
    })?;

    let mut resolved = HashMap::new();
    for (name, value) in headers_obj {
        let value = value.as_str().ok_or_else(|| {
            format!("{A2A_AUTH_CONFIGS_ENV}.{auth_config_id} header {name} must be a string.")
        })?;
        resolved.insert(name.clone(), value.to_string());
    }

    Ok(Some(resolved))
}

fn apply_a2a_auth_headers(
    mut request: reqwest::RequestBuilder,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<reqwest::RequestBuilder, String> {
    if let Some(auth_headers) = auth_headers {
        for (name, value) in auth_headers {
            let header_name = HeaderName::try_from(name.as_str())
                .map_err(|error| format!("Invalid A2A auth header name {name}: {error}"))?;
            let header_value = HeaderValue::from_str(value).map_err(|error| {
                format!(
                    "Invalid A2A auth header value for {}: {}",
                    header_name.as_str(),
                    error
                )
            })?;
            request = request.header(header_name, header_value);
        }
    }

    Ok(request)
}

async fn resolve_a2a_rpc_endpoint(
    client: &reqwest::Client,
    url: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<String, String> {
    if url.ends_with(".json") || url.ends_with("/agent-card") || url.ends_with("/card") {
        let response = apply_a2a_auth_headers(client.get(url), auth_headers)?
            .send()
            .await
            .map_err(|error| format!("Failed to fetch A2A agent card: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "A2A agent card fetch failed with HTTP {}",
                response.status().as_u16()
            ));
        }
        let card: Value = response
            .json()
            .await
            .map_err(|error| format!("Failed to decode A2A agent card: {error}"))?;
        let rpc_url = card
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "A2A agent card missing url".to_string())?;
        absolutize_url(url, rpc_url)
    } else {
        Ok(url.to_string())
    }
}

pub(super) fn absolutize_url(base_url: &str, maybe_relative: &str) -> Result<String, String> {
    if maybe_relative.starts_with("http://") || maybe_relative.starts_with("https://") {
        return Ok(maybe_relative.to_string());
    }

    let base = reqwest::Url::parse(base_url)
        .map_err(|error| format!("Invalid base A2A URL {base_url}: {error}"))?;
    base.join(maybe_relative)
        .map(|url| url.to_string())
        .map_err(|error| format!("Invalid relative A2A URL {maybe_relative}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanColumn};
    use crate::models::task::Task;
    use crate::state::{AppState, AppStateInner};
    use std::sync::Arc;

    use super::super::{apply_trigger_result, AgentTriggerResult};

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

    #[test]
    fn is_a2a_step_detects_transport_and_agent_card_url() {
        let via_transport = KanbanAutomationStep {
            transport: Some(KanbanTransport::A2a),
            ..Default::default()
        };
        let via_card_url = KanbanAutomationStep {
            agent_card_url: Some("https://example.com/.well-known/agent-card.json".to_string()),
            ..Default::default()
        };
        let non_a2a = KanbanAutomationStep::default();

        assert!(is_a2a_step(Some(&via_transport)));
        assert!(is_a2a_step(Some(&via_card_url)));
        assert!(!is_a2a_step(Some(&non_a2a)));
        assert!(!is_a2a_step(None));
    }

    #[test]
    fn absolutize_url_resolves_relative_urls_against_agent_card() {
        let resolved = absolutize_url("https://example.com/.well-known/agent-card.json", "/rpc")
            .expect("relative URLs should resolve");

        assert_eq!(resolved, "https://example.com/rpc");
        assert_eq!(
            absolutize_url(
                "https://example.com/agent-card.json",
                "https://agent.example/rpc"
            )
            .expect("absolute URLs should pass through"),
            "https://agent.example/rpc"
        );
    }

    #[test]
    fn extract_a2a_status_message_compacts_non_empty_parts() {
        let task = json!({
            "status": {
                "message": {
                    "parts": [
                        { "text": "  first part  " },
                        { "text": "" },
                        { "text": "second part" }
                    ]
                }
            }
        });

        assert_eq!(
            extract_a2a_status_message(&task),
            Some("first part second part".to_string())
        );
    }

    #[test]
    fn terminal_state_helpers_keep_auth_required_terminal_and_failed() {
        assert!(is_terminal_a2a_state("auth-required"));
        assert_eq!(
            map_a2a_terminal_status("completed"),
            TaskLaneSessionStatus::Completed
        );
        assert_eq!(
            map_a2a_terminal_status("auth-required"),
            TaskLaneSessionStatus::Failed
        );
        assert_eq!(
            map_a2a_terminal_status("canceled"),
            TaskLaneSessionStatus::Failed
        );
    }

    #[tokio::test]
    async fn reconcile_a2a_lane_session_marks_terminal_state() {
        let state = setup_state().await;
        let mut task = Task::new(
            "task-1".to_string(),
            "A2A completion".to_string(),
            "Track remote completion".to_string(),
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
        task.column_id = Some("todo".to_string());
        task.assigned_role = Some("CRAFTER".to_string());
        task.assigned_specialist_name = Some("Todo Remote Worker".to_string());

        let board = KanbanBoard {
            id: "board-1".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: true,
            github_token: None,
            columns: vec![KanbanColumn {
                id: "todo".to_string(),
                name: "Todo".to_string(),
                color: None,
                position: 1,
                stage: "todo".to_string(),
                automation: None,
                visible: Some(true),
                width: None,
            }],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let step = KanbanAutomationStep {
            id: "todo-a2a".to_string(),
            specialist_name: Some("Todo Remote Worker".to_string()),
            ..Default::default()
        };

        apply_trigger_result(
            &mut task,
            Some(&board),
            Some(&step),
            AgentTriggerResult {
                session_id: "a2a-session-1".to_string(),
                transport: "a2a".to_string(),
                external_task_id: Some("remote-task-1".to_string()),
                context_id: Some("ctx-1".to_string()),
            },
        );
        state
            .task_store
            .save(&task)
            .await
            .expect("task save should succeed");

        reconcile_a2a_lane_session(
            &state,
            &task.id,
            "a2a-session-1",
            "remote-task-1",
            A2ATaskTerminalUpdate {
                status: TaskLaneSessionStatus::Completed,
                completed_at: "2026-03-21T00:00:05Z".to_string(),
                last_activity_at: "2026-03-21T00:00:05Z".to_string(),
                context_id: Some("ctx-1".to_string()),
                error: None,
            },
        )
        .await
        .expect("reconciliation should succeed");

        let updated = state
            .task_store
            .get(&task.id)
            .await
            .expect("task lookup should succeed")
            .expect("task should exist");
        assert_eq!(updated.trigger_session_id, None);
        assert_eq!(updated.last_sync_error, None);
        assert_eq!(updated.lane_sessions.len(), 1);
        let lane_session = &updated.lane_sessions[0];
        assert_eq!(lane_session.status, TaskLaneSessionStatus::Completed);
        assert_eq!(
            lane_session.completed_at.as_deref(),
            Some("2026-03-21T00:00:05Z")
        );
        assert_eq!(lane_session.context_id.as_deref(), Some("ctx-1"));
    }
}
