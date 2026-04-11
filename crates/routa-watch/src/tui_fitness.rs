use anyhow::{anyhow, Result};
use routa_entrix::evidence::load_dimensions;
use routa_entrix::governance::{filter_dimensions, GovernancePolicy};
use routa_entrix::model::{ExecutionScope, MetricResult, Tier};
use routa_entrix::runner::ShellRunner;
use routa_entrix::scoring::{score_dimension, score_report};
use std::cmp::Ordering;
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct FitnessMetricSummary {
    pub name: String,
    pub passed: bool,
    pub state: String,
    pub hard_gate: bool,
    pub duration_ms: f64,
}

#[derive(Debug, Clone)]
pub struct FitnessDimensionSummary {
    pub name: String,
    pub weight: i32,
    pub score: f64,
    pub passed: usize,
    pub total: usize,
    pub hard_gate_failures: Vec<String>,
    pub metrics: Vec<FitnessMetricSummary>,
}

#[derive(Debug, Clone)]
pub struct FitnessSnapshot {
    pub final_score: f64,
    pub hard_gate_blocked: bool,
    pub score_blocked: bool,
    pub duration_ms: f64,
    pub metric_count: usize,
    pub coverage_metric_available: bool,
    pub dimensions: Vec<FitnessDimensionSummary>,
    pub slowest_metrics: Vec<FitnessMetricSummary>,
}

impl FitnessSnapshot {
    pub fn has_coverage_metric(&self) -> bool {
        self.coverage_metric_available
    }
}

pub fn run_fast_fitness(repo_root: &str) -> Result<FitnessSnapshot> {
    let start = Instant::now();
    let root = Path::new(repo_root);
    let dimensions = load_dimensions(&root.join("docs/fitness"));
    if dimensions.is_empty() {
        return Err(anyhow!(
            "no fitness dimensions found under docs/fitness (expected fast local metrics)"
        ));
    }

    let policy = GovernancePolicy {
        tier_filter: Some(Tier::Fast),
        execution_scope: Some(ExecutionScope::Local),
        parallel: true,
        dry_run: false,
        verbose: false,
        min_score: 80.0,
        fail_on_hard_gate: true,
        dimension_filters: Vec::new(),
        metric_filters: Vec::new(),
    };
    let dimensions = filter_dimensions(&dimensions, &policy);
    let runner = ShellRunner::new(root);
    let mut dim_summaries = Vec::new();
    let mut all_results = Vec::new();
    let mut coverage_metric_available = false;

    for dim in dimensions {
        let metric_results: Vec<MetricResult> = if dim.metrics.is_empty() {
            Vec::new()
        } else {
            runner.run_batch(&dim.metrics, true, false, None)
        };
        let dimension_score = score_dimension(&metric_results, &dim.name, dim.weight);
        coverage_metric_available |= metric_results.iter().any(|metric| {
            metric.metric_name.to_lowercase().contains("coverage")
                || metric.metric_name.to_lowercase().contains("cover")
        });
        let metrics: Vec<FitnessMetricSummary> = metric_results
            .iter()
            .map(|result| FitnessMetricSummary {
                name: result.metric_name.clone(),
                passed: result.passed,
                state: result.state.as_str().to_string(),
                hard_gate: result.hard_gate,
                duration_ms: result.duration_ms,
            })
            .collect();
        all_results.push(dimension_score.clone());
        dim_summaries.push(FitnessDimensionSummary {
            name: dim.name,
            weight: dim.weight,
            score: dimension_score.score,
            passed: dimension_score.passed,
            total: dimension_score.total,
            hard_gate_failures: dimension_score.hard_gate_failures,
            metrics,
        });
    }

    let report = score_report(&all_results, policy.min_score);
    let metric_count: usize = dim_summaries
        .iter()
        .flat_map(|dim| dim.metrics.iter())
        .count();
    let mut slowest_metrics: Vec<FitnessMetricSummary> = dim_summaries
        .iter()
        .flat_map(|dim| dim.metrics.iter().cloned())
        .collect();
    slowest_metrics.sort_by(|a, b| {
        b.duration_ms
            .partial_cmp(&a.duration_ms)
            .unwrap_or(Ordering::Equal)
    });

    Ok(FitnessSnapshot {
        final_score: report.final_score,
        hard_gate_blocked: report.hard_gate_blocked,
        score_blocked: report.score_blocked,
        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
        metric_count,
        coverage_metric_available,
        dimensions: dim_summaries,
        slowest_metrics: slowest_metrics.into_iter().take(5).collect(),
    })
}

pub fn critical_metric_hint(snapshot: &FitnessSnapshot) -> String {
    let mut blocked = 0usize;
    let mut unknown = 0usize;
    for dim in &snapshot.dimensions {
        for metric in &dim.metrics {
            match metric.state.as_str() {
                "fail" => {
                    blocked += 1;
                }
                "unknown" => {
                    unknown += 1;
                }
                _ => {}
            }
        }
    }

    let mut lines = Vec::new();
    if blocked > 0 {
        lines.push(format!("{blocked} failed metrics"));
    }
    if unknown > 0 {
        lines.push(format!("{unknown} metrics uncertain"));
    }
    if lines.is_empty() {
        lines.push("all sampled metrics are pass or waived".to_string());
    }
    lines.join(", ")
}

pub fn passed_metric_count(snapshot: &FitnessSnapshot) -> usize {
    snapshot
        .dimensions
        .iter()
        .flat_map(|dim| dim.metrics.iter())
        .filter(|metric| matches!(metric.state.as_str(), "pass" | "waived"))
        .count()
}
