use serde::{Deserialize, Serialize};

use crate::models::kanban::KanbanColumnAutomation;
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::automation::{
    load_task_board, maybe_apply_lane_automation_defaults, trigger_assigned_task_agent,
};
use super::shared::{default_workspace_id, resolve_board, tasks_for_board};

// ---- kanban.listAutomations ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAutomationsParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnAutomationSummary {
    pub column_id: String,
    pub column_name: String,
    pub stage: String,
    pub position: i64,
    pub card_count: usize,
    pub automation_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAutomationsResult {
    pub board_id: String,
    pub columns: Vec<ColumnAutomationSummary>,
}

pub async fn list_automations(
    state: &AppState,
    params: ListAutomationsParams,
) -> Result<ListAutomationsResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let tasks = tasks_for_board(state, &board).await?;

    let mut columns = board.columns.clone();
    columns.sort_by_key(|column| column.position);
    let columns = columns
        .into_iter()
        .map(|column| {
            let automation_enabled = column.automation.as_ref().is_some_and(|a| a.enabled);
            ColumnAutomationSummary {
                card_count: tasks
                    .iter()
                    .filter(|task| {
                        task.column_id.as_deref().unwrap_or("backlog") == column.id.as_str()
                    })
                    .count(),
                column_id: column.id.clone(),
                column_name: column.name.clone(),
                stage: column.stage.clone(),
                position: column.position,
                automation_enabled,
                automation: column.automation.clone(),
            }
        })
        .collect();

    Ok(ListAutomationsResult {
        board_id: board.id,
        columns,
    })
}

// ---- kanban.triggerAutomation ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerAutomationParams {
    pub card_id: String,
    pub column_id: Option<String>,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerAutomationResult {
    pub card_id: String,
    pub triggered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub async fn trigger_automation(
    state: &AppState,
    params: TriggerAutomationParams,
) -> Result<TriggerAutomationResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;

    let board = load_task_board(state, &task)
        .await
        .map_err(RpcError::Internal)?;

    let selected_column_id = params.column_id.as_deref().or(task.column_id.as_deref());
    let column = board.as_ref().and_then(|value| {
        value
            .columns
            .iter()
            .find(|column| Some(column.id.as_str()) == selected_column_id)
    });

    let automation = column.and_then(|value| value.automation.as_ref());
    if automation.is_none_or(|value| !value.enabled) {
        return Ok(TriggerAutomationResult {
            card_id: params.card_id,
            triggered: false,
            session_id: None,
            error: Some(
                "No enabled automation configured for the selected column. \
                 Enable automation for the column or choose a column with automation enabled."
                    .to_string(),
            ),
            message: None,
        });
    }

    if params.dry_run {
        return Ok(TriggerAutomationResult {
            card_id: params.card_id,
            triggered: false,
            session_id: None,
            error: None,
            message: Some(format!(
                "Dry run: automation for column {} is ready to trigger.",
                column.map(|value| value.id.as_str()).unwrap_or("unknown")
            )),
        });
    }

    if task.trigger_session_id.is_some() && !params.force {
        return Ok(TriggerAutomationResult {
            card_id: params.card_id,
            triggered: false,
            session_id: task.trigger_session_id.clone(),
            error: None,
            message: Some(
                "Automation already has an active trigger session. Re-run with force to start a new one."
                    .to_string(),
            ),
        });
    }

    let original_column_id = task.column_id.clone();
    let uses_column_override = params
        .column_id
        .as_deref()
        .is_some_and(|column_id| Some(column_id) != original_column_id.as_deref());
    if let Some(column_id) = params.column_id.clone() {
        task.column_id = Some(column_id);
    }
    maybe_apply_lane_automation_defaults(&mut task, column);

    let prev_session_id = if params.force {
        task.trigger_session_id.take()
    } else {
        None
    };
    match trigger_assigned_task_agent(state, &mut task).await {
        Ok(()) => {
            task.last_sync_error = None;
        }
        Err(error) => {
            if params.force {
                task.trigger_session_id = prev_session_id;
            }
            if uses_column_override {
                task.column_id = original_column_id;
            }
            task.last_sync_error = Some(error.clone());
            state.task_store.save(&task).await?;
            return Ok(TriggerAutomationResult {
                card_id: params.card_id,
                triggered: false,
                session_id: None,
                error: Some(error),
                message: None,
            });
        }
    }

    let session_id = task.trigger_session_id.clone();
    if uses_column_override {
        task.column_id = original_column_id;
    }
    state.task_store.save(&task).await?;

    Ok(TriggerAutomationResult {
        card_id: params.card_id,
        triggered: true,
        session_id,
        error: None,
        message: uses_column_override.then(|| {
            "Triggered automation using the selected column without moving the card.".to_string()
        }),
    })
}
