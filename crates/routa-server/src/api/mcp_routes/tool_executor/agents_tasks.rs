use crate::state::AppState;

use super::{tool_result_error, tool_result_json, tool_result_text};

pub(super) async fn execute(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
    workspace_id: &str,
) -> Option<serde_json::Value> {
    let result = match name {
        "list_agents" => match state.agent_store.list_by_workspace(workspace_id).await {
            Ok(agents) => {
                tool_result_text(&serde_json::to_string_pretty(&agents).unwrap_or_default())
            }
            Err(e) => tool_result_error(&e.to_string()),
        },
        "create_agent" => {
            let name_val = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unnamed");
            let role_str = args
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("CRAFTER");
            let parent_id = args
                .get("parentId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let role = crate::models::agent::AgentRole::from_str(role_str);
            match role {
                Some(r) => {
                    let agent = crate::models::agent::Agent::new(
                        uuid::Uuid::new_v4().to_string(),
                        name_val.to_string(),
                        r,
                        workspace_id.to_string(),
                        parent_id,
                        None,
                        None,
                    );
                    match state.agent_store.save(&agent).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "agentId": agent.id,
                            "name": agent.name,
                            "role": role_str
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                None => tool_result_error(&format!("Invalid role: {role_str}")),
            }
        }
        "read_agent_conversation" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50) as usize;
            match state.conversation_store.get_last_n(agent_id, limit).await {
                Ok(messages) => {
                    tool_result_text(&serde_json::to_string_pretty(&messages).unwrap_or_default())
                }
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "get_agent_status" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.agent_store.get(agent_id).await {
                Ok(Some(agent)) => {
                    let tasks = state
                        .task_store
                        .list_by_assignee(agent_id)
                        .await
                        .unwrap_or_default();
                    let msg_count = state
                        .conversation_store
                        .get_message_count(agent_id)
                        .await
                        .unwrap_or(0);
                    tool_result_json(&serde_json::json!({
                        "agentId": agent.id,
                        "name": agent.name,
                        "status": agent.status.as_str(),
                        "role": agent.role.as_str(),
                        "messageCount": msg_count,
                        "taskCount": tasks.len(),
                        "tasks": tasks.iter().map(|t| serde_json::json!({
                            "id": t.id,
                            "title": t.title,
                            "status": t.status.as_str()
                        })).collect::<Vec<_>>()
                    }))
                }
                Ok(None) => tool_result_error(&format!("Agent not found: {agent_id}")),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "get_agent_summary" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.agent_store.get(agent_id).await {
                Ok(Some(agent)) => {
                    let messages = state
                        .conversation_store
                        .get_last_n(agent_id, 5)
                        .await
                        .unwrap_or_default();
                    let tasks = state
                        .task_store
                        .list_by_assignee(agent_id)
                        .await
                        .unwrap_or_default();
                    let active_tasks: Vec<_> = tasks
                        .iter()
                        .filter(|t| t.status == crate::models::task::TaskStatus::InProgress)
                        .collect();
                    tool_result_json(&serde_json::json!({
                        "agentId": agent.id,
                        "name": agent.name,
                        "status": agent.status.as_str(),
                        "role": agent.role.as_str(),
                        "activeTasks": active_tasks.len(),
                        "recentMessages": messages.len(),
                        "lastActivity": agent.updated_at
                    }))
                }
                Ok(None) => tool_result_error(&format!("Agent not found: {agent_id}")),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "list_tasks" => match state.task_store.list_by_workspace(workspace_id).await {
            Ok(tasks) => {
                tool_result_text(&serde_json::to_string_pretty(&tasks).unwrap_or_default())
            }
            Err(e) => tool_result_error(&e.to_string()),
        },
        "create_task" => {
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled");
            let objective = args.get("objective").and_then(|v| v.as_str()).unwrap_or("");
            let session_id = args
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let task_id = uuid::Uuid::new_v4().to_string();
            let task = crate::models::task::Task::new(
                task_id.clone(),
                title.to_string(),
                objective.to_string(),
                workspace_id.to_string(),
                session_id,
                args.get("scope")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                None,
                None,
                None,
                None,
                None,
            );
            match state.task_store.save(&task).await {
                Ok(_) => tool_result_json(&serde_json::json!({
                    "success": true,
                    "taskId": task_id,
                    "title": title
                })),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "update_task_status" => {
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let status_str = args.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let reason = args.get("reason").and_then(|v| v.as_str());
            match crate::models::task::TaskStatus::from_str(status_str) {
                Some(status) => match state.task_store.update_status(task_id, &status).await {
                    Ok(_) => {
                        let event = crate::events::AgentEvent {
                            event_type: crate::events::AgentEventType::TaskStatusChanged,
                            agent_id: agent_id.to_string(),
                            workspace_id: workspace_id.to_string(),
                            data: serde_json::json!({
                                "taskId": task_id,
                                "status": status_str,
                                "reason": reason
                            }),
                            timestamp: chrono::Utc::now(),
                        };
                        state.event_bus.emit(event).await;
                        tool_result_json(&serde_json::json!({
                            "success": true,
                            "taskId": task_id,
                            "status": status_str
                        }))
                    }
                    Err(e) => tool_result_error(&e.to_string()),
                },
                None => tool_result_error(&format!("Invalid status: {status_str}")),
            }
        }
        "get_my_task" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.task_store.list_by_assignee(agent_id).await {
                Ok(tasks) => {
                    tool_result_text(&serde_json::to_string_pretty(&tasks).unwrap_or_default())
                }
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        _ => return None,
    };

    Some(result)
}
