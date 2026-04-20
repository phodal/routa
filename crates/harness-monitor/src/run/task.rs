#![allow(dead_code)]

use crate::evaluate::eval::EvalSnapshot;
use crate::govern::evidence::EvidenceRequirement;
use crate::run::policy::EffectClass;
use crate::shared::ids::{RunId, TaskId};
use serde::{Deserialize, Serialize};

/// Risk level used to set default policy strictness.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
            RiskLevel::Critical => "critical",
        }
    }
}

/// An explicit merge policy for a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MergePolicy {
    AutoMergeOnPass,
    RequireApproval,
    Manual,
}

/// A deploy policy for a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeployPolicy {
    AutoDeployOnMerge,
    RequireApproval,
    Manual,
    Never,
}

/// How escalations are handled when a run encounters a blocker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EscalationPolicy {
    PauseAndNotify,
    AbortRun,
    Retry { max_attempts: u32 },
}

/// A reference to a source document or context that informed the task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub kind: String,
    pub uri: String,
    pub description: Option<String>,
}

/// The human or system that owns this task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Owner {
    pub name: String,
    pub contact: Option<String>,
}

/// A named capability required by the task (e.g. "fs_write", "network_read").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub name: String,
}

/// Structured specification of what a task should accomplish.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSpec {
    pub task_id: TaskId,
    pub title: String,
    pub objective: String,
    pub acceptance_criteria: Vec<String>,
    pub risk_level: RiskLevel,
    pub requested_capabilities: Vec<Capability>,
    pub required_evidence: Vec<EvidenceRequirement>,
    pub allowed_effects: Vec<EffectClass>,
    pub merge_policy: MergePolicy,
    pub deploy_policy: DeployPolicy,
    pub escalation_policy: EscalationPolicy,
    pub source_refs: Vec<SourceRef>,
    pub owner: Owner,
}

/// Lifecycle state of a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Draft,
    Ready,
    Running,
    AwaitingApproval,
    Blocked,
    Merged,
    Deployed,
    Closed,
}

impl TaskState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskState::Draft => "draft",
            TaskState::Ready => "ready",
            TaskState::Running => "running",
            TaskState::AwaitingApproval => "awaiting_approval",
            TaskState::Blocked => "blocked",
            TaskState::Merged => "merged",
            TaskState::Deployed => "deployed",
            TaskState::Closed => "closed",
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self,
            TaskState::Running | TaskState::AwaitingApproval | TaskState::Blocked
        )
    }
}

/// A first-class task being executed by the harness.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: TaskId,
    pub spec: TaskSpec,
    pub state: TaskState,
    pub active_runs: Vec<RunId>,
    pub latest_eval: Option<EvalSnapshot>,
    pub required_evidence: Vec<EvidenceRequirement>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl Task {
    pub fn is_ready_for_merge(&self) -> bool {
        if let Some(eval) = &self.latest_eval {
            !eval.hard_gate_blocked && !eval.score_blocked
        } else {
            false
        }
    }
}
