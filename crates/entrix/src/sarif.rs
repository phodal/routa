use crate::model::{Gate, Metric, MetricResult, ResultState};
use crate::run_deadline::{DeadlineBudget, RunDeadline};
use crate::runner::support::{augment_runner_path, run_command_with_timeout, smart_truncate};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::time::Instant;

pub struct SarifRunner {
    project_root: PathBuf,
    timeout: u64,
    env_overrides: HashMap<String, String>,
    deadline: Option<RunDeadline>,
}

impl SarifRunner {
    pub fn new(project_root: &Path) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            timeout: 300,
            env_overrides: HashMap::new(),
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

    pub fn with_deadline(mut self, deadline: Option<RunDeadline>) -> Self {
        self.deadline = deadline;
        self
    }

    pub fn run(&self, metric: &Metric, dry_run: bool) -> MetricResult {
        if let Some(ref waiver) = metric.waiver {
            if waiver.is_active(None) {
                return MetricResult::new(
                    metric.name.clone(),
                    true,
                    format!("[WAIVED] {}", waiver.reason),
                    metric.tier,
                )
                .with_hard_gate(metric.gate == Gate::Hard)
                .with_state(ResultState::Waived);
            }
        }

        if dry_run {
            return MetricResult::new(
                metric.name.clone(),
                true,
                format!("[DRY-RUN] Would read SARIF evidence: {}", metric.command),
                metric.tier,
            )
            .with_hard_gate(metric.gate == Gate::Hard);
        }

        let start = Instant::now();
        let configured_timeout =
            Duration::from_secs(metric.timeout_seconds.unwrap_or(self.timeout));
        let timeout_budget = self
            .deadline
            .as_ref()
            .map(|deadline| deadline.budget_for(configured_timeout))
            .unwrap_or(DeadlineBudget {
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

        match self.load_payload(metric, timeout_budget) {
            Ok(SarifLoadOutcome::Payload(payload)) => match summarize_sarif(&payload) {
                Ok(summary) => {
                    let summary_line = format!(
                        "sarif_runs={} sarif_results={} sarif_errors={} sarif_warnings={} sarif_notes={}",
                        summary.runs, summary.results, summary.errors, summary.warnings, summary.notes
                    );
                    let passed = if metric.pattern.is_empty() {
                        summary.errors == 0
                    } else {
                        Regex::new(&metric.pattern)
                            .map(|re| re.is_match(&summary_line))
                            .unwrap_or(false)
                    };
                    MetricResult::new(metric.name.clone(), passed, summary_line, metric.tier)
                        .with_hard_gate(metric.gate == Gate::Hard)
                        .with_duration_ms(start.elapsed().as_secs_f64() * 1000.0)
                }
                Err(error) => MetricResult::new(
                    metric.name.clone(),
                    false,
                    format!("SARIF parse error: {error}"),
                    metric.tier,
                )
                .with_hard_gate(metric.gate == Gate::Hard)
                .with_duration_ms(start.elapsed().as_secs_f64() * 1000.0)
                .with_state(ResultState::Unknown),
            },
            Ok(SarifLoadOutcome::TimedOut(output)) => {
                MetricResult::new(metric.name.clone(), false, output, metric.tier)
                    .with_hard_gate(metric.gate == Gate::Hard)
                    .with_duration_ms(start.elapsed().as_secs_f64() * 1000.0)
            }
            Err(error) => MetricResult::new(
                metric.name.clone(),
                false,
                format!("SARIF parse error: {error}"),
                metric.tier,
            )
            .with_hard_gate(metric.gate == Gate::Hard)
            .with_duration_ms(start.elapsed().as_secs_f64() * 1000.0)
            .with_state(ResultState::Unknown),
        }
    }

    pub fn run_batch(&self, metrics: &[Metric], dry_run: bool) -> Vec<MetricResult> {
        metrics
            .iter()
            .map(|metric| self.run(metric, dry_run))
            .collect()
    }

    fn load_payload(
        &self,
        metric: &Metric,
        timeout_budget: DeadlineBudget,
    ) -> Result<SarifLoadOutcome, String> {
        let candidate = self.project_root.join(&metric.command);
        if candidate.is_file() {
            let content = std::fs::read_to_string(&candidate)
                .map_err(|error| format!("failed to read {}: {error}", candidate.display()))?;
            return serde_json::from_str::<Value>(&content)
                .map(SarifLoadOutcome::Payload)
                .map_err(|error| format!("invalid JSON: {error}"));
        }

        let mut env: HashMap<String, String> = std::env::vars().collect();
        env.extend(self.env_overrides.clone());
        augment_runner_path(&mut env);

        let command_result = run_command_with_timeout(
            &metric.command,
            &self.project_root,
            &env,
            timeout_budget.timeout,
            None,
            metric,
        )
        .map_err(|error| format!("failed to execute command: {error}"))?;

        let stdout = String::from_utf8_lossy(&command_result.output.stdout);
        let stderr = String::from_utf8_lossy(&command_result.output.stderr);
        let combined = format!("{stdout}{stderr}");
        if command_result.timed_out {
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
            let truncated = smart_truncate(&combined, 4000, 4000);
            let output = if truncated.trim().is_empty() {
                timeout_header
            } else {
                format!("{timeout_header}\n{truncated}")
            };
            return Ok(SarifLoadOutcome::TimedOut(output));
        }

        parse_json_from_text(&stdout).map(SarifLoadOutcome::Payload)
    }
}

enum SarifLoadOutcome {
    Payload(Value),
    TimedOut(String),
}

struct SarifSummary {
    runs: usize,
    results: usize,
    errors: usize,
    warnings: usize,
    notes: usize,
}

fn parse_json_from_text(text: &str) -> Result<Value, String> {
    let stripped = text.trim();
    if stripped.is_empty() {
        return Err("empty stdout".to_string());
    }
    serde_json::from_str(stripped).or_else(|_| {
        let Some(start) = stripped.find('{') else {
            return Err("stdout did not contain JSON object".to_string());
        };
        let Some(end) = stripped.rfind('}') else {
            return Err("stdout did not contain JSON object".to_string());
        };
        serde_json::from_str(&stripped[start..=end]).map_err(|error| error.to_string())
    })
}

fn summarize_sarif(payload: &Value) -> Result<SarifSummary, String> {
    let Some(runs) = payload.get("runs").and_then(Value::as_array) else {
        return Err("SARIF payload missing runs[]".to_string());
    };

    let mut summary = SarifSummary {
        runs: runs.len(),
        results: 0,
        errors: 0,
        warnings: 0,
        notes: 0,
    };

    for run in runs {
        let Some(results) = run.get("results").and_then(Value::as_array) else {
            continue;
        };
        summary.results += results.len();
        for result in results {
            let level = result
                .get("level")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            match level.as_str() {
                "error" => summary.errors += 1,
                "note" => summary.notes += 1,
                _ => summary.warnings += 1,
            }
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Metric, ResultState, Tier};

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn sarif_runner_passes_when_no_error_results() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            &tmp.path().join("reports/ok.sarif"),
            r#"{
  "version": "2.1.0",
  "runs": [
    {
      "results": [{"level": "warning"}, {"level": "note"}]
    }
  ]
}"#,
        );
        let runner = SarifRunner::new(tmp.path());
        let result = runner.run(&Metric::new("sarif_ok", "reports/ok.sarif"), false);
        assert!(result.passed);
        assert_eq!(result.state, ResultState::Pass);
        assert!(result.output.contains("sarif_errors=0"));
        assert!(result.output.contains("sarif_warnings=1"));
        assert!(result.output.contains("sarif_notes=1"));
    }

    #[test]
    fn sarif_runner_fails_when_error_results_exist() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            &tmp.path().join("reports/fail.sarif"),
            r#"{
  "version": "2.1.0",
  "runs": [
    {
      "results": [{"level": "error"}, {"level": "warning"}]
    }
  ]
}"#,
        );
        let runner = SarifRunner::new(tmp.path());
        let result = runner.run(&Metric::new("sarif_fail", "reports/fail.sarif"), false);
        assert!(!result.passed);
        assert_eq!(result.state, ResultState::Fail);
        assert!(result.output.contains("sarif_errors=1"));
    }

    #[test]
    fn sarif_runner_uses_pattern_for_custom_policy() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            &tmp.path().join("reports/warn.sarif"),
            r#"{
  "version": "2.1.0",
  "runs": [
    {"results": [{"level": "warning"}]}
  ]
}"#,
        );
        let runner = SarifRunner::new(tmp.path());
        let mut metric = Metric::new("sarif_pattern", "reports/warn.sarif");
        metric.pattern = r"sarif_warnings=0".to_string();
        metric.tier = Tier::Normal;
        let result = runner.run(&metric, false);
        assert!(!result.passed);
        assert_eq!(result.state, ResultState::Fail);
    }

    #[test]
    fn sarif_runner_returns_unknown_for_invalid_payload() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("reports/broken.sarif"), "{ not-json");
        let runner = SarifRunner::new(tmp.path());
        let result = runner.run(&Metric::new("sarif_unknown", "reports/broken.sarif"), false);
        assert!(!result.passed);
        assert_eq!(result.state, ResultState::Unknown);
        assert!(result.output.contains("SARIF parse error"));
    }

    #[test]
    #[cfg(unix)]
    fn sarif_runner_times_out_command_execution() {
        let tmp = tempfile::tempdir().unwrap();
        let runner = SarifRunner::new(tmp.path()).with_timeout(1);
        let metric = Metric::new(
            "sarif_timeout",
            "sleep 2; echo '{\"runs\":[{\"results\":[]}]}'",
        );
        let result = runner.run(&metric, false);
        assert!(!result.passed);
        assert_eq!(result.state, ResultState::Fail);
        assert!(result.output.contains("TIMEOUT"));
    }
}
