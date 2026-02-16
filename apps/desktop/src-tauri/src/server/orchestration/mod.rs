//! RoutaOrchestrator - Task orchestration and child agent spawning.
//!
//! Port of the TypeScript RoutaOrchestrator from src/core/orchestration/orchestrator.ts
//!
//! The orchestrator bridges MCP tool calls with actual ACP process spawning:
//!   1. Creates a child agent record
//!   2. Spawns a real ACP process for the child agent
//!   3. Sends the task as the initial prompt
//!   4. Subscribes for completion events
//!   5. When the child reports back, wakes the parent agent

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::server::acp::AcpManager;
use crate::server::error::ServerError;
use crate::server::events::{AgentEvent, AgentEventType, EventBus};
use crate::server::models::agent::{AgentRole, AgentStatus, ModelTier};
use crate::server::models::task::TaskStatus;
use crate::server::store::{AgentStore, TaskStore};
use crate::server::tools::{CompletionReport, ToolResult};

// ─── Specialist Configuration ─────────────────────────────────────────────

/// Specialist configuration for agent roles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialistConfig {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub role: AgentRole,
    pub default_model_tier: ModelTier,
    pub system_prompt: String,
    pub role_reminder: String,
}

impl SpecialistConfig {
    /// Get the CRAFTER specialist config.
    pub fn crafter() -> Self {
        Self {
            id: "crafter".to_string(),
            name: "Implementor".to_string(),
            description: Some("Executes implementation tasks, writes code".to_string()),
            role: AgentRole::Crafter,
            default_model_tier: ModelTier::Fast,
            system_prompt: CRAFTER_SYSTEM_PROMPT.to_string(),
            role_reminder: CRAFTER_ROLE_REMINDER.to_string(),
        }
    }

    /// Get the GATE specialist config.
    pub fn gate() -> Self {
        Self {
            id: "gate".to_string(),
            name: "Verifier".to_string(),
            description: Some("Reviews work and verifies completeness".to_string()),
            role: AgentRole::Gate,
            default_model_tier: ModelTier::Smart,
            system_prompt: GATE_SYSTEM_PROMPT.to_string(),
            role_reminder: GATE_ROLE_REMINDER.to_string(),
        }
    }

    /// Get the DEVELOPER specialist config.
    pub fn developer() -> Self {
        Self {
            id: "developer".to_string(),
            name: "Developer".to_string(),
            description: Some("Plans then implements itself".to_string()),
            role: AgentRole::Developer,
            default_model_tier: ModelTier::Smart,
            system_prompt: DEVELOPER_SYSTEM_PROMPT.to_string(),
            role_reminder: DEVELOPER_ROLE_REMINDER.to_string(),
        }
    }

    /// Get specialist by role.
    pub fn by_role(role: &AgentRole) -> Option<Self> {
        match role {
            AgentRole::Crafter => Some(Self::crafter()),
            AgentRole::Gate => Some(Self::gate()),
            AgentRole::Developer => Some(Self::developer()),
            AgentRole::Routa => None, // Coordinator doesn't delegate to itself
        }
    }

    /// Get specialist by ID.
    pub fn by_id(id: &str) -> Option<Self> {
        match id.to_lowercase().as_str() {
            "crafter" => Some(Self::crafter()),
            "gate" => Some(Self::gate()),
            "developer" => Some(Self::developer()),
            _ => None,
        }
    }
}

// ─── System Prompts (Hardcoded Fallbacks) ─────────────────────────────────

const CRAFTER_SYSTEM_PROMPT: &str = r#"## Crafter (Implementor)

Implement your assigned task — nothing more, nothing less. Produce minimal, clean changes.

## Hard Rules
1. **No scope creep** — only what the task asks
2. **No refactors** — if needed, report to parent for a separate task
3. **Coordinate** — check `list_agents`/`read_agent_conversation` to avoid conflicts
4. **Notes only** — don't create markdown files for collaboration
5. **Don't delegate** — message parent coordinator if blocked

## Completion (REQUIRED)
When done, you MUST call `report_to_parent` with:
- summary: 1-3 sentences of what you did
- success: true/false
- filesModified: list of files you changed
- taskId: the task ID you were assigned
"#;

const CRAFTER_ROLE_REMINDER: &str =
    "Stay within task scope. No refactors, no scope creep. Call report_to_parent when complete.";

const GATE_SYSTEM_PROMPT: &str = r#"## Gate (Verifier)

You verify the implementation against the spec's **Acceptance Criteria**.
You are evidence-driven: if you can't point to concrete evidence, it's not verified.

## Hard Rules
1) **Acceptance Criteria is the checklist.** Do not verify against vibes.
2) **No evidence, no verification.** If you can't cite evidence, mark ⚠️ or ❌.
3) **No partial approvals.** "APPROVED" only if every criterion is ✅ VERIFIED.

## Completion (REQUIRED)
Call `report_to_parent` with:
- summary: verdict + confidence, tests run, top 1-3 issues
- success: true only if ALL criteria are VERIFIED
- taskId: the task ID you were verifying
"#;

const GATE_ROLE_REMINDER: &str =
    "Verify against Acceptance Criteria ONLY. Be evidence-driven. Call report_to_parent with verdict.";

const DEVELOPER_SYSTEM_PROMPT: &str = r#"## Developer

You plan and implement. You write specs first, then implement the work yourself after approval.

## Hard Rules
1. **Spec first, always** — Create/update the spec BEFORE any implementation.
2. **Wait for approval** — Present the plan and STOP. Wait for user approval.
3. **No delegation** — Never use `delegate_task` or `create_agent`.
"#;

const DEVELOPER_ROLE_REMINDER: &str =
    "You work ALONE — never use delegate_task or create_agent. Spec first, wait for approval.";

// ─── Delegation Parameters ────────────────────────────────────────────────

/// Parameters for delegating a task with agent spawning.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegateWithSpawnParams {
    /// Task ID to delegate
    pub task_id: String,
    /// Calling agent's ID
    pub caller_agent_id: String,
    /// Calling agent's session ID (for wake-up)
    pub caller_session_id: String,
    /// Workspace ID
    pub workspace_id: String,
    /// Specialist role: "CRAFTER", "GATE", "DEVELOPER"
    pub specialist: String,
    /// ACP provider to use for the child
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Working directory for the child agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Additional instructions beyond the task content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    /// Wait mode: "immediate" or "after_all"
    #[serde(default = "default_wait_mode")]
    pub wait_mode: String,
}

fn default_wait_mode() -> String {
    "immediate".to_string()
}

/// Orchestrator configuration.
#[derive(Debug, Clone)]
pub struct OrchestratorConfig {
    /// Default ACP provider for CRAFTER agents
    pub default_crafter_provider: String,
    /// Default ACP provider for GATE agents
    pub default_gate_provider: String,
    /// Default working directory
    pub default_cwd: String,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            default_crafter_provider: "opencode".to_string(),
            default_gate_provider: "opencode".to_string(),
            default_cwd: ".".to_string(),
        }
    }
}

// ─── Child Agent Record ───────────────────────────────────────────────────

/// Tracks a spawned child agent and its relationship to a parent.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ChildAgentRecord {
    agent_id: String,
    session_id: String,
    parent_agent_id: String,
    parent_session_id: String,
    task_id: String,
    role: AgentRole,
    provider: String,
}

/// Delegation group for wait_mode="after_all"
#[derive(Debug)]
struct DelegationGroup {
    #[allow(dead_code)]
    group_id: String,
    parent_agent_id: String,
    parent_session_id: String,
    child_agent_ids: Vec<String>,
    completed_agent_ids: HashSet<String>,
}

// ─── Orchestrator Inner State ─────────────────────────────────────────────

struct OrchestratorInner {
    /// Map: agentId → ChildAgentRecord
    child_agents: HashMap<String, ChildAgentRecord>,
    /// Map: agentId → sessionId
    agent_session_map: HashMap<String, String>,
    /// Map: groupId → DelegationGroup
    delegation_groups: HashMap<String, DelegationGroup>,
    /// Map: callerAgentId → current groupId (for after_all mode)
    active_group_by_agent: HashMap<String, String>,
}

// ─── Routa Orchestrator ───────────────────────────────────────────────────

/// The core orchestration engine that bridges MCP tool calls with ACP process spawning.
pub struct RoutaOrchestrator {
    inner: Arc<RwLock<OrchestratorInner>>,
    config: OrchestratorConfig,
    acp_manager: Arc<AcpManager>,
    agent_store: AgentStore,
    task_store: TaskStore,
    event_bus: EventBus,
}

impl RoutaOrchestrator {
    pub fn new(
        config: OrchestratorConfig,
        acp_manager: Arc<AcpManager>,
        agent_store: AgentStore,
        task_store: TaskStore,
        event_bus: EventBus,
    ) -> Self {
        Self {
            inner: Arc::new(RwLock::new(OrchestratorInner {
                child_agents: HashMap::new(),
                agent_session_map: HashMap::new(),
                delegation_groups: HashMap::new(),
                active_group_by_agent: HashMap::new(),
            })),
            config,
            acp_manager,
            agent_store,
            task_store,
            event_bus,
        }
    }

    /// Register the mapping between an agent ID and its ACP session ID.
    pub async fn register_agent_session(&self, agent_id: &str, session_id: &str) {
        let mut inner = self.inner.write().await;
        inner
            .agent_session_map
            .insert(agent_id.to_string(), session_id.to_string());
        tracing::info!(
            "[Orchestrator] Registered agent session: {} → {}",
            agent_id,
            session_id
        );
    }

    /// Get the session ID for an agent.
    pub async fn get_session_for_agent(&self, agent_id: &str) -> Option<String> {
        let inner = self.inner.read().await;
        inner.agent_session_map.get(agent_id).cloned()
    }

    /// Delegate a task to a new agent by spawning a real ACP process.
    pub async fn delegate_task_with_spawn(
        &self,
        params: DelegateWithSpawnParams,
    ) -> Result<ToolResult, ServerError> {
        // 1. Resolve specialist config
        let specialist_config = self.resolve_specialist(&params.specialist);
        let specialist_config = match specialist_config {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(format!(
                    "Unknown specialist: {}. Use CRAFTER, GATE, or DEVELOPER.",
                    params.specialist
                )));
            }
        };

        // 2. Get the task
        let task = match self.task_store.get(&params.task_id).await? {
            Some(t) => t,
            None => {
                return Ok(ToolResult::error(format!(
                    "Task not found: {}",
                    params.task_id
                )));
            }
        };

        // 3. Determine provider
        let provider = params.provider.unwrap_or_else(|| {
            if specialist_config.role == AgentRole::Crafter {
                self.config.default_crafter_provider.clone()
            } else {
                self.config.default_gate_provider.clone()
            }
        });

        let cwd = params.cwd.unwrap_or_else(|| self.config.default_cwd.clone());

        // 4. Create agent record
        let agent_id = uuid::Uuid::new_v4().to_string();
        let agent_name = format!(
            "{}-{}",
            specialist_config.id,
            task.title
                .chars()
                .take(30)
                .collect::<String>()
                .replace(' ', "-")
                .to_lowercase()
        );

        let agent = crate::server::models::agent::Agent::new(
            agent_id.clone(),
            agent_name.clone(),
            specialist_config.role.clone(),
            params.workspace_id.clone(),
            Some(params.caller_agent_id.clone()),
            Some(specialist_config.default_model_tier.clone()),
            None,
        );
        self.agent_store.save(&agent).await?;

        // 5. Build the delegation prompt
        let delegation_prompt = build_delegation_prompt(
            &specialist_config,
            &agent_id,
            &params.task_id,
            &task.title,
            &task.objective,
            task.scope.as_deref(),
            task.acceptance_criteria.as_ref(),
            task.verification_commands.as_ref(),
            &params.caller_agent_id,
            params.additional_instructions.as_deref(),
        );

        // 6. Assign task to agent and update status
        let mut task = task;
        task.assigned_to = Some(agent_id.clone());
        task.status = TaskStatus::InProgress;
        task.updated_at = Utc::now();
        self.task_store.save(&task).await?;
        self.agent_store
            .update_status(&agent_id, &AgentStatus::Active)
            .await?;

        // 7. Spawn the ACP process
        let child_session_id = uuid::Uuid::new_v4().to_string();
        let spawn_result = self
            .acp_manager
            .create_session(
                child_session_id.clone(),
                cwd.clone(),
                params.workspace_id.clone(),
                Some(provider.clone()),
            )
            .await;

        let (_, _acp_session_id) = match spawn_result {
            Ok(ids) => ids,
            Err(e) => {
                // Clean up on spawn failure
                self.agent_store
                    .update_status(&agent_id, &AgentStatus::Error)
                    .await?;
                task.status = TaskStatus::Blocked;
                task.updated_at = Utc::now();
                self.task_store.save(&task).await?;
                return Ok(ToolResult::error(format!(
                    "Failed to spawn agent process: {}",
                    e
                )));
            }
        };

        // Send the initial prompt
        if let Err(e) = self.acp_manager.prompt(&child_session_id, &delegation_prompt).await {
            tracing::error!(
                "[Orchestrator] Failed to send initial prompt to agent {}: {}",
                agent_id,
                e
            );
        }

        // 8. Track the child agent
        {
            let mut inner = self.inner.write().await;
            let record = ChildAgentRecord {
                agent_id: agent_id.clone(),
                session_id: child_session_id.clone(),
                parent_agent_id: params.caller_agent_id.clone(),
                parent_session_id: params.caller_session_id.clone(),
                task_id: params.task_id.clone(),
                role: specialist_config.role.clone(),
                provider: provider.clone(),
            };
            inner.child_agents.insert(agent_id.clone(), record);
            inner
                .agent_session_map
                .insert(agent_id.clone(), child_session_id.clone());

            // 9. Handle wait mode
            if params.wait_mode == "after_all" {
                let group_id = inner
                    .active_group_by_agent
                    .get(&params.caller_agent_id)
                    .cloned();

                let group_id = match group_id {
                    Some(gid) => gid,
                    None => {
                        let new_group_id = format!("delegation-group-{}", uuid::Uuid::new_v4());
                        inner
                            .active_group_by_agent
                            .insert(params.caller_agent_id.clone(), new_group_id.clone());
                        inner.delegation_groups.insert(
                            new_group_id.clone(),
                            DelegationGroup {
                                group_id: new_group_id.clone(),
                                parent_agent_id: params.caller_agent_id.clone(),
                                parent_session_id: params.caller_session_id.clone(),
                                child_agent_ids: Vec::new(),
                                completed_agent_ids: HashSet::new(),
                            },
                        );
                        new_group_id
                    }
                };

                if let Some(group) = inner.delegation_groups.get_mut(&group_id) {
                    group.child_agent_ids.push(agent_id.clone());
                }
            }
        }

        // 10. Emit event
        self.event_bus
            .emit(AgentEvent {
                event_type: AgentEventType::TaskAssigned,
                agent_id: agent_id.clone(),
                workspace_id: params.workspace_id.clone(),
                data: serde_json::json!({
                    "taskId": params.task_id,
                    "callerAgentId": params.caller_agent_id,
                    "taskTitle": task.title,
                    "provider": provider,
                    "specialist": specialist_config.id,
                }),
                timestamp: Utc::now(),
            })
            .await;

        let wait_message = if params.wait_mode == "after_all" {
            "You will be notified when ALL delegated agents in this group complete."
        } else {
            "You will be notified when this agent completes."
        };

        tracing::info!(
            "[Orchestrator] Delegated task \"{}\" to {} agent {} (provider: {})",
            task.title,
            specialist_config.name,
            agent_id,
            provider
        );

        Ok(ToolResult::success(serde_json::json!({
            "agentId": agent_id,
            "taskId": params.task_id,
            "agentName": agent_name,
            "specialist": specialist_config.id,
            "provider": provider,
            "sessionId": child_session_id,
            "waitMode": params.wait_mode,
            "message": format!("Task \"{}\" delegated to {} agent. {}", task.title, specialist_config.name, wait_message),
        })))
    }

    /// Handle a report submitted by a child agent.
    pub async fn handle_report_submitted(
        &self,
        child_agent_id: &str,
        report: &CompletionReport,
    ) -> Result<(), ServerError> {
        let record = {
            let inner = self.inner.read().await;
            inner.child_agents.get(child_agent_id).cloned()
        };

        let record = match record {
            Some(r) => r,
            None => {
                tracing::warn!(
                    "[Orchestrator] Report from unknown child agent {}, ignoring",
                    child_agent_id
                );
                return Ok(());
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
                task.updated_at = Utc::now();
                self.task_store.save(&task).await?;
            }
        }

        // Mark agent completed
        self.agent_store
            .update_status(child_agent_id, &AgentStatus::Completed)
            .await?;

        // Handle completion (check groups or wake parent)
        self.handle_child_completion(child_agent_id, &record).await?;

        Ok(())
    }

    /// Handle child agent completion: check groups or immediately wake parent.
    async fn handle_child_completion(
        &self,
        child_agent_id: &str,
        record: &ChildAgentRecord,
    ) -> Result<(), ServerError> {
        let mut inner = self.inner.write().await;

        // Check if this child is part of an after_all group
        let mut group_complete = None;
        for (group_id, group) in inner.delegation_groups.iter_mut() {
            if group.child_agent_ids.contains(&child_agent_id.to_string()) {
                group.completed_agent_ids.insert(child_agent_id.to_string());
                tracing::info!(
                    "[Orchestrator] Agent {} completed in group {} ({}/{})",
                    child_agent_id,
                    group_id,
                    group.completed_agent_ids.len(),
                    group.child_agent_ids.len()
                );

                if group.completed_agent_ids.len() >= group.child_agent_ids.len() {
                    group_complete = Some((
                        group_id.clone(),
                        group.parent_agent_id.clone(),
                        group.parent_session_id.clone(),
                    ));
                }
                break;
            }
        }

        if let Some((group_id, parent_agent_id, parent_session_id)) = group_complete {
            tracing::info!(
                "[Orchestrator] All agents in group {} completed, waking parent",
                group_id
            );
            inner.delegation_groups.remove(&group_id);
            inner.active_group_by_agent.remove(&parent_agent_id);

            // Wake parent with group completion message
            drop(inner); // Release lock before async call
            self.wake_parent_with_group_completion(&parent_session_id, &group_id)
                .await?;
        } else {
            // Immediate mode: wake parent right away
            tracing::info!(
                "[Orchestrator] Child agent {} completed, waking parent {}",
                child_agent_id,
                record.parent_agent_id
            );
            drop(inner);
            self.wake_parent(&record.parent_session_id, child_agent_id, &record.task_id)
                .await?;
        }

        Ok(())
    }

    /// Wake a parent agent by sending a completion prompt to its session.
    async fn wake_parent(
        &self,
        parent_session_id: &str,
        child_agent_id: &str,
        task_id: &str,
    ) -> Result<(), ServerError> {
        let agent = self.agent_store.get(child_agent_id).await?;
        let task = self.task_store.get(task_id).await?;

        let wake_message = format!(
            "## Agent Completion Report\n\n\
             **Agent:** {} ({})\n\
             **Task:** {}\n\
             **Status:** {:?}\n\
             {}\n\
             Review the results and decide next steps.",
            agent.as_ref().map(|a| a.name.as_str()).unwrap_or(child_agent_id),
            child_agent_id,
            task.as_ref().map(|t| t.title.as_str()).unwrap_or(task_id),
            task.as_ref().map(|t| &t.status),
            task.as_ref()
                .and_then(|t| t.completion_summary.as_ref())
                .map(|s| format!("**Summary:** {}\n", s))
                .unwrap_or_default()
        );

        if let Err(e) = self.acp_manager.prompt(parent_session_id, &wake_message).await {
            tracing::error!(
                "[Orchestrator] Failed to wake parent session {}: {}",
                parent_session_id,
                e
            );
        }

        Ok(())
    }

    /// Wake parent with group completion message.
    async fn wake_parent_with_group_completion(
        &self,
        parent_session_id: &str,
        _group_id: &str,
    ) -> Result<(), ServerError> {
        let wake_message = "## Delegation Group Complete\n\n\
            All delegated agents have completed their work.\n\
            Review the results and decide next steps.\n\
            You may want to delegate a GATE (verifier) agent to validate the work.";

        if let Err(e) = self.acp_manager.prompt(parent_session_id, wake_message).await {
            tracing::error!(
                "[Orchestrator] Failed to wake parent session {}: {}",
                parent_session_id,
                e
            );
        }

        Ok(())
    }

    /// Resolve specialist config from a string (role name or specialist ID).
    fn resolve_specialist(&self, input: &str) -> Option<SpecialistConfig> {
        // Try by role name (e.g., "CRAFTER", "GATE")
        if let Some(role) = AgentRole::from_str(input) {
            return SpecialistConfig::by_role(&role);
        }
        // Try by specialist ID (e.g., "crafter", "gate")
        SpecialistConfig::by_id(input)
    }

    /// Clean up resources for a session.
    pub async fn cleanup(&self, session_id: &str) {
        let mut inner = self.inner.write().await;
        let agents_to_remove: Vec<String> = inner
            .child_agents
            .iter()
            .filter(|(_, r)| r.parent_session_id == session_id || r.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();

        for agent_id in agents_to_remove {
            if let Some(record) = inner.child_agents.remove(&agent_id) {
                self.acp_manager.kill_session(&record.session_id).await;
            }
            inner.agent_session_map.remove(&agent_id);
        }
    }
}

// ─── Helper Functions ─────────────────────────────────────────────────────

/// Build the initial prompt for a delegated agent.
fn build_delegation_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    task_id: &str,
    task_title: &str,
    task_objective: &str,
    task_scope: Option<&str>,
    acceptance_criteria: Option<&Vec<String>>,
    verification_commands: Option<&Vec<String>>,
    parent_agent_id: &str,
    additional_context: Option<&str>,
) -> String {
    let mut prompt = format!("{}\n\n---\n\n", specialist.system_prompt);
    prompt.push_str(&format!("**Your Agent ID:** {}\n", agent_id));
    prompt.push_str(&format!("**Your Parent Agent ID:** {}\n", parent_agent_id));
    prompt.push_str(&format!("**Task ID:** {}\n\n", task_id));
    prompt.push_str(&format!("# Task: {}\n\n", task_title));
    prompt.push_str(&format!("## Objective\n{}\n", task_objective));

    if let Some(scope) = task_scope {
        prompt.push_str(&format!("\n## Scope\n{}\n", scope));
    }

    if let Some(criteria) = acceptance_criteria {
        prompt.push_str("\n## Definition of Done\n");
        for c in criteria {
            prompt.push_str(&format!("- {}\n", c));
        }
    }

    if let Some(commands) = verification_commands {
        prompt.push_str("\n## Verification\n");
        for c in commands {
            prompt.push_str(&format!("- `{}`\n", c));
        }
    }

    prompt.push_str(&format!("\n---\n**Reminder:** {}\n", specialist.role_reminder));

    if let Some(ctx) = additional_context {
        prompt.push_str(&format!("\n**Additional Context:** {}\n", ctx));
    }

    prompt.push_str("\n**SCOPE: Complete THIS task only.** When done, call `report_to_parent` with your results.");

    prompt
}

