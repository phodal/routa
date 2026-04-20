#![allow(dead_code)]

use crate::shared::ids::{RunId, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};

/// Which evaluation depth is requested.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalMode {
    Fast,
    Full,
    PostMerge,
    Runtime,
}

impl EvalMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            EvalMode::Fast => "fast",
            EvalMode::Full => "full",
            EvalMode::PostMerge => "post_merge",
            EvalMode::Runtime => "runtime",
        }
    }
}

/// Category of evaluator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluatorKind {
    Maintainability,
    ArchitectureFitness,
    Behavior,
    Runtime,
}

/// Input fed to any evaluator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalInput {
    pub task_id: Option<TaskId>,
    pub run_id: Option<RunId>,
    pub workspace_id: Option<WorkspaceId>,
    pub changed_files: Vec<String>,
    pub eval_mode: EvalMode,
    pub repo_root: String,
}

/// A single scored dimension within an EvalSnapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimensionScore {
    pub name: String,
    pub score: f32,
    pub max_score: f32,
    pub blocked: bool,
    pub details: String,
}

/// A lightweight reference to an evidence artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub id: String,
    pub kind: String,
    pub uri: String,
}

/// A recommended follow-up action from an evaluator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation {
    pub severity: String,
    pub message: String,
    pub file: Option<String>,
}

/// Full snapshot of evaluation results for a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalSnapshot {
    pub run_id: Option<RunId>,
    pub mode: EvalMode,
    pub overall_score: f32,
    pub hard_gate_blocked: bool,
    pub score_blocked: bool,
    pub dimensions: Vec<DimensionScore>,
    pub evidence: Vec<EvidenceRef>,
    pub recommendations: Vec<Recommendation>,
    pub evaluated_at_ms: i64,
    pub duration_ms: f64,
}

impl EvalSnapshot {
    pub fn summary_line(&self) -> String {
        format!(
            "score={:.1} gate={} mode={}",
            self.overall_score,
            if self.hard_gate_blocked {
                "BLOCKED"
            } else {
                "ok"
            },
            self.mode.as_str()
        )
    }
}
