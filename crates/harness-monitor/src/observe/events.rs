#![allow(dead_code)]

use crate::shared::ids::{EventId, RunId, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};

/// Source that generated the event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    HookAdapter,
    ManagedRuntime,
    GitObserver,
    EvaluatorAdapter,
    PolicyEngine,
    ExternalCi,
    RuntimeTelemetry,
    ManualOperator,
}

impl EventSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            EventSource::HookAdapter => "hook_adapter",
            EventSource::ManagedRuntime => "managed_runtime",
            EventSource::GitObserver => "git_observer",
            EventSource::EvaluatorAdapter => "evaluator_adapter",
            EventSource::PolicyEngine => "policy_engine",
            EventSource::ExternalCi => "external_ci",
            EventSource::RuntimeTelemetry => "runtime_telemetry",
            EventSource::ManualOperator => "manual_operator",
        }
    }
}

/// Uniform envelope wrapping every domain event with correlation metadata.
///
/// The inner `payload` carries the event-specific fields. All events are
/// correlated via `task_id` / `run_id` / `workspace_id` and linked via
/// `causation_id` (what triggered this event) and `correlation_id` (the
/// root trace identifier).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope<T> {
    pub event_id: EventId,
    pub timestamp_ms: i64,
    pub source: EventSource,
    pub task_id: Option<TaskId>,
    pub run_id: Option<RunId>,
    pub workspace_id: Option<WorkspaceId>,
    /// The event_id of the event that directly caused this one.
    pub causation_id: Option<String>,
    /// Root trace identifier shared by all events in a single request chain.
    pub correlation_id: Option<String>,
    pub payload: T,
}

impl<T: Serialize> EventEnvelope<T> {
    pub fn new(payload: T, source: EventSource, timestamp_ms: i64) -> Self {
        Self {
            event_id: EventId::new(uuid_v4_simple()),
            timestamp_ms,
            source,
            task_id: None,
            run_id: None,
            workspace_id: None,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    pub fn with_run(mut self, run_id: RunId) -> Self {
        self.run_id = Some(run_id);
        self
    }

    pub fn with_task(mut self, task_id: TaskId) -> Self {
        self.task_id = Some(task_id);
        self
    }

    pub fn with_workspace(mut self, workspace_id: WorkspaceId) -> Self {
        self.workspace_id = Some(workspace_id);
        self
    }
}

/// Well-known domain event type names.
pub mod event_types {
    pub const TASK_CREATED: &str = "task.created";
    pub const TASK_UPDATED: &str = "task.updated";
    pub const RUN_CREATED: &str = "run.created";
    pub const RUN_STARTED: &str = "run.started";
    pub const RUN_STOPPED: &str = "run.stopped";
    pub const CONTEXT_BUILT: &str = "context.built";
    pub const WORKSPACE_PROVISIONED: &str = "workspace.provisioned";
    pub const WORKSPACE_DRIFT_DETECTED: &str = "workspace.drift_detected";
    pub const TOOL_PRE: &str = "tool.pre";
    pub const TOOL_POST: &str = "tool.post";
    pub const POLICY_DECIDED: &str = "policy.decided";
    pub const EVAL_COMPLETED: &str = "eval.completed";
    pub const EVIDENCE_CREATED: &str = "evidence.created";
    pub const APPROVAL_REQUESTED: &str = "approval.requested";
    pub const APPROVAL_COMPLETED: &str = "approval.completed";
    pub const PR_OPENED: &str = "pr.opened";
    pub const MERGE_COMPLETED: &str = "merge.completed";
    pub const DEPLOY_STARTED: &str = "deploy.started";
    pub const DEPLOY_COMPLETED: &str = "deploy.completed";
    pub const RUNTIME_ANOMALY: &str = "runtime.anomaly";
    pub const CLEANUP_TASK_OPENED: &str = "cleanup.task_opened";
}

fn uuid_v4_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("{:016x}", ns as u64)
}
