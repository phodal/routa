//! Shell runner — execute metric commands via subprocess.

pub(crate) mod support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use regex::Regex;

use crate::model::{Gate, Metric, MetricResult, ResultState};
use crate::run_deadline::RunDeadline;
use support::{
    augment_runner_path, is_infra_failure, run_command_with_timeout, smart_truncate,
    CommandRunOutput,
};

/// Callback type for progress events.
pub type ProgressCallback = Box<dyn Fn(&str, &Metric, Option<&MetricResult>) + Send + Sync>;
pub type OutputCallback = Arc<dyn Fn(&Metric, &str, &str) + Send + Sync>;

/// Executes Metric commands as shell subprocesses.
pub struct ShellRunner {
    project_root: PathBuf,
    timeout: u64,
    env_overrides: HashMap<String, String>,
    output_callback: Option<OutputCallback>,
    deadline: Option<RunDeadline>,
}

impl ShellRunner {
    pub fn new(project_root: &Path) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            timeout: 300,
            env_overrides: HashMap::new(),
            output_callback: None,
            deadline: None,
        }
    }

    pub fn with_timeout(mut self, timeout: u64) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_env_overrides(mut self, env_overrides: HashMap<String, String>) -> Self {
        self.env_overrides = env_overrides;
        self
    }

    pub fn with_output_callback(mut self, output_callback: OutputCallback) -> Self {
        self.output_callback = Some(output_callback);
        self
    }

    pub fn with_deadline(mut self, deadline: Option<RunDeadline>) -> Self {
        self.deadline = deadline;
        self
    }

    /// Execute a single metric's shell command.
    ///
    /// Returns a MetricResult with pass/fail status based on either
    /// regex pattern matching or process exit code.
    pub fn run(&self, metric: &Metric, dry_run: bool) -> MetricResult {
        // Check waiver first
        if let Some(ref waiver) = metric.waiver {
            if waiver.is_active(None) {
                return MetricResult {
                    metric_name: metric.name.clone(),
                    passed: true,
                    output: format!("[WAIVED] {}", waiver.reason),
                    tier: metric.tier,
                    hard_gate: metric.gate == Gate::Hard,
                    duration_ms: 0.0,
                    state: ResultState::Waived,
                    returncode: None,
                };
            }
        }

        if dry_run {
            return MetricResult {
                metric_name: metric.name.clone(),
                passed: true,
                output: format!("[DRY-RUN] Would run: {}", metric.command),
                tier: metric.tier,
                hard_gate: metric.gate == Gate::Hard,
                duration_ms: 0.0,
                state: ResultState::Pass,
                returncode: None,
            };
        }

        let start = Instant::now();
        let configured_timeout =
            Duration::from_secs(metric.timeout_seconds.unwrap_or(self.timeout));
        let timeout_budget = self
            .deadline
            .as_ref()
            .map(|deadline| deadline.budget_for(configured_timeout))
            .unwrap_or(crate::run_deadline::DeadlineBudget {
                timeout: configured_timeout,
                capped_by_run_deadline: false,
            });

        if timeout_budget.timeout.is_zero() {
            return self
                .deadline
                .as_ref()
                .expect("deadline should exist when timeout budget is zero")
                .timeout_result_before_start(metric);
        }

        // Build the environment
        let mut env: HashMap<String, String> = std::env::vars().collect();
        env.extend(self.env_overrides.clone());
        augment_runner_path(&mut env);

        // Use a thread to implement timeout
        let command_str = metric.command.clone();
        let project_root = self.project_root.clone();
        let env_clone = env;

        let result = match run_command_with_timeout(
            &command_str,
            &project_root,
            &env_clone,
            timeout_budget.timeout,
            self.output_callback.as_ref(),
            metric,
        ) {
            Ok(command_result) => {
                let CommandRunOutput { output, timed_out } = command_result;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{stdout}{stderr}");
                let output_truncated = smart_truncate(&combined, 4000, 4000);
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;

                if timed_out {
                    let timeout_header = if timeout_budget.capped_by_run_deadline {
                        let deadline = self
                            .deadline
                            .as_ref()
                            .expect("deadline should exist when capped by run deadline");
                        deadline.mark_triggered();
                        deadline.timeout_message()
                    } else {
                        format!("TIMEOUT ({}s)", timeout_budget.timeout.as_secs())
                    };
                    let timed_out_output = if output_truncated.trim().is_empty() {
                        timeout_header
                    } else {
                        format!("{timeout_header}\n{output_truncated}")
                    };

                    MetricResult::new(metric.name.clone(), false, timed_out_output, metric.tier)
                        .with_hard_gate(metric.gate == Gate::Hard)
                        .with_duration_ms(elapsed)
                } else {
                    let returncode = output.status.code().unwrap_or(-1);
                    let pattern_matched = if !metric.pattern.is_empty() {
                        Regex::new(&metric.pattern)
                            .map(|re| re.is_match(&combined))
                            .unwrap_or(false)
                    } else {
                        false
                    };
                    let passed = if !metric.pattern.is_empty() {
                        output.status.success() && pattern_matched
                    } else {
                        output.status.success()
                    };
                    let state = if passed {
                        ResultState::Pass
                    } else if is_infra_failure(
                        metric,
                        &combined,
                        returncode,
                        !output.status.success() && !metric.pattern.is_empty() && !pattern_matched,
                    ) {
                        ResultState::Unknown
                    } else {
                        ResultState::Fail
                    };

                    MetricResult::new(metric.name.clone(), passed, output_truncated, metric.tier)
                        .with_state(state)
                        .with_hard_gate(metric.gate == Gate::Hard)
                        .with_duration_ms(elapsed)
                        .with_returncode(returncode)
                }
            }
            Err(e) => {
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                MetricResult::new(metric.name.clone(), false, e.to_string(), metric.tier)
                    .with_state(ResultState::Unknown)
                    .with_hard_gate(metric.gate == Gate::Hard)
                    .with_duration_ms(elapsed)
            }
        };

        result
    }

    /// Execute multiple metrics, optionally in parallel.
    ///
    /// Results are returned in the same order as the input metrics.
    pub fn run_batch(
        &self,
        metrics: &[Metric],
        parallel: bool,
        dry_run: bool,
        progress_callback: Option<&ProgressCallback>,
    ) -> Vec<MetricResult> {
        if !parallel || dry_run {
            let mut results = Vec::new();
            for metric in metrics {
                if let Some(cb) = progress_callback {
                    cb("start", metric, None);
                }
                let result = self.run(metric, dry_run);
                if let Some(cb) = progress_callback {
                    cb("end", metric, Some(&result));
                }
                results.push(result);
            }
            return results;
        }

        thread::scope(|scope| {
            let handles: Vec<_> = metrics
                .iter()
                .map(|metric| {
                    let metric = metric.clone();
                    scope.spawn(move || {
                        if let Some(cb) = progress_callback {
                            cb("start", &metric, None);
                        }
                        let result = self.run(&metric, false);
                        if let Some(cb) = progress_callback {
                            cb("end", &metric, Some(&result));
                        }
                        result
                    })
                })
                .collect();

            handles
                .into_iter()
                .zip(metrics.iter())
                .map(|(handle, metric)| {
                    handle.join().unwrap_or_else(|_| {
                        MetricResult::new(
                            metric.name.clone(),
                            false,
                            "runner thread panicked",
                            metric.tier,
                        )
                        .with_hard_gate(metric.gate == Gate::Hard)
                    })
                })
                .collect()
        })
    }
}

#[cfg(test)]
mod tests;
