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
            let cwd = args
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
