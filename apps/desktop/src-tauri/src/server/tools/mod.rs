//! AgentTools - Core coordination tools for multi-agent collaboration.
//!
//! Port of the TypeScript AgentTools from src/core/tools/agent-tools.ts
//!
//! Provides coordination tools:
//!   1. listAgents        - List agents in a workspace
//!   2. readAgentConversation - Read another agent's conversation
//!   3. createAgent       - Create ROUTA/CRAFTER/GATE agents
//!   4. delegate          - Assign task to agent
//!   5. messageAgent      - Inter-agent messaging
//!   6. reportToParent    - Completion report to parent
//!   7. createTask        - Create a new task
//!   8. getTask           - Get task by ID
//!   9. listTasks         - List tasks in workspace
//!  10. updateTaskStatus  - Update task status
//!  11. subscribeToEvents - Subscribe to workspace events
//!  12. unsubscribeFromEvents - Unsubscribe

use serde::{Deserialize, Serialize};

use crate::server::error::ServerError;
use crate::server::events::{AgentEvent, AgentEventType, EventBus, EventSubscription};
use crate::server::models::agent::{Agent, AgentRole, AgentStatus, ModelTier};
use crate::server::models::message::{Message, MessageRole};
use crate::server::models::task::{Task, TaskStatus};
use crate::server::store::{AgentStore, ConversationStore, TaskStore};

/// Result of a tool operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResult {
    pub fn success(data: impl Serialize) -> Self {
        Self {
            success: true,
            data: Some(serde_json::to_value(data).unwrap_or_default()),
            error: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

/// Completion report from a child agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionReport {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub summary: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_modified: Option<Vec<String>>,
}

/// AgentTools provides coordination tools for multi-agent collaboration.
pub struct AgentTools {
    agent_store: AgentStore,
    conversation_store: ConversationStore,
    task_store: TaskStore,
    event_bus: EventBus,
}

impl AgentTools {
    pub fn new(
        agent_store: AgentStore,
        conversation_store: ConversationStore,
        task_store: TaskStore,
        event_bus: EventBus,
    ) -> Self {
        Self {
            agent_store,
            conversation_store,
            task_store,
            event_bus,
        }
    }

    // ─── Tool 1: List Agents ─────────────────────────────────────────────

    pub async fn list_agents(&self, workspace_id: &str) -> Result<ToolResult, ServerError> {
        let agents = self.agent_store.list_by_workspace(workspace_id).await?;
        let summary: Vec<serde_json::Value> = agents
            .iter()
            .map(|a| {
                serde_json::json!({
                    "id": a.id,
                    "name": a.name,
                    "role": a.role,
                    "status": a.status,
                    "parentId": a.parent_id,
                })
            })
            .collect();
        Ok(ToolResult::success(summary))
    }

    // ─── Tool 2: Read Agent Conversation ─────────────────────────────────

    pub async fn read_agent_conversation(
        &self,
        agent_id: &str,
        last_n: Option<usize>,
        start_turn: Option<i32>,
        end_turn: Option<i32>,
        include_tool_calls: bool,
    ) -> Result<ToolResult, ServerError> {
        let agent = self.agent_store.get(agent_id).await?;
        let agent = match agent {
            Some(a) => a,
            None => return Ok(ToolResult::error(format!("Agent not found: {}", agent_id))),
        };

        let mut messages = if let Some(n) = last_n {
            self.conversation_store.get_last_n(agent_id, n).await?
        } else if let (Some(start), Some(end)) = (start_turn, end_turn) {
            self.conversation_store
                .get_by_turn_range(agent_id, start, end)
                .await?
        } else {
            self.conversation_store.get_conversation(agent_id).await?
        };

        if !include_tool_calls {
            messages.retain(|m| m.role != MessageRole::Tool);
        }

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent_id,
            "agentName": agent.name,
            "messageCount": messages.len(),
            "messages": messages.iter().map(|m| serde_json::json!({
                "role": m.role,
                "content": m.content,
                "turn": m.turn,
                "toolName": m.tool_name,
                "timestamp": m.timestamp.to_rfc3339(),
            })).collect::<Vec<_>>(),
        })))
    }

    // ─── Tool 3: Create Agent ────────────────────────────────────────────

    pub async fn create_agent(
        &self,
        name: &str,
        role: &str,
        workspace_id: &str,
        parent_id: Option<&str>,
        model_tier: Option<&str>,
    ) -> Result<ToolResult, ServerError> {
        let role = match AgentRole::from_str(role) {
            Some(r) => r,
            None => {
                return Ok(ToolResult::error(format!(
                    "Invalid role: {}. Must be one of: ROUTA, CRAFTER, GATE, DEVELOPER",
                    role
                )))
            }
        };

        let model_tier = model_tier
            .and_then(ModelTier::from_str)
            .unwrap_or(ModelTier::Smart);

        let agent = Agent::new(
            uuid::Uuid::new_v4().to_string(),
            name.to_string(),
            role.clone(),
            workspace_id.to_string(),
            parent_id.map(|s| s.to_string()),
            Some(model_tier),
            None,
        );

        self.agent_store.save(&agent).await?;

        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::AgentCreated,
                agent_id: agent.id.clone(),
                workspace_id: workspace_id.to_string(),
                data: serde_json::json!({ "name": agent.name, "role": agent.role }),
                timestamp: chrono::Utc::now(),
            })
            .await;

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent.id,
            "name": agent.name,
            "role": agent.role,
            "status": agent.status,
        })))
    }

    // ─── Tool 4: Delegate Task ──────────────────────────────────────────

    pub async fn delegate(
        &self,
        agent_id: &str,
        task_id: &str,
        caller_agent_id: &str,
    ) -> Result<ToolResult, ServerError> {
        let agent = match self.agent_store.get(agent_id).await? {
            Some(a) => a,
            None => return Ok(ToolResult::error(format!("Agent not found: {}", agent_id))),
        };

        let mut task = match self.task_store.get(task_id).await? {
            Some(t) => t,
            None => return Ok(ToolResult::error(format!("Task not found: {}", task_id))),
        };

        // Assign and activate
        task.assigned_to = Some(agent_id.to_string());
        task.status = TaskStatus::InProgress;
        task.updated_at = chrono::Utc::now();
        self.task_store.save(&task).await?;

        self.agent_store
            .update_status(agent_id, &AgentStatus::Active)
            .await?;

        // Record delegation as a conversation message
        let message = Message::new(
            uuid::Uuid::new_v4().to_string(),
            agent_id.to_string(),
            MessageRole::User,
            format!(
                "Task delegated: {}\nObjective: {}",
                task.title, task.objective
            ),
            None,
            None,
            None,
        );
        self.conversation_store.append(&message).await?;

        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::TaskAssigned,
                agent_id: agent_id.to_string(),
                workspace_id: agent.workspace_id.clone(),
                data: serde_json::json!({
                    "taskId": task_id,
                    "callerAgentId": caller_agent_id,
                    "taskTitle": task.title,
                }),
                timestamp: chrono::Utc::now(),
            })
            .await;

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent_id,
            "taskId": task_id,
            "status": "delegated",
        })))
    }

    // ─── Tool 5: Message Agent ──────────────────────────────────────────

    pub async fn message_agent(
        &self,
        from_agent_id: &str,
        to_agent_id: &str,
        message: &str,
    ) -> Result<ToolResult, ServerError> {
        let to_agent = match self.agent_store.get(to_agent_id).await? {
            Some(a) => a,
            None => {
                return Ok(ToolResult::error(format!(
                    "Target agent not found: {}",
                    to_agent_id
                )))
            }
        };

        let msg = Message::new(
            uuid::Uuid::new_v4().to_string(),
            to_agent_id.to_string(),
            MessageRole::User,
            format!("[From agent {}]: {}", from_agent_id, message),
            None,
            None,
            None,
        );
        self.conversation_store.append(&msg).await?;

        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::MessageSent,
                agent_id: from_agent_id.to_string(),
                workspace_id: to_agent.workspace_id.clone(),
                data: serde_json::json!({
                    "fromAgentId": from_agent_id,
                    "toAgentId": to_agent_id,
                    "messagePreview": &message[..message.len().min(200)],
                }),
                timestamp: chrono::Utc::now(),
            })
            .await;

        Ok(ToolResult::success(serde_json::json!({
            "delivered": true,
            "toAgentId": to_agent_id,
            "fromAgentId": from_agent_id,
        })))
    }

    // ─── Tool 6: Report to Parent ───────────────────────────────────────

    pub async fn report_to_parent(
        &self,
        agent_id: &str,
        report: CompletionReport,
    ) -> Result<ToolResult, ServerError> {
        let agent = match self.agent_store.get(agent_id).await? {
            Some(a) => a,
            None => return Ok(ToolResult::error(format!("Agent not found: {}", agent_id))),
        };

        let parent_id = match &agent.parent_id {
            Some(p) => p.clone(),
            None => {
                return Ok(ToolResult::error(format!(
                    "Agent {} has no parent to report to",
                    agent_id
                )))
            }
        };

        // Update task status
        if let Some(task_id) = &report.task_id {
            if let Some(mut task) = self.task_store.get(task_id).await? {
                task.status = if report.success {
                    TaskStatus::Completed
                } else {
                    TaskStatus::NeedsFix
                };
                task.completion_summary = Some(report.summary.clone());
                task.updated_at = chrono::Utc::now();
                self.task_store.save(&task).await?;
            }
        }

        // Mark agent completed
        self.agent_store
            .update_status(agent_id, &AgentStatus::Completed)
            .await?;

        // Deliver report as message to parent
        let content = format!(
            "[Completion Report from {} ({})]\nTask: {:?}\nSuccess: {}\nSummary: {}\n{}",
            agent.name,
            agent_id,
            report.task_id,
            report.success,
            report.summary,
            report
                .files_modified
                .as_ref()
                .map(|f| format!("Files Modified: {}", f.join(", ")))
                .unwrap_or_default()
        );

        let msg = Message::new(
            uuid::Uuid::new_v4().to_string(),
            parent_id.clone(),
            MessageRole::User,
            content,
            None,
            None,
            None,
        );
        self.conversation_store.append(&msg).await?;

        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::ReportSubmitted,
                agent_id: agent_id.to_string(),
                workspace_id: agent.workspace_id.clone(),
                data: serde_json::json!({
                    "parentId": parent_id,
                    "taskId": report.task_id,
                    "success": report.success,
                }),
                timestamp: chrono::Utc::now(),
            })
            .await;

        Ok(ToolResult::success(serde_json::json!({
            "reported": true,
            "parentId": parent_id,
            "success": report.success,
        })))
    }

    // ─── Tool 7: Create Task ────────────────────────────────────────────

    pub async fn create_task(
        &self,
        title: &str,
        objective: &str,
        workspace_id: &str,
        scope: Option<&str>,
        acceptance_criteria: Option<Vec<String>>,
        verification_commands: Option<Vec<String>>,
        dependencies: Option<Vec<String>>,
        parallel_group: Option<&str>,
    ) -> Result<ToolResult, ServerError> {
        let task = Task::new(
            uuid::Uuid::new_v4().to_string(),
            title.to_string(),
            objective.to_string(),
            workspace_id.to_string(),
            scope.map(|s| s.to_string()),
            acceptance_criteria,
            verification_commands,
            dependencies,
            parallel_group.map(|s| s.to_string()),
        );

        self.task_store.save(&task).await?;

        Ok(ToolResult::success(serde_json::json!({
            "taskId": task.id,
            "title": task.title,
            "status": task.status,
        })))
    }

    // ─── Tool 8: Get Task ─────────────────────────────────────────────────

    pub async fn get_task(&self, task_id: &str) -> Result<ToolResult, ServerError> {
        match self.task_store.get(task_id).await? {
            Some(task) => Ok(ToolResult::success(task)),
            None => Ok(ToolResult::error(format!("Task not found: {}", task_id))),
        }
    }

    // ─── Tool 9: List Tasks ───────────────────────────────────────────────

    pub async fn list_tasks(&self, workspace_id: &str) -> Result<ToolResult, ServerError> {
        let tasks = self.task_store.list_by_workspace(workspace_id).await?;
        let summary: Vec<serde_json::Value> = tasks
            .iter()
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "assignedTo": t.assigned_to,
                    "verificationVerdict": t.verification_verdict,
                })
            })
            .collect();
        Ok(ToolResult::success(summary))
    }

    // ─── Tool 10: Update Task Status ────────────────────────────────────

    pub async fn update_task_status(
        &self,
        task_id: &str,
        status: &str,
        agent_id: &str,
        summary: Option<&str>,
    ) -> Result<ToolResult, ServerError> {
        let new_status = match TaskStatus::from_str(status) {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(format!(
                    "Invalid status: {}. Must be one of: PENDING, IN_PROGRESS, REVIEW_REQUIRED, COMPLETED, NEEDS_FIX, BLOCKED, CANCELLED",
                    status
                )))
            }
        };

        let mut task = match self.task_store.get(task_id).await? {
            Some(t) => t,
            None => return Ok(ToolResult::error(format!("Task not found: {}", task_id))),
        };

        let old_status = task.status.clone();
        task.status = new_status.clone();
        if let Some(s) = summary {
            task.completion_summary = Some(s.to_string());
        }
        task.updated_at = chrono::Utc::now();
        self.task_store.save(&task).await?;

        // Emit status change event
        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::TaskStatusChanged,
                agent_id: agent_id.to_string(),
                workspace_id: task.workspace_id.clone(),
                data: serde_json::json!({
                    "taskId": task_id,
                    "oldStatus": old_status,
                    "newStatus": new_status,
                    "summary": summary,
                }),
                timestamp: chrono::Utc::now(),
            })
            .await;

        // Also emit TASK_COMPLETED if applicable
        if new_status == TaskStatus::Completed {
            self.event_bus
                .emit(AgentEvent {
                    event_type: AgentEventType::TaskCompleted,
                    agent_id: agent_id.to_string(),
                    workspace_id: task.workspace_id.clone(),
                    data: serde_json::json!({
                        "taskId": task_id,
                        "taskTitle": task.title,
                        "summary": summary,
                    }),
                    timestamp: chrono::Utc::now(),
                })
                .await;
        }

        Ok(ToolResult::success(serde_json::json!({
            "taskId": task_id,
            "oldStatus": old_status,
            "newStatus": new_status,
            "updatedAt": task.updated_at.to_rfc3339(),
        })))
    }

    // ─── Tool 11: Subscribe to Events ───────────────────────────────────

    pub async fn subscribe_to_events(
        &self,
        agent_id: &str,
        agent_name: &str,
        event_types: Vec<String>,
        exclude_self: bool,
        one_shot: bool,
        wait_group_id: Option<String>,
        priority: i32,
    ) -> Result<ToolResult, ServerError> {
        let valid_types: Vec<AgentEventType> = event_types
            .iter()
            .filter_map(|t| AgentEventType::from_str(t))
            .collect();

        if valid_types.is_empty() {
            return Ok(ToolResult::error(format!(
                "No valid event types. Available: {}",
                EventBus::all_event_types().join(", ")
            )));
        }

        let subscription_id = uuid::Uuid::new_v4().to_string();
        self.event_bus
            .subscribe(EventSubscription {
                id: subscription_id.clone(),
                agent_id: agent_id.to_string(),
                agent_name: agent_name.to_string(),
                event_types: valid_types.clone(),
                exclude_self,
                one_shot,
                wait_group_id: wait_group_id.clone(),
                priority,
            })
            .await;

        Ok(ToolResult::success(serde_json::json!({
            "subscriptionId": subscription_id,
            "eventTypes": valid_types,
            "oneShot": one_shot,
            "waitGroupId": wait_group_id,
            "priority": priority,
        })))
    }

    // ─── Tool 12: Unsubscribe from Events ──────────────────────────────

    pub async fn unsubscribe_from_events(
        &self,
        subscription_id: &str,
    ) -> Result<ToolResult, ServerError> {
        let removed = self.event_bus.unsubscribe(subscription_id).await;
        Ok(ToolResult::success(serde_json::json!({
            "unsubscribed": removed,
            "subscriptionId": subscription_id,
        })))
    }

    // ─── Internal: Drain Pending Events ─────────────────────────────────

    pub async fn drain_pending_events(&self, agent_id: &str) -> Result<ToolResult, ServerError> {
        let events = self.event_bus.drain_pending_events(agent_id).await;
        let event_data: Vec<serde_json::Value> = events
            .iter()
            .map(|e| {
                serde_json::json!({
                    "type": e.event_type,
                    "agentId": e.agent_id,
                    "data": e.data,
                    "timestamp": e.timestamp.to_rfc3339(),
                })
            })
            .collect();
        Ok(ToolResult::success(serde_json::json!({ "events": event_data })))
    }

    // ─── Tool: Get Agent Status ───────────────────────────────────────

    pub async fn get_agent_status(&self, agent_id: &str) -> Result<ToolResult, ServerError> {
        let agent = match self.agent_store.get(agent_id).await? {
            Some(a) => a,
            None => return Ok(ToolResult::error(format!("Agent not found: {}", agent_id))),
        };

        let message_count = self.conversation_store.get_message_count(agent_id).await?;
        let tasks = self.task_store.list_by_assignee(agent_id).await?;

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent.id,
            "name": agent.name,
            "role": agent.role,
            "status": agent.status,
            "modelTier": agent.model_tier,
            "parentId": agent.parent_id,
            "messageCount": message_count,
            "tasks": tasks.iter().map(|t| serde_json::json!({
                "id": t.id,
                "title": t.title,
                "status": t.status,
            })).collect::<Vec<_>>(),
        })))
    }

    // ─── Tool: Get Agent Summary ─────────────────────────────────────

    pub async fn get_agent_summary(&self, agent_id: &str) -> Result<ToolResult, ServerError> {
        let agent = match self.agent_store.get(agent_id).await? {
            Some(a) => a,
            None => return Ok(ToolResult::error(format!("Agent not found: {}", agent_id))),
        };

        let message_count = self.conversation_store.get_message_count(agent_id).await?;
        let last_messages = self.conversation_store.get_last_n(agent_id, 3).await?;
        let tasks = self.task_store.list_by_assignee(agent_id).await?;

        let last_response = last_messages
            .iter()
            .filter(|m| m.role == MessageRole::Assistant)
            .last();

        let all_messages = self.conversation_store.get_conversation(agent_id).await?;
        let tool_call_count = all_messages
            .iter()
            .filter(|m| m.role == MessageRole::Tool)
            .count();

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent.id,
            "name": agent.name,
            "role": agent.role,
            "status": agent.status,
            "messageCount": message_count,
            "toolCallCount": tool_call_count,
            "lastResponse": last_response.map(|m| serde_json::json!({
                "content": &m.content[..m.content.len().min(500)],
                "timestamp": m.timestamp.to_rfc3339(),
            })),
            "activeTasks": tasks.iter()
                .filter(|t| t.status == TaskStatus::InProgress)
                .map(|t| serde_json::json!({ "id": t.id, "title": t.title }))
                .collect::<Vec<_>>(),
        })))
    }
}

