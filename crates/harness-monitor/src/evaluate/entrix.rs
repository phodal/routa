use anyhow::{anyhow, Context, Result};
use entrix::evidence::load_dimensions;
use entrix::governance::{filter_dimensions, GovernancePolicy};
use entrix::model::{Dimension, ExecutionScope, Metric, MetricResult, Tier};
use entrix::runner::ShellRunner;
use entrix::scoring::{score_dimension, score_report};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::Instant;

/// Minimum per-metric timeout (seconds) applied when `HARNESS_FAST_TIMEOUT_MS` is set.
/// Prevents very short timeouts from causing spurious metric failures.
const MIN_FAST_TIMEOUT_SECS: u64 = 5;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitnessMetricSummary {
    pub name: String,
    pub passed: bool,
    pub state: String,
    pub hard_gate: bool,
    pub duration_ms: f64,
    #[serde(default)]
    pub output_excerpt: Option<String>,
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
    #[serde(default)]
    pub coverage_summary: CoverageSummary,
    pub dimensions: Vec<FitnessDimensionSummary>,
    pub slowest_metrics: Vec<FitnessMetricSummary>,
    #[serde(default)]
    pub artifact_path: Option<String>,
    #[serde(default)]
    pub producer: Option<String>,
    #[serde(default)]
    pub generated_at_ms: Option<i64>,
    #[serde(default)]
    pub base_ref: Option<String>,
    #[serde(default)]
    pub changed_file_count: usize,
    #[serde(default)]
    pub changed_files_preview: Vec<String>,
    #[serde(default)]
    pub failing_metrics: Vec<FitnessMetricSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoverageSummary {
    #[serde(default)]
    pub generated_at_ms: Option<i64>,
    #[serde(default)]
    pub typescript: CoverageSourceSummary,
    #[serde(default)]
    pub rust: CoverageSourceSummary,
}

impl CoverageSummary {
    pub fn has_any_sampled_source(&self) -> bool {
        self.typescript.is_sampled() || self.rust.is_sampled()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoverageSourceSummary {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub generated_at_ms: Option<i64>,
    #[serde(default)]
    pub artifact_path: Option<String>,
    #[serde(default)]
    pub line_percent: Option<f64>,
    #[serde(default)]
    pub branch_percent: Option<f64>,
    #[serde(default)]
    pub function_percent: Option<f64>,
    #[serde(default)]
    pub statement_percent: Option<f64>,
    #[serde(default)]
    pub region_percent: Option<f64>,
}

impl CoverageSourceSummary {
    pub fn is_sampled(&self) -> bool {
        self.status == "sampled" && self.line_percent.is_some()
    }
}

pub fn run_fitness(repo_root: &str, mode: FitnessRunMode) -> Result<FitnessSnapshot> {
    let start = Instant::now();
    let root = Path::new(repo_root);
    let base_ref = upstream_or_main_ref(repo_root).ok();
    // Compute changed files once and reuse in rewrite_fast_metrics_for_watch to avoid
    // a redundant git diff call in fast mode.
    let changed_files = local_changed_files(repo_root).unwrap_or_default();
    let dimensions = load_dimensions(&root.join("docs/fitness"));
    if dimensions.is_empty() {
        return Err(anyhow!(
            "no fitness dimensions found under docs/fitness (expected fast local metrics)"
        ));
    }

    // Read env-var overrides for adaptive performance tuning.
    // HARNESS_PARALLEL_DIMENSIONS: max parallel dimension threads (default: unlimited).
    let parallel_limit: Option<usize> = std::env::var("HARNESS_PARALLEL_DIMENSIONS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|&n| n > 0);
    // HARNESS_FAST_TIMEOUT_MS: per-metric shell command timeout in fast mode (ms).
    let fast_timeout_ms: Option<u64> = std::env::var("HARNESS_FAST_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&n| n > 0);

    let policy = GovernancePolicy {
        tier_filter: match mode {
            FitnessRunMode::Fast => Some(Tier::Fast),
            FitnessRunMode::Full => None,
        },
        execution_scope: Some(ExecutionScope::Local),
        parallel: true,
        dry_run: false,
        verbose: false,
        min_score: 80.0,
        fail_on_hard_gate: true,
        dimension_filters: Vec::new(),
        metric_filters: Vec::new(),
    };
    // Reuse already-computed changed_files to avoid a second git diff.
    let dimensions = match mode {
        FitnessRunMode::Fast => rewrite_fast_metrics_with_changed_files(
            repo_root,
            filter_dimensions(&dimensions, &policy),
            &changed_files,
        ),
        FitnessRunMode::Full => filter_dimensions(&dimensions, &policy),
    };
    // Apply HARNESS_FAST_TIMEOUT_MS as a per-metric timeout (in seconds, capped at minimum MIN_FAST_TIMEOUT_SECS).
    // The env var is expressed in milliseconds for consistency with frontend metrics.
    let runner = if let Some(timeout_ms) = fast_timeout_ms.filter(|_| matches!(mode, FitnessRunMode::Fast)) {
        let timeout_secs = (timeout_ms / 1000).max(MIN_FAST_TIMEOUT_SECS);
        ShellRunner::new(root).with_timeout(timeout_secs)
    } else {
        ShellRunner::new(root)
    };
    let mut dim_summaries = Vec::new();
    let mut all_results = Vec::new();
    let mut coverage_metric_available = false;

    thread::scope(|scope| {
        // When HARNESS_PARALLEL_DIMENSIONS is set to N, process dimensions in batches of N
        // so that at most N dimension threads are active at any time.  When unset, all
        // dimensions are placed in one batch and run fully in parallel (original behavior).
        let chunk_size = parallel_limit.unwrap_or(dimensions.len()).max(1);
        for batch in dimensions.chunks(chunk_size) {
            let mut handles = Vec::new();
            for dim in batch {
                let name = dim.name.clone();
                let dim = dim.clone();
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
                            output_excerpt: summarize_metric_output(&result.output),
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
    let mut failing_metrics: Vec<FitnessMetricSummary> = dim_summaries
        .iter()
        .flat_map(|dim| dim.metrics.iter().cloned())
        .filter(|metric| metric.state != "pass" && metric.state != "waived")
        .collect();
    failing_metrics.sort_by(|a, b| {
        b.hard_gate
            .cmp(&a.hard_gate)
            .then_with(|| {
                b.duration_ms
                    .partial_cmp(&a.duration_ms)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| a.name.cmp(&b.name))
    });
    let report = score_report(&all_results, policy.min_score);
    let coverage_summary = load_coverage_summary(root);

    Ok(FitnessSnapshot {
        mode,
        final_score: report.final_score,
        hard_gate_blocked: report.hard_gate_blocked,
        score_blocked: report.score_blocked,
        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
        metric_count,
        coverage_metric_available,
        coverage_summary,
        dimensions: dim_summaries,
        slowest_metrics: slowest_metrics.into_iter().take(5).collect(),
        artifact_path: None,
        producer: Some("entrix".to_string()),
        generated_at_ms: Some(chrono::Utc::now().timestamp_millis()),
        base_ref,
        changed_file_count: changed_files.len(),
        changed_files_preview: changed_files.into_iter().take(8).collect(),
        failing_metrics: failing_metrics.into_iter().take(5).collect(),
    })
}

pub fn load_fitness_snapshot_artifact(path: &Path) -> Result<FitnessSnapshot> {
    let payload = fs::read_to_string(path)
        .with_context(|| format!("read fitness snapshot artifact {}", path.display()))?;
    let mut snapshot: FitnessSnapshot = serde_json::from_str(&payload)
        .with_context(|| format!("decode fitness snapshot artifact {}", path.display()))?;
    if snapshot.artifact_path.is_none() {
        snapshot.artifact_path = Some(path.to_string_lossy().to_string());
    }
    Ok(snapshot)
}

fn load_coverage_summary(repo_root: &Path) -> CoverageSummary {
    let summary_path = repo_root
        .join("target")
        .join("coverage")
        .join("fitness-summary.json");
    let Ok(payload) = fs::read_to_string(summary_path) else {
        return CoverageSummary::default();
    };
    let Ok(record) = serde_json::from_str::<CoverageSummaryRecord>(&payload) else {
        return CoverageSummary::default();
    };
    CoverageSummary {
        generated_at_ms: record.generated_at_ms,
        typescript: record.sources.typescript,
        rust: record.sources.rust,
    }
}

#[derive(Debug, Deserialize)]
struct CoverageSummaryRecord {
    #[serde(default)]
    generated_at_ms: Option<i64>,
    #[serde(default)]
    sources: CoverageSummarySources,
}

#[derive(Debug, Deserialize, Default)]
struct CoverageSummarySources {
    #[serde(default)]
    typescript: CoverageSourceSummary,
    #[serde(default)]
    rust: CoverageSourceSummary,
}

fn rewrite_fast_metrics_with_changed_files(
    repo_root: &str,
    dimensions: Vec<Dimension>,
    changed_files: &[String],
) -> Vec<Dimension> {
    if changed_files.is_empty() {
        return dimensions;
    }

    dimensions
        .into_iter()
        .map(|mut dimension| {
            dimension.metrics = dimension
                .metrics
                .into_iter()
                .map(|metric| rewrite_metric_for_changed_files(repo_root, metric, changed_files))
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

fn summarize_metric_output(output: &str) -> Option<String> {
    let lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    let mut excerpt = lines.join(" | ");
    if excerpt.chars().count() > 180 {
        excerpt = excerpt.chars().take(177).collect::<String>();
        excerpt.push_str("...");
    }
    Some(excerpt)
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

pub fn coverage_status_line(snapshot: &FitnessSnapshot) -> String {
    let ts = coverage_source_label("TS", &snapshot.coverage_summary.typescript);
    let rust = coverage_source_label("Rust", &snapshot.coverage_summary.rust);
    format!("{ts}  {rust}")
}

fn coverage_source_label(name: &str, source: &CoverageSourceSummary) -> String {
    if let Some(line_percent) = source.line_percent {
        return format!("{name} {line_percent:.1}%");
    }
    format!("{name} missing")
}

#[cfg(test)]
mod tests {
    use super::summarize_metric_output;

    #[test]
    fn summarize_metric_output_truncates_multibyte_text_on_char_boundary() {
        let output = format!("{}\n", "中文输出".repeat(80));

        let excerpt = summarize_metric_output(&output).expect("excerpt");

        assert!(excerpt.ends_with("..."));
        assert!(excerpt.chars().count() <= 180);
    }
}
