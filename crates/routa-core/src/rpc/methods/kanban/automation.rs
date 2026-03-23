use chrono::Utc;
use serde_json::{json, Value};

use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanColumn, KanbanTransport};
use crate::models::task::{Task, TaskLaneSession, TaskLaneSessionStatus};
use crate::rpc::error::RpcError;
use crate::state::AppState;

#[derive(Debug)]
pub(super) struct AgentTriggerResult {
    pub session_id: String,
    pub transport: String,
    pub external_task_id: Option<String>,
    pub context_id: Option<String>,
}

pub(super) async fn ensure_required_artifacts_present(
    state: &AppState,
    task_id: &str,
    target_column: &KanbanColumn,
) -> Result<(), RpcError> {
    let Some(required_artifacts) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_artifacts.as_ref())
    else {
        return Ok(());
    };
    if required_artifacts.is_empty() {
        return Ok(());
    }

    let mut missing_artifacts = Vec::new();
    for artifact_name in required_artifacts {
        let artifact_type = crate::models::artifact::ArtifactType::from_str(artifact_name)
            .ok_or_else(|| {
                RpcError::BadRequest(format!(
                    "Invalid required artifact type configured on column {}: {}",
                    target_column.id, artifact_name
                ))
            })?;
        let artifacts = state
            .artifact_store
            .list_by_task_and_type(task_id, &artifact_type)
            .await?;
        if artifacts.is_empty() {
            missing_artifacts.push(artifact_name.clone());
        }
    }

    if missing_artifacts.is_empty() {
        return Ok(());
    }

    Err(RpcError::BadRequest(format!(
        "Cannot move card to \"{}\": missing required artifacts: {}. Please provide these artifacts before moving the card.",
        target_column.name,
        missing_artifacts.join(", ")
    )))
}

pub(super) fn maybe_apply_lane_automation_defaults(
    task: &mut Task,
    target_column: Option<&KanbanColumn>,
) {
    let Some(automation) = target_column.and_then(|column| column.automation.as_ref()) else {
        return;
    };
    if !automation.enabled {
        return;
    }

    let primary_step = automation.primary_step();
    if task.assigned_provider.is_none() {
        task.assigned_provider = primary_step
            .as_ref()
            .and_then(|step| step.provider_id.clone())
            .or_else(|| automation.provider_id.clone());
    }
    if task.assigned_role.is_none() {
        task.assigned_role = primary_step
            .as_ref()
            .and_then(|step| step.role.clone())
            .or_else(|| automation.role.clone());
    }
    if task.assigned_specialist_id.is_none() {
        task.assigned_specialist_id = primary_step
            .as_ref()
            .and_then(|step| step.specialist_id.clone())
            .or_else(|| automation.specialist_id.clone());
    }
    if task.assigned_specialist_name.is_none() {
        task.assigned_specialist_name = primary_step
            .as_ref()
            .and_then(|step| step.specialist_name.clone())
            .or_else(|| automation.specialist_name.clone());
    }
}

pub(super) fn resolve_transition_automation_column<'a>(
    source_column: Option<&'a KanbanColumn>,
    target_column: Option<&'a KanbanColumn>,
) -> Option<&'a KanbanColumn> {
    let source_transition_type = source_column
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.transition_type.as_deref())
        .unwrap_or("entry");
    if source_column
        .and_then(|column| column.automation.as_ref())
        .is_some_and(|automation| {
            automation.enabled
                && (source_transition_type == "exit" || source_transition_type == "both")
        })
    {
        return source_column;
    }

    let target_transition_type = target_column
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.transition_type.as_deref())
        .unwrap_or("entry");
    if target_column
        .and_then(|column| column.automation.as_ref())
        .is_some_and(|automation| {
            automation.enabled
                && (target_transition_type == "entry" || target_transition_type == "both")
        })
    {
        return target_column;
    }

    None
}

pub(super) async fn maybe_trigger_lane_automation(
    state: &AppState,
    task: &mut Task,
    target_column: Option<&KanbanColumn>,
) {
    let Some(column) = target_column else {
        return;
    };
    let Some(automation) = column.automation.as_ref() else {
        return;
    };
    if !automation.enabled || task.trigger_session_id.is_some() {
        return;
    }

    let transition_type = automation.transition_type.as_deref().unwrap_or("entry");
    if transition_type != "entry" && transition_type != "both" {
        return;
    }

    match trigger_assigned_task_agent(state, task).await {
        Ok(()) => {
            task.last_sync_error = None;
        }
        Err(error) => {
            task.last_sync_error = Some(error);
        }
    }
}

pub(super) fn build_task_prompt(
    task: &Task,
    board_id: Option<&str>,
    next_column_id: Option<&str>,
    available_columns: &str,
) -> String {
    let labels = if task.labels.is_empty() {
        "Labels: none".to_string()
    } else {
        format!("Labels: {}", task.labels.join(", "))
    };
    let lane_id = task.column_id.as_deref().unwrap_or("backlog");
    let lane_guidance = match lane_id {
        "dev" => vec![
            "You are in the `dev` lane. This lane may implement the requested change, but you must keep work scoped to the current card.".to_string(),
            "Use `routa-coordination_update_card` to record concrete progress on this card before or after meaningful implementation steps.".to_string(),
            "When implementation for this lane is complete, use `routa-coordination_move_card` to advance the same card.".to_string(),
        ],
        "todo" => vec![
            "You are in the `todo` lane. This lane does not perform full implementation work.".to_string(),
            "Only clarify the card, update its progress or status, and move the same card forward when the lane is complete.".to_string(),
            "Do not edit files, do not inspect the whole repository, and do not run browser tests or environment diagnostics in this lane.".to_string(),
        ],
        _ => vec![
            format!("You are in the `{lane_id}` lane. Keep work scoped to this card and this lane only."),
        ],
    };

    [
        format!("You are assigned to Kanban task: {}", task.title),
        String::new(),
        "## Context".to_string(),
        String::new(),
        "**IMPORTANT**: You are working in Kanban lane automation for exactly one existing card.".to_string(),
        "Only operate on the current card. Do not create a new task, do not switch to a different card, and do not broaden scope.".to_string(),
        "Use the exact MCP tool names exposed by the provider. In OpenCode, prefer `routa-coordination_update_card` and `routa-coordination_move_card`.".to_string(),
        "Do NOT use `gh issue create`, browser automation, Playwright, repo-wide debugging, API exploration, or unrelated codebase research unless the card objective explicitly requires it.".to_string(),
        String::new(),
        "## Task Details".to_string(),
        String::new(),
        format!("**Card ID:** {}", task.id),
        format!(
            "**Priority:** {}",
            task.priority
                .as_ref()
                .map(|value| value.as_str())
                .unwrap_or("medium")
        ),
        board_id
            .map(|value| format!("**Board ID:** {}", value))
            .unwrap_or_else(|| "**Board ID:** unavailable".to_string()),
        format!("**Current Lane:** {}", lane_id),
        next_column_id
            .map(|value| format!("**Next Column ID:** {}", value))
            .unwrap_or_else(|| "**Next Column ID:** unavailable".to_string()),
        labels,
        String::new(),
        "## Objective".to_string(),
        String::new(),
        task.objective.clone(),
        String::new(),
        "## Board Columns".to_string(),
        String::new(),
        available_columns.to_string(),
        String::new(),
        "## Lane Guidance".to_string(),
        String::new(),
        lane_guidance.join("\n"),
        String::new(),
        "## Allowed Actions".to_string(),
        String::new(),
        format!(
            "1. Update progress on this card with `routa-coordination_update_card` for card `{}`.",
            task.id
        ),
        format!(
            "2. When the current lane is complete, advance the same card with `routa-coordination_move_card` to column `{}`.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        "3. If you are blocked, update this same card with the blocking reason instead of exploring side quests.".to_string(),
        String::new(),
        "## Instructions".to_string(),
        String::new(),
        "1. Start work for this lane immediately.".to_string(),
        "2. Keep work scoped to this card only.".to_string(),
        "3. Record progress with the exact tool name `routa-coordination_update_card`.".to_string(),
        format!(
            "4. Move the same card forward with the exact tool name `routa-coordination_move_card` and targetColumnId `{}` when this lane is complete.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        "5. Do not guess board ids or column ids. Use the Board ID and Board Columns listed above.".to_string(),
        "6. Treat lane guidance as stricter than the general card objective when they conflict.".to_string(),
        "7. Do not run browser tests or environment diagnostics unless the card explicitly asks for them.".to_string(),
    ]
    .join("\n")
}

async fn trigger_assigned_task_agent(state: &AppState, task: &mut Task) -> Result<(), String> {
    let board = load_task_board(state, task).await?;
    let step = resolve_task_automation_step(board.as_ref(), task);
    if is_a2a_step(step.as_ref()) {
        return trigger_assigned_task_a2a_agent(task, board.as_ref(), step.as_ref()).await;
    }

    trigger_assigned_task_acp_agent(state, task, board.as_ref(), step.as_ref()).await
}

async fn trigger_assigned_task_acp_agent(
    state: &AppState,
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
) -> Result<(), String> {
    let provider = task
        .assigned_provider
        .clone()
        .unwrap_or_else(|| "opencode".to_string());
    let role = task
        .assigned_role
        .clone()
        .unwrap_or_else(|| "CRAFTER".to_string())
        .to_uppercase();
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = state
        .codebase_store
        .get_default(&task.workspace_id)
        .await
        .map_err(|error| format!("Failed to resolve default codebase: {}", error))?
        .map(|codebase| codebase.repo_path)
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| ".".to_string());

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            task.workspace_id.clone(),
            Some(provider.clone()),
            Some(role.clone()),
            None,
            None,
            Some("full".to_string()),
            Some("kanban-planning".to_string()),
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    state
        .acp_session_store
        .create(
            &session_id,
            &cwd,
            None,
            &task.workspace_id,
            Some(provider.as_str()),
            Some(role.as_str()),
            None,
        )
        .await
        .map_err(|error| format!("Failed to persist ACP session: {}", error))?;

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
    );
    let state_clone = state.clone();
    let session_id_clone = session_id.clone();
    let workspace_id = task.workspace_id.clone();
    let provider_clone = provider.clone();
    let cwd_clone = cwd.clone();
    if let Err(error) = state
        .acp_session_store
        .set_first_prompt_sent(&session_id)
        .await
    {
        tracing::error!(
            target: "routa_kanban_prompt",
            session_id = %session_id,
            workspace_id = %task.workspace_id,
            error = %error,
            "kanban lane prompt failed to mark prompt dispatched"
        );
    } else {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id,
            workspace_id = %task.workspace_id,
            provider = %provider,
            "kanban lane prompt marked prompt dispatched"
        );
    }
    tracing::info!(
        target: "routa_kanban_prompt",
        session_id = %session_id_clone,
        workspace_id = %workspace_id,
        provider = %provider_clone,
        cwd = %cwd_clone,
        "kanban lane prompt scheduled"
    );
    tokio::spawn(async move {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %workspace_id,
            provider = %provider_clone,
            cwd = %cwd_clone,
            "kanban lane prompt start"
        );
        if let Err(error) = state_clone
            .acp_manager
            .prompt(&session_id_clone, &prompt)
            .await
        {
            tracing::error!(
                target: "routa_kanban_prompt",
                session_id = %session_id_clone,
                workspace_id = %workspace_id,
                provider = %provider_clone,
                error = %error,
                "kanban lane prompt failed"
            );
            return;
        }

        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %workspace_id,
            provider = %provider_clone,
            "kanban lane prompt success"
        );

        if let Some(history) = state_clone
            .acp_manager
            .get_session_history(&session_id_clone)
            .await
        {
            if let Err(error) = state_clone
                .acp_session_store
                .save_history(&session_id_clone, &history)
                .await
            {
                tracing::error!(
                    target: "routa_kanban_prompt",
                    session_id = %session_id_clone,
                    workspace_id = %workspace_id,
                    error = %error,
                    "kanban lane prompt failed to persist history"
                );
            } else {
                tracing::info!(
                    target: "routa_kanban_prompt",
                    session_id = %session_id_clone,
                    workspace_id = %workspace_id,
                    history_len = history.len(),
                    "kanban lane prompt persisted history"
                );
            }
        }
    });

    apply_trigger_result(
        task,
        board,
        step,
        AgentTriggerResult {
            session_id,
            transport: "acp".to_string(),
            external_task_id: None,
            context_id: None,
        },
    );

    Ok(())
}

async fn trigger_assigned_task_a2a_agent(
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
) -> Result<(), String> {
    let step = step.ok_or_else(|| "A2A automation requires a resolved column step".to_string())?;
    let agent_card_url = step
        .agent_card_url
        .as_deref()
        .ok_or_else(|| "A2A automation requires agentCardUrl".to_string())?;

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
    );

    let client = reqwest::Client::new();
    let rpc_endpoint = resolve_a2a_rpc_endpoint(&client, agent_card_url).await?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let response = client
        .post(&rpc_endpoint)
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
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to send A2A request: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "A2A request failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode A2A response: {}", error))?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown A2A error");
        return Err(format!("A2A JSON-RPC error: {}", message));
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
            session_id,
            transport: "a2a".to_string(),
            external_task_id: Some(external_task_id),
            context_id,
        },
    );

    Ok(())
}

pub(super) fn apply_trigger_result(
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
    result: AgentTriggerResult,
) {
    task.trigger_session_id = Some(result.session_id.clone());
    if !task.session_ids.iter().any(|id| id == &result.session_id) {
        task.session_ids.push(result.session_id.clone());
    }

    let column_name = board.and_then(|value| {
        value.columns.iter().find_map(|column| {
            (Some(column.id.as_str()) == task.column_id.as_deref()).then(|| column.name.clone())
        })
    });
    let now = Utc::now().to_rfc3339();
    let lane_session = TaskLaneSession {
        session_id: result.session_id.clone(),
        routa_agent_id: None,
        column_id: task.column_id.clone(),
        column_name,
        step_id: step.map(|value| value.id.clone()),
        step_index: None,
        step_name: step
            .and_then(|value| value.specialist_name.clone())
            .or_else(|| task.assigned_specialist_name.clone()),
        provider: task.assigned_provider.clone(),
        role: task.assigned_role.clone(),
        specialist_id: task.assigned_specialist_id.clone(),
        specialist_name: task.assigned_specialist_name.clone(),
        transport: Some(result.transport),
        external_task_id: result.external_task_id,
        context_id: result.context_id,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: Some(now.clone()),
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: now,
        completed_at: None,
    };

    if let Some(existing) = task
        .lane_sessions
        .iter_mut()
        .find(|existing| existing.session_id == result.session_id)
    {
        *existing = lane_session;
    } else {
        task.lane_sessions.push(lane_session);
    }
}

async fn load_task_board(state: &AppState, task: &Task) -> Result<Option<KanbanBoard>, String> {
    if let Some(board_id) = task.board_id.as_deref() {
        state
            .kanban_store
            .get(board_id)
            .await
            .map_err(|error| format!("Failed to load Kanban board for automation: {}", error))
    } else {
        Ok(None)
    }
}

fn resolve_task_automation_step(
    board: Option<&KanbanBoard>,
    task: &Task,
) -> Option<KanbanAutomationStep> {
    board
        .and_then(|value| {
            value
                .columns
                .iter()
                .find(|column| Some(column.id.as_str()) == task.column_id.as_deref())
        })
        .and_then(|column| column.automation.as_ref())
        .filter(|automation| automation.enabled)
        .and_then(|automation| automation.primary_step())
}

fn is_a2a_step(step: Option<&KanbanAutomationStep>) -> bool {
    step.is_some_and(|value| {
        matches!(value.transport, Some(KanbanTransport::A2a)) || value.agent_card_url.is_some()
    })
}

async fn resolve_a2a_rpc_endpoint(client: &reqwest::Client, url: &str) -> Result<String, String> {
    if url.ends_with(".json") || url.ends_with("/agent-card") || url.ends_with("/card") {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Failed to fetch A2A agent card: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "A2A agent card fetch failed with HTTP {}",
                response.status().as_u16()
            ));
        }
        let card: Value = response
            .json()
            .await
            .map_err(|error| format!("Failed to decode A2A agent card: {}", error))?;
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
        .map_err(|error| format!("Invalid base A2A URL {}: {}", base_url, error))?;
    base.join(maybe_relative)
        .map(|url| url.to_string())
        .map_err(|error| format!("Invalid relative A2A URL {}: {}", maybe_relative, error))
}
