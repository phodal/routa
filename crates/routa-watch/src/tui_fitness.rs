use anyhow::{anyhow, Context, Result};
use routa_entrix::evidence::load_dimensions;
use routa_entrix::governance::{filter_dimensions, GovernancePolicy};
use routa_entrix::model::{Dimension, ExecutionScope, Metric, MetricResult, Tier};
use routa_entrix::runner::ShellRunner;
use routa_entrix::scoring::{score_dimension, score_report};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::path::Path;
use std::thread;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitnessRunMode {
    Fast,
    Full,
}

impl FitnessRunMode {
    pub fn as_str(self) -> &'static str {
        match self {
            FitnessRunMode::Fast => "fast",
            FitnessRunMode::Full => "full",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            FitnessRunMode::Fast => "Entrix Fast",
            FitnessRunMode::Full => "Entrix Full",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitnessMetricSummary {
    pub name: String,
    pub passed: bool,
    pub state: String,
    pub hard_gate: bool,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitnessDimensionSummary {
    pub name: String,
    pub weight: i32,
    pub score: f64,
    pub passed: usize,
    pub total: usize,
    pub hard_gate_failures: Vec<String>,
    pub metrics: Vec<FitnessMetricSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitnessSnapshot {
    pub mode: FitnessRunMode,
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

pub fn run_fitness(repo_root: &str, mode: FitnessRunMode) -> Result<FitnessSnapshot> {
    let start = Instant::now();
    let root = Path::new(repo_root);
    let dimensions = load_dimensions(&root.join("docs/fitness"));
    if dimensions.is_empty() {
        return Err(anyhow!(
            "no fitness dimensions found under docs/fitness (expected fast local metrics)"
        ));
    }

    let policy = GovernancePolicy {
        tier_filter: Some(match mode {
            FitnessRunMode::Fast => Tier::Fast,
            FitnessRunMode::Full => Tier::Deep,
        }),
        execution_scope: Some(ExecutionScope::Local),
        parallel: true,
        dry_run: false,
        verbose: false,
        min_score: 80.0,
        fail_on_hard_gate: true,
        dimension_filters: Vec::new(),
        metric_filters: Vec::new(),
    };
    let dimensions = match mode {
        FitnessRunMode::Fast => {
            rewrite_fast_metrics_for_watch(repo_root, filter_dimensions(&dimensions, &policy))
        }
        FitnessRunMode::Full => filter_dimensions(&dimensions, &policy),
    };
    let runner = ShellRunner::new(root);
    let mut dim_summaries = Vec::new();
    let mut all_results = Vec::new();
    let mut coverage_metric_available = false;

    thread::scope(|scope| {
        let mut handles = Vec::new();
        for dim in dimensions {
            let name = dim.name.clone();
            let runner = &runner;
            handles.push(scope.spawn(move || {
                let metric_results: Vec<MetricResult> = if dim.metrics.is_empty() {
                    Vec::new()
                } else {
                    runner.run_batch(&dim.metrics, true, false, None)
                };
                let dimension_score = score_dimension(&metric_results, &dim.name, dim.weight);
                let has_coverage_metric = metric_results.iter().any(|metric| {
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
                (
                    name,
                    dim.weight,
                    dimension_score,
                    has_coverage_metric,
                    metrics,
                )
            }));
        }

        for handle in handles {
            let (name, weight, dimension_score, has_coverage_metric, metrics) =
                handle.join().expect("dimension fitness worker panicked");
            coverage_metric_available |= has_coverage_metric;
            let passed = dimension_score.passed;
            let total = dimension_score.total;
            all_results.push(dimension_score.clone());
            dim_summaries.push(FitnessDimensionSummary {
                name,
                weight,
                score: dimension_score.score,
                passed,
                total,
                hard_gate_failures: dimension_score.hard_gate_failures,
                metrics,
            });
        }
    });

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
    let report = score_report(&all_results, policy.min_score);

    Ok(FitnessSnapshot {
        mode,
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

fn rewrite_fast_metrics_for_watch(repo_root: &str, dimensions: Vec<Dimension>) -> Vec<Dimension> {
    let changed_files = local_changed_files(repo_root).unwrap_or_default();
    if changed_files.is_empty() {
        return dimensions;
    }

    dimensions
        .into_iter()
        .map(|mut dimension| {
            dimension.metrics = dimension
                .metrics
                .into_iter()
                .map(|metric| rewrite_metric_for_changed_files(repo_root, metric, &changed_files))
                .collect();
            dimension
        })
        .collect()
}

fn rewrite_metric_for_changed_files(
    repo_root: &str,
    mut metric: Metric,
    changed_files: &[String],
) -> Metric {
    match metric.name.as_str() {
        "eslint_pass" => {
            let lintable = changed_files
                .iter()
                .filter(|path| is_eslint_target(path))
                .cloned()
                .collect::<Vec<_>>();
            if !lintable.is_empty() {
                metric.command = format!(
                    "npx eslint {} 2>&1",
                    lintable
                        .iter()
                        .map(|path| shell_quote(path))
                        .collect::<Vec<_>>()
                        .join(" ")
                );
            } else {
                metric.command = "printf 'No changed lintable files\\n'".to_string();
            }
        }
        "clippy_pass" => {
            let crates = changed_files
                .iter()
                .filter(|path| is_rust_target(path))
                .filter_map(|path| {
                    cargo_package_for_changed_file(repo_root, path)
                        .ok()
                        .flatten()
                })
                .collect::<BTreeSet<_>>();
            if crates.is_empty() {
                metric.command = "printf 'No changed Rust crates\\n'".to_string();
            } else {
                let packages = crates
                    .iter()
                    .map(|package| format!("-p {}", shell_quote(package)))
                    .collect::<Vec<_>>()
                    .join(" ");
                metric.command = format!("cargo clippy {packages} -- -D warnings 2>&1");
            }
        }
        _ => {}
    }
    metric
}

fn local_changed_files(repo_root: &str) -> Result<Vec<String>> {
    let base_ref = upstream_or_main_ref(repo_root).unwrap_or_else(|_| "HEAD".to_string());
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--name-only")
        .arg("--diff-filter=ACMR")
        .arg(base_ref)
        .output()
        .context("list changed files for incremental fast fitness")?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8(output.stdout)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .collect())
}

fn upstream_or_main_ref(repo_root: &str) -> Result<String> {
    let upstream = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("@{upstream}")
        .output();
    if let Ok(output) = upstream {
        if output.status.success() {
            let value = String::from_utf8(output.stdout)
                .unwrap_or_default()
                .trim()
                .to_string();
            if !value.is_empty() {
                return Ok(value);
            }
        }
    }

    for candidate in ["origin/main", "main", "origin/master", "master"] {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_root)
            .arg("rev-parse")
            .arg("--verify")
            .arg(candidate)
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                return Ok(candidate.to_string());
            }
        }
    }

    Ok("HEAD".to_string())
}

fn is_eslint_target(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|ext| ext.to_str()),
        Some("js" | "jsx" | "ts" | "tsx" | "cjs" | "mjs")
    )
}

fn is_rust_target(path: &str) -> bool {
    path.ends_with(".rs") || path.ends_with("Cargo.toml")
}

fn cargo_package_for_changed_file(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let mut current = Path::new(repo_root).join(rel_path);
    if current.is_file() {
        current.pop();
    }

    while current.starts_with(repo_root) {
        let manifest = current.join("Cargo.toml");
        if manifest.exists() {
            return package_name_from_manifest(&manifest).map(Some);
        }
        if !current.pop() {
            break;
        }
    }

    Ok(None)
}

fn package_name_from_manifest(manifest: &Path) -> Result<String> {
    let content = std::fs::read_to_string(manifest)
        .with_context(|| format!("read cargo manifest {}", manifest.display()))?;
    let mut in_package = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package && trimmed.starts_with("name") {
            let Some((_, value)) = trimmed.split_once('=') else {
                continue;
            };
            return Ok(value.trim().trim_matches('"').to_string());
        }
    }
    Err(anyhow!("package name missing in {}", manifest.display()))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
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
