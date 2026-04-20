use std::sync::Arc;

use crate::state::AppState;
use routa_core::orchestration::{DelegateWithSpawnParams, OrchestratorConfig, RoutaOrchestrator};

use super::{tool_result_error, tool_result_json};

pub(super) async fn execute(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
    workspace_id: &str,
) -> Option<serde_json::Value> {
    let result = match name {
        "delegate_task_to_agent" => {
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let caller_agent_id = args
                .get("callerAgentId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let specialist = args
                .get("specialist")
                .and_then(|v| v.as_str())
                .unwrap_or("CRAFTER");
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let caller_session_id = args
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let mut cwd = args
                .get("cwd")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let additional_instructions = args
                .get("additionalInstructions")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let wait_mode = args
                .get("waitMode")
                .and_then(|v| v.as_str())
                .map(|mode| match mode.to_lowercase().as_str() {
                    "immediate" => "immediate".to_string(),
                    "fire_and_forget" => "immediate".to_string(),
                    "after_all" => "after_all".to_string(),
                    _ => "after_all".to_string(),
                })
                .unwrap_or_else(|| "after_all".to_string());
            let task_session_id = match state.task_store.get(task_id).await {
                Ok(task_opt) => task_opt.and_then(|task| task.session_id),
                Err(error) => {
                    return Some(tool_result_error(&format!(
                        "Failed to load task for delegation fallback session: {error}"
                    )));
                }
            };

            let mut resolved_caller_session_id = caller_session_id.unwrap_or_default();
            if resolved_caller_session_id.is_empty() {
                if let Some(task_session_id) = task_session_id {
                    if !task_session_id.is_empty() {
                        resolved_caller_session_id = task_session_id;
                    }
                }
            }

            if resolved_caller_session_id.is_empty() {
                match state
                    .acp_session_store
                    .list(Some(workspace_id), Some(100))
                    .await
                {
                    Ok(sessions) => {
                        if let Some(session) = sessions.iter().find(|session| {
                            session.routa_agent_id.as_deref() == Some(caller_agent_id)
                                && !session.id.is_empty()
                        }) {
                            resolved_caller_session_id = session.id.clone();
                        } else if let Some(session) = sessions.iter().find(|session| {
                            session.role.as_deref() == Some("ROUTA") && !session.id.is_empty()
                        }) {
                            resolved_caller_session_id = session.id.clone();
                        }
                    }
                    Err(error) => {
                        tracing::warn!(
                            "[MCP] Failed to resolve caller session from acp_session_store: {}",
                            error
                        );
                    }
                }
            }

            if cwd.is_none() && !resolved_caller_session_id.is_empty() {
                cwd = state
                    .acp_session_store
                    .get(&resolved_caller_session_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|session| session.cwd)
                    .filter(|value| !value.trim().is_empty());
            }
            if cwd.is_none() {
                cwd = resolve_task_or_workspace_cwd(state, task_id, workspace_id).await;
            }

            let orchestrator = RoutaOrchestrator::new(
                OrchestratorConfig::default(),
                Arc::new(state.acp_manager.clone()),
                state.agent_store.clone(),
                state.task_store.clone(),
                state.event_bus.clone(),
            );
            let params = DelegateWithSpawnParams {
                task_id: task_id.to_string(),
                caller_agent_id: caller_agent_id.to_string(),
                caller_session_id: resolved_caller_session_id,
                workspace_id: workspace_id.to_string(),
                specialist: specialist.to_string(),
                provider,
                cwd,
                additional_instructions,
                wait_mode,
            };
            let result = match orchestrator.delegate_task_with_spawn(params).await {
                Ok(tool_result) => tool_result,
                Err(error) => {
                    return Some(tool_result_error(&format!(
                        "Failed to delegate task: {error}"
                    )))
                }
            };

            tool_result_json(&serde_json::to_value(&result).unwrap_or_default())
        }
        "report_to_parent" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let summary = args.get("summary").and_then(|v| v.as_str()).unwrap_or("");
            let success = args
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            let new_status = if success {
                crate::models::task::TaskStatus::Completed
            } else {
                crate::models::task::TaskStatus::NeedsFix
            };

            if let Err(e) = state.task_store.update_status(task_id, &new_status).await {
                return Some(tool_result_error(&format!(
                    "Failed to update task status: {e}"
                )));
            }

            let event = crate::events::AgentEvent {
                event_type: crate::events::AgentEventType::ReportSubmitted,
                agent_id: agent_id.to_string(),
                workspace_id: workspace_id.to_string(),
                data: serde_json::json!({
                    "taskId": task_id,
                    "summary": summary,
                    "success": success
                }),
                timestamp: chrono::Utc::now(),
            };
            state.event_bus.emit(event).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "taskId": task_id,
                "reported": true,
                "taskStatus": new_status.as_str()
            }))
        }
        "send_message_to_agent" => {
            let from_agent_id = args
                .get("fromAgentId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let to_agent_id = args.get("toAgentId").and_then(|v| v.as_str()).unwrap_or("");
            let message = args.get("message").and_then(|v| v.as_str()).unwrap_or("");

            let msg = crate::models::message::Message::new(
                uuid::Uuid::new_v4().to_string(),
                to_agent_id.to_string(),
                crate::models::message::MessageRole::User,
                message.to_string(),
                None,
                None,
                None,
            );

            if let Err(e) = state.conversation_store.append(&msg).await {
                return Some(tool_result_error(&format!("Failed to send message: {e}")));
            }

            let event = crate::events::AgentEvent {
                event_type: crate::events::AgentEventType::MessageSent,
                agent_id: from_agent_id.to_string(),
                workspace_id: workspace_id.to_string(),
                data: serde_json::json!({
                    "fromAgentId": from_agent_id,
                    "toAgentId": to_agent_id,
                    "messageId": msg.id
                }),
                timestamp: chrono::Utc::now(),
            };
            state.event_bus.emit(event).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "messageId": msg.id,
                "fromAgentId": from_agent_id,
                "toAgentId": to_agent_id
            }))
        }
        _ => return None,
    };

    Some(result)
}

async fn resolve_task_or_workspace_cwd(
    state: &AppState,
    task_id: &str,
    workspace_id: &str,
) -> Option<String> {
    if let Ok(Some(task)) = state.task_store.get(task_id).await {
        if let Some(worktree_id) = task.worktree_id.as_deref() {
            if let Ok(Some(worktree)) = state.worktree_store.get(worktree_id).await {
                if !worktree.worktree_path.trim().is_empty() {
                    return Some(worktree.worktree_path);
                }
            }
        }

        for codebase_id in &task.codebase_ids {
            if let Ok(Some(codebase)) = state.codebase_store.get(codebase_id).await {
                if !codebase.repo_path.trim().is_empty() {
                    return Some(codebase.repo_path);
                }
            }
        }
    }

    if let Ok(Some(codebase)) = state.codebase_store.get_default(workspace_id).await {
        if !codebase.repo_path.trim().is_empty() {
            return Some(codebase.repo_path);
        }
    }

    state
        .codebase_store
        .list_by_workspace(workspace_id)
        .await
        .ok()
        .and_then(|codebases| {
            codebases
                .into_iter()
                .find(|codebase| !codebase.repo_path.trim().is_empty())
                .map(|codebase| codebase.repo_path)
        })
}
