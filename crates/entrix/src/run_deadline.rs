use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::model::{Gate, Metric, MetricResult};

#[derive(Clone, Debug)]
pub struct RunDeadline {
    started_at: Instant,
    max_runtime: Duration,
    triggered: Arc<AtomicBool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeadlineBudget {
    pub timeout: Duration,
    pub capped_by_run_deadline: bool,
}

impl RunDeadline {
    pub fn new(max_runtime_seconds: u64) -> Option<Self> {
        if max_runtime_seconds == 0 {
            return None;
        }

        Some(Self {
            started_at: Instant::now(),
            max_runtime: Duration::from_secs(max_runtime_seconds),
            triggered: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn budget_for(&self, configured_timeout: Duration) -> DeadlineBudget {
        let remaining = self.remaining();
        if remaining < configured_timeout {
            DeadlineBudget {
                timeout: remaining,
                capped_by_run_deadline: true,
            }
        } else {
            DeadlineBudget {
                timeout: configured_timeout,
                capped_by_run_deadline: false,
            }
        }
    }

    pub fn is_expired(&self) -> bool {
        self.started_at.elapsed() >= self.max_runtime
    }

    pub fn max_runtime_seconds(&self) -> u64 {
        self.max_runtime.as_secs()
    }

    pub fn mark_triggered(&self) {
        self.triggered.store(true, Ordering::Relaxed);
    }

    pub fn was_triggered(&self) -> bool {
        self.triggered.load(Ordering::Relaxed)
    }

    pub fn timeout_message(&self) -> String {
        format!(
            "GLOBAL TIMEOUT (entrix run exceeded {}s max runtime)",
            self.max_runtime_seconds()
        )
    }

    pub fn timeout_result_before_start(&self, metric: &Metric) -> MetricResult {
        self.mark_triggered();
        MetricResult::new(
            metric.name.clone(),
            false,
            format!("{} before metric started", self.timeout_message()),
            metric.tier,
        )
        .with_hard_gate(metric.gate == Gate::Hard)
    }

    fn remaining(&self) -> Duration {
        self.max_runtime
            .checked_sub(self.started_at.elapsed())
            .unwrap_or(Duration::ZERO)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Metric;

    #[test]
    fn disabled_when_max_runtime_is_zero() {
        assert!(RunDeadline::new(0).is_none());
    }

    #[test]
    fn caps_budget_to_remaining_runtime() {
        let deadline = RunDeadline::new(10).expect("deadline");
        let budget = deadline.budget_for(Duration::from_secs(20));
        assert!(budget.timeout <= Duration::from_secs(10));
        assert!(budget.timeout > Duration::from_secs(9));
        assert!(budget.capped_by_run_deadline);
    }

    #[test]
    fn timeout_result_marks_deadline_as_triggered() {
        let deadline = RunDeadline::new(1).expect("deadline");
        let metric = Metric::new("lint", "echo ok");
        let result = deadline.timeout_result_before_start(&metric);
        assert!(!result.passed);
        assert!(result.output.contains("GLOBAL TIMEOUT"));
        assert!(deadline.was_triggered());
    }
}
