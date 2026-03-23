use chrono::Utc;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use routa_core::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanTransport};
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::models::task::{Task, TaskLaneSession, TaskLaneSessionStatus};
use crate::state::AppState;

pub async fn resolve_codebase(
    state: &AppState,
    workspace_id: &str,
    repo_path: Option<&str>,
) -> Result<Option<crate::models::codebase::Codebase>, ServerError> {
    if let Some(path) = repo_path {
        state
            .codebase_store
            .find_by_repo_path(workspace_id, path)
            .await
    } else {
        state.codebase_store.get_default(workspace_id).await
    }
}

pub async fn auto_create_worktree(
    state: &AppState,
    task: &crate::models::task::Task,
    codebase: &crate::models::codebase::Codebase,
) -> Result<String, String> {
    let slugified = task
        .title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let short_id = &task.id[..task.id.len().min(8)];
    let slug = format!("{}-{}", short_id, &slugified[..slugified.len().min(40)]);
    let branch = format!("issue/{}", slug);

    let workspace = state
        .workspace_store
        .get(&task.workspace_id)
        .await
        .ok()
        .flatten();
    let worktree_root = workspace
        .as_ref()
        .and_then(|ws| ws.metadata.get("worktreeRoot"))
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| crate::git::get_default_workspace_worktree_root(&task.workspace_id));

    let codebase_label = codebase
        .label
        .as_ref()
        .map(|l| crate::git::branch_to_safe_dir_name(l))
        .unwrap_or_else(|| crate::git::branch_to_safe_dir_name(&codebase.id));

    let worktree_path = worktree_root
        .join(&codebase_label)
        .join(crate::git::branch_to_safe_dir_name(&slug));

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree parent dir: {}", e))?;
    }

    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let base_branch = codebase
        .branch
        .clone()
        .unwrap_or_else(|| "main".to_string());

    let worktree = crate::models::worktree::Worktree::new(
        uuid::Uuid::new_v4().to_string(),
        codebase.id.clone(),
        task.workspace_id.clone(),
        worktree_path_str.clone(),
        branch.clone(),
        base_branch.clone(),
        Some(slug),
    );
    state
        .worktree_store
        .save(&worktree)
        .await
        .map_err(|e| format!("Failed to save worktree: {}", e))?;

    let _ = crate::git::worktree_prune(&codebase.repo_path);
    crate::git::worktree_add(
        &codebase.repo_path,
        &worktree_path_str,
        &branch,
        &base_branch,
        false,
    )
    .map_err(|e| format!("git worktree add failed: {}", e))?;

    Ok(worktree.id)
}

pub async fn trigger_assigned_task_agent(
    state: &AppState,
    task: &mut Task,
    cwd: Option<&str>,
    branch: Option<&str>,
) -> Result<(), String> {
    let board = load_task_board(state, task).await?;
    let step = resolve_task_automation_step(board.as_ref(), task);
    if is_a2a_step(step.as_ref()) {
        return trigger_assigned_task_a2a_agent(state, task, board.as_ref(), step.as_ref()).await;
    }

    trigger_assigned_task_acp_agent(state, task, board.as_ref(), step.as_ref(), cwd, branch).await
}

fn build_task_prompt(
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
            format!("You are in the `{lane_id}` lane. Keep work scoped to the current card and this lane only."),
        ],
    };
    let mut sections = vec![
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
            task.priority.as_ref().map(|value| value.as_str()).unwrap_or("medium")
        ),
        board_id
            .map(|value| format!("**Board ID:** {}", value))
            .unwrap_or_else(|| "**Board ID:** unavailable".to_string()),
        format!("**Current Lane:** {}", lane_id),
        next_column_id
            .map(|value| format!("**Next Column ID:** {}", value))
            .unwrap_or_else(|| "**Next Column ID:** unavailable".to_string()),
        labels,
        task.github_url
            .as_ref()
            .map(|url| format!("**GitHub Issue:** {}", url))
            .unwrap_or_else(|| "**GitHub Issue:** local-only".to_string()),
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
    ];

    if let Some(test_cases) = task.test_cases.as_ref().filter(|value| !value.is_empty()) {
        sections.push("## Test Cases".to_string());
        sections.push(String::new());
        sections.push(
            test_cases
                .iter()
                .map(|value| format!("- {}", value))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        sections.push(String::new());
    }

    sections.extend([
        "## Available MCP Tools".to_string(),
        String::new(),
        "Use the exact MCP tool names exposed in this session. For OpenCode, the important ones are:".to_string(),
        String::new(),
        format!(
            "- **routa-coordination_update_card**: Update this card's title, description, priority, or labels. Use cardId: \"{}\"",
            task.id
        ),
        format!(
            "- **routa-coordination_move_card**: Move this same card to targetColumnId \"{}\" when the current lane is complete.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        String::new(),
        "## Instructions".to_string(),
        String::new(),
        "1. Start work for the current lane immediately.".to_string(),
        "2. Keep changes focused on this card only.".to_string(),
        "3. Use the exact tool name `routa-coordination_update_card` to record progress on this card.".to_string(),
        format!(
            "4. Use the exact tool name `routa-coordination_move_card` with targetColumnId `{}` only when the current lane is complete.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        "5. Do not guess board ids or column ids. Use the Board ID and Board Columns listed above.".to_string(),
        "6. If blocked, update this same card with the blocking reason instead of exploring side quests.".to_string(),
        "7. Treat lane guidance as stricter than the general card objective when they conflict.".to_string(),
        "8. Do not run browser tests or environment diagnostics unless the card explicitly asks for them.".to_string(),
    ]);

    sections.join("\n")
}

async fn trigger_assigned_task_acp_agent(
    state: &AppState,
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
    cwd: Option<&str>,
    branch: Option<&str>,
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
    let cwd = cwd
        .map(|value| value.to_string())
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
    let task_workspace = task.workspace_id.clone();
    let provider_clone = provider.clone();
    let cwd_clone = cwd.clone();
    let _branch = branch.map(|value| value.to_string());

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
            "kanban auto prompt failed to mark prompt dispatched"
        );
    } else {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id,
            workspace_id = %task.workspace_id,
            provider = %provider,
            "kanban auto prompt marked prompt dispatched"
        );
    }

    tracing::info!(
        target: "routa_kanban_prompt",
        session_id = %session_id_clone,
        workspace_id = %task_workspace,
        provider = %provider_clone,
        cwd = %cwd_clone,
        "kanban auto prompt scheduled"
    );

    tokio::spawn(async move {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %task_workspace,
            provider = %provider_clone,
            cwd = %cwd_clone,
            "kanban auto prompt start"
        );
        if let Err(error) = state_clone
            .acp_manager
            .prompt(&session_id_clone, &prompt)
            .await
        {
            tracing::error!(
                "[kanban] Failed to auto-prompt ACP task session {} in workspace {} with provider {} at {}: {}",
                session_id_clone,
                task_workspace,
                provider_clone,
                cwd_clone,
                error
            );
            return;
        }

        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %task_workspace,
            provider = %provider_clone,
            "kanban auto prompt success"
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
                    workspace_id = %task_workspace,
                    error = %error,
                    "kanban auto prompt failed to persist history"
                );
            } else {
                tracing::info!(
                    target: "routa_kanban_prompt",
                    session_id = %session_id_clone,
                    workspace_id = %task_workspace,
                    history_len = history.len(),
                    "kanban auto prompt persisted history"
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
    _state: &AppState,
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
                    "parts": [
                        { "text": prompt }
                    ]
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

#[derive(Debug)]
struct AgentTriggerResult {
    session_id: String,
    transport: String,
    external_task_id: Option<String>,
    context_id: Option<String>,
}

fn apply_trigger_result(
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
        last_activity_at: Some(Utc::now().to_rfc3339()),
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
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
            .header(ACCEPT, "application/json")
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

fn absolutize_url(base_url: &str, maybe_relative: &str) -> Result<String, String> {
    if maybe_relative.starts_with("http://") || maybe_relative.starts_with("https://") {
        return Ok(maybe_relative.to_string());
    }

    let base = reqwest::Url::parse(base_url)
        .map_err(|error| format!("Invalid base A2A URL {}: {}", base_url, error))?;
    base.join(maybe_relative)
        .map(|url| url.to_string())
        .map_err(|error| format!("Invalid relative A2A URL {}: {}", maybe_relative, error))
}
