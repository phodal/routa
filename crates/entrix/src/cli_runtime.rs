use entrix::model::{Dimension, FitnessReport, Metric};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn collect_run_files(
    repo_root: &Path,
    files: &[String],
    changed_only: bool,
    base: &str,
) -> Vec<String> {
    if !files.is_empty() {
        return files.to_vec();
    }
    if !changed_only {
        return Vec::new();
    }

    let commands = [
        vec!["diff", "--name-only", "--diff-filter=ACMR", base],
        vec!["diff", "--name-only", "--diff-filter=ACMR", "--cached"],
    ];
    let mut seen = BTreeSet::new();
    let mut changed = Vec::new();

    for command_args in commands {
        let output = std::process::Command::new("git")
            .args(command_args)
            .current_dir(repo_root)
            .output();
        let Ok(output) = output else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let path = line.trim();
            if path.is_empty() || should_ignore_changed_file(path) || !seen.insert(path.to_string())
            {
                continue;
            }
            changed.push(path.to_string());
        }
    }

    changed
}

fn should_ignore_changed_file(file_path: &str) -> bool {
    file_path.starts_with("tmp/")
        || file_path.starts_with("docs/")
        || file_path.starts_with(".entrix/")
        || file_path.starts_with(".code-review-graph/")
        || file_path.starts_with("node_modules/")
}

pub(crate) fn domains_from_files(files: &[String]) -> BTreeSet<String> {
    let config_files = BTreeSet::from([
        "package.json",
        "package-lock.json",
        "Cargo.toml",
        "Cargo.lock",
        "api-contract.yaml",
        "eslint.config.mjs",
        "tsconfig.json",
        "pyproject.toml",
        "docs/fitness/file_budgets.json",
    ]);

    let mut domains = BTreeSet::new();
    for file_path in files {
        let lowered = file_path.to_lowercase();
        let path = Path::new(file_path);
        let suffix = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();

        if suffix == "rs" || lowered.starts_with("crates/") {
            domains.insert("rust".to_string());
        }
        if matches!(suffix, "ts" | "tsx" | "js" | "jsx" | "css" | "scss")
            || lowered.starts_with("src/")
            || lowered.starts_with("apps/")
        {
            domains.insert("web".to_string());
        }
        if suffix == "py" {
            domains.insert("python".to_string());
        }
        if config_files.contains(file_path.as_str()) || config_files.contains(name) {
            domains.insert("config".to_string());
        }
    }
    domains
}

fn metric_domains(metric: &Metric) -> BTreeSet<String> {
    if !metric.scope.is_empty() {
        return metric.scope.iter().cloned().collect();
    }

    let command = metric.command.to_lowercase();
    let mut domains = BTreeSet::new();

    if command.contains("cargo ") || command.contains("clippy") || command.contains("rust") {
        domains.insert("rust".to_string());
    }
    if [
        "npm ",
        "npx ",
        "eslint",
        "vitest",
        "playwright",
        "jscpd",
        "dependency-cruiser",
        "ast-grep",
        " semgrep",
        "semgrep ",
    ]
    .iter()
    .any(|token| command.contains(token))
    {
        domains.insert("web".to_string());
    }
    if command.contains("python") || command.contains("pytest") || command.contains("entrix") {
        domains.insert("python".to_string());
    }
    if command.contains("audit") {
        domains.insert("config".to_string());
    }

    if domains.is_empty() {
        domains.insert("global".to_string());
    }
    domains
}

fn matches_changed_files(
    metric: &Metric,
    changed_files: &[String],
    domains: &BTreeSet<String>,
) -> bool {
    if !metric.run_when_changed.is_empty() {
        return changed_files.iter().any(|changed_file| {
            metric.run_when_changed.iter().any(|pattern| {
                glob::Pattern::new(pattern)
                    .map(|p| p.matches(changed_file))
                    .unwrap_or(false)
            })
        });
    }
    if domains.is_empty() {
        return false;
    }
    if domains.contains("config") {
        return true;
    }
    let metric_domains = metric_domains(metric);
    metric_domains.contains("global") || !metric_domains.is_disjoint(domains)
}

pub(crate) fn filter_dimensions_for_incremental(
    dimensions: &[Dimension],
    changed_files: &[String],
    domains: &BTreeSet<String>,
) -> Vec<Dimension> {
    if changed_files.is_empty() {
        return Vec::new();
    }
    if domains.contains("config") {
        return dimensions.to_vec();
    }

    dimensions
        .iter()
        .filter_map(|dimension| {
            let metrics = dimension
                .metrics
                .iter()
                .filter(|metric| matches_changed_files(metric, changed_files, domains))
                .cloned()
                .collect::<Vec<_>>();
            if metrics.is_empty() {
                return None;
            }
            Some(Dimension {
                name: dimension.name.clone(),
                weight: dimension.weight,
                threshold_pass: dimension.threshold_pass,
                threshold_warn: dimension.threshold_warn,
                metrics,
                source_file: dimension.source_file.clone(),
            })
        })
        .collect()
}

pub(crate) fn build_runner_env(
    changed_files: &[String],
    base: &str,
) -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    if !changed_files.is_empty() {
        env.insert("ROUTA_FITNESS_CHANGED_ONLY".to_string(), "1".to_string());
        env.insert("ROUTA_FITNESS_CHANGED_BASE".to_string(), base.to_string());
        env.insert(
            "ROUTA_FITNESS_CHANGED_FILES".to_string(),
            changed_files.join("\n"),
        );
    }
    env
}

fn runtime_marker(project_root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_root.to_string_lossy().as_bytes());
    hex::encode(hasher.finalize())
}

fn runtime_root(project_root: &Path) -> PathBuf {
    Path::new("/tmp")
        .join("harness-monitor")
        .join("runtime")
        .join(runtime_marker(project_root))
}

fn runtime_event_path(project_root: &Path) -> PathBuf {
    runtime_root(project_root).join("events.jsonl")
}

fn runtime_fitness_artifact_dir(project_root: &Path) -> PathBuf {
    runtime_root(project_root).join("artifacts").join("fitness")
}

fn runtime_fitness_mailbox_dir(project_root: &Path) -> PathBuf {
    runtime_root(project_root)
        .join("mailbox")
        .join("fitness")
        .join("new")
}

pub(crate) fn runtime_mode(tier: Option<&str>) -> String {
    match tier {
        None | Some("") | Some("normal") => "full".to_string(),
        Some(value) => value.to_string(),
    }
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn load_runtime_coverage_summary(project_root: &Path) -> serde_json::Value {
    let summary_path = project_root
        .join("target")
        .join("coverage")
        .join("fitness-summary.json");
    let default = json!({
        "generated_at_ms": serde_json::Value::Null,
        "typescript": {},
        "rust": {},
    });
    let Ok(contents) = fs::read_to_string(summary_path) else {
        return default;
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return default;
    };
    let sources = payload
        .get("sources")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    json!({
        "generated_at_ms": payload.get("generated_at_ms").cloned().unwrap_or(serde_json::Value::Null),
        "typescript": sources.get("typescript").cloned().unwrap_or_else(|| json!({})),
        "rust": sources.get("rust").cloned().unwrap_or_else(|| json!({})),
    })
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
        excerpt = excerpt.chars().take(177).collect::<String>() + "...";
    }
    Some(excerpt)
}

pub(crate) struct RuntimeFitnessSnapshotOptions<'a> {
    pub(crate) tier: Option<&'a str>,
    pub(crate) duration_ms: f64,
    pub(crate) artifact_path: Option<&'a str>,
    pub(crate) observed_at_ms: i64,
    pub(crate) producer: &'a str,
    pub(crate) base_ref: Option<&'a str>,
    pub(crate) changed_files: &'a [String],
}

pub(crate) fn build_runtime_fitness_snapshot(
    project_root: &Path,
    report: &FitnessReport,
    options: RuntimeFitnessSnapshotOptions<'_>,
) -> Option<serde_json::Value> {
    let mut dimensions = Vec::new();
    let mut slowest_metrics = Vec::new();
    let mut failing_metrics = Vec::new();
    let mut coverage_metric_available = false;

    for dimension_score in &report.dimensions {
        let mut metrics = Vec::new();
        for result in &dimension_score.results {
            let metric_summary = json!({
                "name": result.metric_name,
                "passed": result.passed,
                "state": result.state.as_str(),
                "hard_gate": result.hard_gate,
                "duration_ms": result.duration_ms,
                "output_excerpt": summarize_metric_output(&result.output),
            });
            metrics.push(metric_summary.clone());
            slowest_metrics.push(metric_summary.clone());
            if result.state.as_str() != "pass" && result.state.as_str() != "waived" {
                failing_metrics.push(metric_summary);
            }
            coverage_metric_available = coverage_metric_available
                || result.metric_name.to_lowercase().contains("coverage")
                || result.metric_name.to_lowercase().contains("cover");
        }
        dimensions.push(json!({
            "name": dimension_score.dimension,
            "weight": dimension_score.weight,
            "score": dimension_score.score,
            "passed": dimension_score.passed,
            "total": dimension_score.total,
            "hard_gate_failures": dimension_score.hard_gate_failures,
            "metrics": metrics,
        }));
    }

    slowest_metrics.sort_by(|left, right| {
        let left = left
            .get("duration_ms")
            .and_then(|value| value.as_f64())
            .unwrap_or_default();
        let right = right
            .get("duration_ms")
            .and_then(|value| value.as_f64())
            .unwrap_or_default();
        right
            .partial_cmp(&left)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    failing_metrics.sort_by(|left, right| {
        let left_hard = left
            .get("hard_gate")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let right_hard = right
            .get("hard_gate")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let left_duration = left
            .get("duration_ms")
            .and_then(|value| value.as_f64())
            .unwrap_or_default();
        let right_duration = right
            .get("duration_ms")
            .and_then(|value| value.as_f64())
            .unwrap_or_default();
        let left_name = left
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let right_name = right
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        (!left_hard, -left_duration as i64, left_name).cmp(&(
            !right_hard,
            -right_duration as i64,
            right_name,
        ))
    });

    Some(json!({
        "mode": runtime_mode(options.tier),
        "final_score": report.final_score,
        "hard_gate_blocked": report.hard_gate_blocked,
        "score_blocked": report.score_blocked,
        "duration_ms": options.duration_ms,
        "metric_count": report.dimensions.iter().map(|dimension| dimension.results.len()).sum::<usize>(),
        "coverage_metric_available": coverage_metric_available,
        "coverage_summary": load_runtime_coverage_summary(project_root),
        "dimensions": dimensions,
        "slowest_metrics": slowest_metrics.into_iter().take(5).collect::<Vec<_>>(),
        "artifact_path": options.artifact_path,
        "producer": options.producer,
        "generated_at_ms": options.observed_at_ms,
        "base_ref": options.base_ref,
        "changed_file_count": options.changed_files.len(),
        "changed_files_preview": options.changed_files.iter().take(8).cloned().collect::<Vec<_>>(),
        "failing_metrics": failing_metrics.into_iter().take(5).collect::<Vec<_>>(),
    }))
}

pub(crate) fn write_runtime_fitness_artifacts(
    project_root: &Path,
    tier: Option<&str>,
    snapshot: &serde_json::Value,
    observed_at_ms: i64,
) -> io::Result<String> {
    let artifact_dir = runtime_fitness_artifact_dir(project_root);
    fs::create_dir_all(&artifact_dir)?;
    let mode = runtime_mode(tier);
    let artifact_path = artifact_dir.join(format!("{observed_at_ms}-{mode}.json"));
    let latest_path = artifact_dir.join(format!("latest-{mode}.json"));
    let latest_temp_path = artifact_dir.join(format!(
        "latest-{mode}.json.tmp-{}-{}",
        observed_at_ms,
        std::process::id()
    ));
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(snapshot).map_err(io::Error::other)?
    );
    fs::write(&artifact_path, &serialized)?;
    fs::write(&latest_temp_path, &serialized)?;
    if let Err(error) = fs::rename(&latest_temp_path, &latest_path) {
        let _ = fs::remove_file(&latest_temp_path);
        return Err(error);
    }
    Ok(artifact_path.display().to_string())
}

fn write_runtime_fitness_mailbox_message(
    project_root: &Path,
    payload: &serde_json::Value,
) -> io::Result<()> {
    let mailbox_dir = runtime_fitness_mailbox_dir(project_root);
    fs::create_dir_all(&mailbox_dir)?;
    let observed_at_ms = payload
        .get("observed_at_ms")
        .and_then(|value| value.as_i64())
        .unwrap_or_default();
    let mode = payload
        .get("mode")
        .and_then(|value| value.as_str())
        .unwrap_or("full");
    let mailbox_path = mailbox_dir.join(format!("{observed_at_ms}-{mode}.json"));
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(payload).map_err(io::Error::other)?
    );
    fs::write(mailbox_path, serialized)
}

pub(crate) struct RuntimeFitnessEventOptions<'a> {
    pub(crate) metric_count: usize,
    pub(crate) duration_ms: f64,
    pub(crate) artifact_path: Option<&'a str>,
    pub(crate) write_mailbox_message: bool,
}

pub(crate) fn emit_runtime_fitness_event(
    project_root: &Path,
    status: &str,
    tier: Option<&str>,
    report: Option<&FitnessReport>,
    options: RuntimeFitnessEventOptions<'_>,
) -> io::Result<()> {
    let event_path = runtime_event_path(project_root);
    if let Some(parent) = event_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = json!({
        "type": "fitness",
        "repo_root": project_root.display().to_string(),
        "observed_at_ms": now_millis(),
        "mode": runtime_mode(tier),
        "status": status,
        "final_score": report.map(|report| report.final_score),
        "hard_gate_blocked": report.map(|report| report.hard_gate_blocked),
        "score_blocked": report.map(|report| report.score_blocked),
        "duration_ms": options.duration_ms,
        "dimension_count": report.map(|report| report.dimensions.len()),
        "metric_count": options.metric_count,
        "artifact_path": options.artifact_path,
    });

    let mut handle = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(event_path)?;
    writeln!(
        handle,
        "{}",
        serde_json::to_string(&payload).map_err(io::Error::other)?
    )?;
    if options.write_mailbox_message {
        write_runtime_fitness_mailbox_message(project_root, &payload)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use entrix::model::{MetricResult, Tier};
    use entrix::scoring::{score_dimension, score_report};
    use tempfile::tempdir;

    #[test]
    fn runtime_mode_defaults_normal_to_full() {
        assert_eq!(runtime_mode(None), "full");
        assert_eq!(runtime_mode(Some("")), "full");
        assert_eq!(runtime_mode(Some("normal")), "full");
        assert_eq!(runtime_mode(Some("fast")), "fast");
    }

    #[test]
    fn runtime_event_writes_jsonl_and_mailbox_message() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        let results = vec![MetricResult::new("eslint_pass", true, "ok", Tier::Fast)];
        let dimension = score_dimension(&results, "testability", 18);
        let report = score_report(&[dimension], 80.0);

        let snapshot = build_runtime_fitness_snapshot(
            repo_root,
            &report,
            RuntimeFitnessSnapshotOptions {
                tier: Some("fast"),
                duration_ms: 12.5,
                artifact_path: None,
                observed_at_ms: 1_717_171_717_000,
                producer: "entrix",
                base_ref: None,
                changed_files: &[],
            },
        )
        .expect("snapshot");
        let artifact_path =
            write_runtime_fitness_artifacts(repo_root, Some("fast"), &snapshot, 1_717_171_717_000)
                .expect("artifact");

        emit_runtime_fitness_event(
            repo_root,
            "passed",
            Some("fast"),
            Some(&report),
            RuntimeFitnessEventOptions {
                metric_count: 1,
                duration_ms: 12.5,
                artifact_path: Some(&artifact_path),
                write_mailbox_message: true,
            },
        )
        .expect("runtime event");

        let events_path = runtime_event_path(repo_root);
        assert!(events_path.is_file());
        let events = fs::read_to_string(&events_path).expect("events jsonl");
        let payload = events
            .lines()
            .last()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("json event"))
            .expect("event payload");
        assert_eq!(
            payload.get("type").and_then(|v| v.as_str()),
            Some("fitness")
        );
        assert_eq!(payload.get("mode").and_then(|v| v.as_str()), Some("fast"));
        assert_eq!(
            payload.get("status").and_then(|v| v.as_str()),
            Some("passed")
        );
        assert_eq!(
            payload.get("final_score").and_then(|v| v.as_f64()),
            Some(100.0)
        );
        assert_eq!(
            payload.get("artifact_path").and_then(|v| v.as_str()),
            Some(artifact_path.as_str())
        );

        let mailbox_dir = runtime_fitness_mailbox_dir(repo_root);
        let mailbox_messages = fs::read_dir(mailbox_dir)
            .expect("mailbox dir")
            .collect::<Result<Vec<_>, _>>()
            .expect("mailbox entries");
        assert_eq!(mailbox_messages.len(), 1);
    }

    #[test]
    fn runtime_artifact_updates_latest_snapshot_without_leaking_temp_files() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();

        write_runtime_fitness_artifacts(
            repo_root,
            Some("fast"),
            &json!({
                "generated_at_ms": 1i64,
                "final_score": 80.0,
            }),
            1,
        )
        .expect("first artifact");
        write_runtime_fitness_artifacts(
            repo_root,
            Some("fast"),
            &json!({
                "generated_at_ms": 2i64,
                "final_score": 91.0,
            }),
            2,
        )
        .expect("second artifact");

        let artifact_dir = runtime_fitness_artifact_dir(repo_root);
        let latest = fs::read_to_string(artifact_dir.join("latest-fast.json")).expect("latest");
        let latest_payload =
            serde_json::from_str::<serde_json::Value>(&latest).expect("latest json");
        assert_eq!(latest_payload["generated_at_ms"].as_i64(), Some(2));
        assert_eq!(latest_payload["final_score"].as_f64(), Some(91.0));

        let temp_files = fs::read_dir(&artifact_dir)
            .expect("artifact dir")
            .collect::<Result<Vec<_>, _>>()
            .expect("artifact entries")
            .into_iter()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.contains(".tmp-"))
            .collect::<Vec<_>>();
        assert!(
            temp_files.is_empty(),
            "unexpected temp artifacts: {temp_files:?}"
        );
    }
}
