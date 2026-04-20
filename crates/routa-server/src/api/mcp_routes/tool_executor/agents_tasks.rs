use crate::state::AppState;

use super::{rpc_tool_result, tool_result_error, tool_result_json, tool_result_text};

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
            let mut task = crate::models::task::Task::new(
                uuid::Uuid::new_v4().to_string(),
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
            if let Some(source) = args
                .get("creationSource")
                .and_then(|v| v.as_str())
                .and_then(crate::models::task::TaskCreationSource::from_str)
            {
                task.creation_source = Some(source);
            }
            let task_id = task.id.clone();
            match state.task_store.save(&task).await {
                Ok(_) => tool_result_json(&serde_json::json!({
                    "success": true,
                    "taskId": task_id,
                    "title": title,
                    "creationSource": task.creation_source
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
        "update_task" => {
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let agent_id = args
                .get("agentId")
                .and_then(|v| v.as_str())
                .unwrap_or("system");
            let Some(mut task) = state.task_store.get(task_id).await.ok().flatten() else {
                return Some(tool_result_error(&format!("Task not found: {task_id}")));
            };

            let old_status = task.status.clone();

            if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
                task.title = title.to_string();
            }
            if let Some(objective) = args.get("objective").and_then(|v| v.as_str()) {
                task.objective = objective.to_string();
            }
            if let Some(scope) = args.get("scope").and_then(|v| v.as_str()) {
                task.scope = Some(scope.to_string());
            }
            if let Some(values) = parse_string_array_arg(args, "acceptanceCriteria") {
                task.acceptance_criteria = Some(values);
            }
            if let Some(values) = parse_string_array_arg(args, "verificationCommands") {
                task.verification_commands = Some(values);
            }
            if let Some(values) = parse_string_array_arg(args, "testCases") {
                task.test_cases = Some(values);
            }
            if let Some(status_str) = args.get("status").and_then(|v| v.as_str()) {
                match crate::models::task::TaskStatus::from_str(status_str) {
                    Some(status) => task.status = status,
                    None => {
                        return Some(tool_result_error(&format!("Invalid status: {status_str}")))
                    }
                }
            }
            task.updated_at = chrono::Utc::now();

            match state.task_store.save(&task).await {
                Ok(_) => {
                    if task.status != old_status {
                        let event = crate::events::AgentEvent {
                            event_type: crate::events::AgentEventType::TaskStatusChanged,
                            agent_id: agent_id.to_string(),
                            workspace_id: workspace_id.to_string(),
                            data: serde_json::json!({
                                "taskId": task_id,
                                "oldStatus": old_status.as_str(),
                                "newStatus": task.status.as_str()
                            }),
                            timestamp: chrono::Utc::now(),
                        };
                        state.event_bus.emit(event).await;
                    }

                    tool_result_json(&serde_json::json!({
                        "success": true,
                        "taskId": task_id,
                        "updatedFields": updated_task_fields(args)
                    }))
                }
                Err(e) => tool_result_error(&e.to_string()),
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
        "provide_artifact" => match rpc_tool_result(
            state,
            "tasks.provideArtifact",
            serde_json::json!({
                "taskId": args.get("taskId").and_then(|v| v.as_str()).unwrap_or(""),
                "agentId": args.get("agentId").and_then(|v| v.as_str()).unwrap_or(""),
                "type": args.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                "content": args.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                "context": args.get("context").cloned(),
                "requestId": args.get("requestId").cloned(),
                "metadata": args.get("metadata").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let artifact = result
                    .get("artifact")
                    .and_then(|value| value.as_object())
                    .cloned()
                    .unwrap_or_default();
                tool_result_json(&serde_json::json!({
                    "artifactId": artifact.get("id").cloned().unwrap_or_default(),
                    "type": artifact.get("type").cloned().unwrap_or_default(),
                    "taskId": artifact.get("taskId").cloned().unwrap_or_default(),
                    "status": artifact.get("status").cloned().unwrap_or_default(),
                }))
            }
            Err(error) => tool_result_error(&error),
        },
        "list_artifacts" => match rpc_tool_result(
            state,
            "tasks.listArtifacts",
            serde_json::json!({
                "taskId": args.get("taskId").and_then(|v| v.as_str()).unwrap_or(""),
                "type": args.get("type").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let artifacts = result
                    .get("artifacts")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|artifact| {
                        let content_length = artifact
                            .get("content")
                            .and_then(|value| value.as_str())
                            .map(|value| value.len())
                            .unwrap_or(0);
                        serde_json::json!({
                            "id": artifact.get("id").cloned().unwrap_or_default(),
                            "type": artifact.get("type").cloned().unwrap_or_default(),
                            "taskId": artifact.get("taskId").cloned().unwrap_or_default(),
                            "providedByAgentId": artifact.get("providedByAgentId").cloned().unwrap_or_default(),
                            "status": artifact.get("status").cloned().unwrap_or_default(),
                            "context": artifact.get("context").cloned().unwrap_or_default(),
                            "contentLength": content_length,
                            "createdAt": artifact.get("createdAt").cloned().unwrap_or_default(),
                        })
                    })
                    .collect::<Vec<_>>();
                tool_result_json(&serde_json::json!({ "artifacts": artifacts }))
            }
            Err(error) => tool_result_error(&error),
        },
        _ => return None,
    };

    Some(result)
}

fn parse_string_array_arg(args: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    args.get(key).and_then(|value| {
        value.as_array().map(|values| {
            values
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.to_string()))
                .collect()
        })
    })
}

fn updated_task_fields(args: &serde_json::Value) -> Vec<&'static str> {
    [
        ("title", "title"),
        ("objective", "objective"),
        ("scope", "scope"),
        ("acceptanceCriteria", "acceptanceCriteria"),
        ("verificationCommands", "verificationCommands"),
        ("testCases", "testCases"),
        ("status", "status"),
    ]
    .into_iter()
    .filter_map(|(arg_key, field_name)| args.get(arg_key).map(|_| field_name))
    .collect()
}
