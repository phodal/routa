#![allow(dead_code)]

use crate::run::policy::{EffectClass, SecretScope, ToolSpec};
use crate::shared::ids::{RunId, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Whether the run is driven by Harness (managed) or by an external agent (unmanaged).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    /// Harness launches and controls the agent (worktree, env, policy enforced).
    Managed,
    /// External agent is already running; Harness attaches, observes, and evaluates.
    Unmanaged,
}

impl RunMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunMode::Managed => "managed",
            RunMode::Unmanaged => "unmanaged",
        }
    }
}

/// Named role within the multi-agent orchestration flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Planner,
    Builder,
    Reviewer,
    Fixer,
    Release,
    Caretaker,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Planner => "planner",
            Role::Builder => "builder",
            Role::Reviewer => "reviewer",
            Role::Fixer => "fixer",
            Role::Release => "release",
            Role::Caretaker => "caretaker",
        }
    }
}

/// Lifecycle state of a single run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Created,
    ContextPrepared,
    WaitingForWorkspace,
    Executing,
    Evaluating,
    AwaitingApproval,
    Succeeded,
    Failed,
    Interrupted,
    Replayed,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunState::Created => "created",
            RunState::ContextPrepared => "context_prepared",
            RunState::WaitingForWorkspace => "waiting_for_workspace",
            RunState::Executing => "executing",
            RunState::Evaluating => "evaluating",
            RunState::AwaitingApproval => "awaiting_approval",
            RunState::Succeeded => "succeeded",
            RunState::Failed => "failed",
            RunState::Interrupted => "interrupted",
            RunState::Replayed => "replayed",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RunState::Succeeded | RunState::Failed | RunState::Interrupted
        )
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self,
            RunState::Executing | RunState::Evaluating | RunState::ContextPrepared
        )
    }
}

/// Budget constraints for a run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EffectBudget {
    pub max_tokens: Option<u64>,
    pub max_tool_calls: Option<u32>,
    pub time_budget_secs: Option<u64>,
}

/// An approval checkpoint that must be cleared before execution continues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub name: String,
    pub effect: EffectClass,
    pub approved: bool,
    pub approved_by: Option<String>,
    pub approved_at_ms: Option<i64>,
}

/// A live run of an agent against a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: RunId,
    /// None for unmanaged runs not yet associated with a task.
    pub task_id: Option<TaskId>,
    pub role: Role,
    pub mode: RunMode,
    pub state: RunState,
    /// None for unmanaged runs where the workspace is the repo root itself.
    pub workspace_id: Option<WorkspaceId>,
    pub model: Option<String>,
    pub tool_scope: Vec<ToolSpec>,
    pub effect_budget: EffectBudget,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
}

impl Run {
    pub fn duration_ms(&self) -> Option<i64> {
        self.ended_at_ms.map(|end| end - self.started_at_ms)
    }
}

/// Full envelope for a managed run, containing everything needed to reproduce execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEnvelope {
    pub run_id: RunId,
    pub task_id: TaskId,
    pub workspace_id: WorkspaceId,
    pub model: Option<String>,
    pub tool_allowlist: Vec<ToolSpec>,
    pub secret_scope: SecretScope,
    pub time_budget: Option<Duration>,
    pub token_budget: Option<u64>,
    pub approval_checkpoints: Vec<Checkpoint>,
}

/// Structured handoff between agent roles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handoff {
    pub from_role: Role,
    pub to_role: Role,
    pub task_id: TaskId,
    pub run_id: RunId,
    pub changed_files: Vec<String>,
    pub unresolved_questions: Vec<String>,
    pub recommended_next_actions: Vec<String>,
}
