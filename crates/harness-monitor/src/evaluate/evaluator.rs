#![allow(dead_code)]

use super::eval::{DimensionScore, EvalInput, EvalMode, EvalSnapshot, EvaluatorKind};
use anyhow::Result;

/// Unified evaluator interface (Architecture §13.2).
///
/// In v1 only the Entrix adapter is implemented; future adapters include
/// browser, contract, and runtime evaluators.
pub trait Evaluator: Send + Sync {
    fn kind(&self) -> EvaluatorKind;
    fn supports_mode(&self, mode: &EvalMode) -> bool;
    fn evaluate(&self, input: &EvalInput) -> Result<EvalSnapshot>;
}

/// Adapter that wraps the existing `tui_fitness::run_fitness` behind the
/// unified `Evaluator` trait.
pub struct EntrixEvaluator {
    pub repo_root: String,
}

impl EntrixEvaluator {
    pub fn new(repo_root: impl Into<String>) -> Self {
        Self {
            repo_root: repo_root.into(),
        }
    }
}

impl Evaluator for EntrixEvaluator {
    fn kind(&self) -> EvaluatorKind {
        EvaluatorKind::Maintainability
    }

    fn supports_mode(&self, mode: &EvalMode) -> bool {
        matches!(mode, EvalMode::Fast | EvalMode::Full)
    }

    fn evaluate(&self, input: &EvalInput) -> Result<EvalSnapshot> {
        let fitness_mode = match input.eval_mode {
            EvalMode::Fast => crate::evaluate::entrix::FitnessRunMode::Fast,
            EvalMode::Full | EvalMode::PostMerge | EvalMode::Runtime => {
                crate::evaluate::entrix::FitnessRunMode::Full
            }
        };
        let snapshot = crate::evaluate::entrix::run_fitness(&self.repo_root, fitness_mode)?;
        Ok(convert_fitness_to_eval_snapshot(snapshot, input))
    }
}

/// Bridge between the legacy `FitnessSnapshot` and the domain `EvalSnapshot`.
fn convert_fitness_to_eval_snapshot(
    fs: crate::evaluate::entrix::FitnessSnapshot,
    input: &EvalInput,
) -> EvalSnapshot {
    let dimensions: Vec<DimensionScore> = fs
        .dimensions
        .iter()
        .map(|d| DimensionScore {
            name: d.name.clone(),
            score: d.score as f32,
            max_score: 100.0,
            blocked: !d.hard_gate_failures.is_empty(),
            details: if d.hard_gate_failures.is_empty() {
                format!("{}/{} passed", d.passed, d.total)
            } else {
                format!(
                    "{}/{} passed, hard-gate: {}",
                    d.passed,
                    d.total,
                    d.hard_gate_failures.join(", ")
                )
            },
        })
        .collect();

    EvalSnapshot {
        run_id: input.run_id.clone(),
        mode: input.eval_mode.clone(),
        overall_score: fs.final_score as f32,
        hard_gate_blocked: fs.hard_gate_blocked,
        score_blocked: fs.score_blocked,
        dimensions,
        evidence: Vec::new(),
        recommendations: Vec::new(),
        evaluated_at_ms: chrono::Utc::now().timestamp_millis(),
        duration_ms: fs.duration_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entrix_evaluator_supports_fast_and_full() {
        let evaluator = EntrixEvaluator::new("/tmp/fake");
        assert!(evaluator.supports_mode(&EvalMode::Fast));
        assert!(evaluator.supports_mode(&EvalMode::Full));
        assert!(!evaluator.supports_mode(&EvalMode::PostMerge));
        assert!(!evaluator.supports_mode(&EvalMode::Runtime));
    }

    #[test]
    fn entrix_evaluator_kind_is_maintainability() {
        let evaluator = EntrixEvaluator::new("/tmp/fake");
        assert_eq!(evaluator.kind(), EvaluatorKind::Maintainability);
    }
}
