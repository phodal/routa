use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::api::repo_context::{
    extract_frontmatter, json_error, read_to_string, resolve_repo_root, RepoContextQuery,
};
use crate::error::ServerError;
use crate::state::AppState;

const FITNESS_PROFILES: [&str; 2] = ["generic", "agent_orchestrator"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/analyze", post(analyze_fitness))
        .route("/plan", get(get_fitness_plan))
        .route("/report", get(get_fitness_report))
        .route("/specs", get(get_fitness_specs))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    run_both: Option<bool>,
    profile: Option<String>,
    profiles: Option<Vec<String>>,
    compare_last: Option<bool>,
    no_save: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FitnessPlanQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    tier: Option<String>,
    scope: Option<String>,
}

async fn analyze_fitness(
    State(state): State<AppState>,
    Json(body): Json<AnalyzeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        body.workspace_id.as_deref(),
        body.codebase_id.as_deref(),
        body.repo_path.as_deref(),
        "缺少 fitness 分析上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Fitness 分析上下文无效",
        "Fitness 分析调用失败",
    ))?;

    let profiles = normalize_profiles(&body);
    let compare_last = body.compare_last.unwrap_or(true);
    let no_save = body.no_save.unwrap_or(false);
    let mut results = Vec::with_capacity(profiles.len());

    for profile in &profiles {
        results.push(run_fitness_profile(&repo_root, profile, compare_last, no_save).await);
    }

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "requestedProfiles": profiles,
        "profiles": results,
    })))
}

async fn get_fitness_report(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Fitness 快照上下文无效",
        "获取 Fitness 快照失败",
    ))?;

    let profiles = FITNESS_PROFILES
        .iter()
        .map(|profile| {
            let snapshot_path = profile_snapshot_path(&repo_root, profile);
            match std::fs::read_to_string(&snapshot_path) {
                Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                    Ok(report) => json!({
                        "profile": profile,
                        "source": "snapshot",
                        "status": "ok",
                        "report": report,
                    }),
                    Err(error) => json!({
                        "profile": profile,
                        "source": "snapshot",
                        "status": "error",
                        "error": error.to_string(),
                    }),
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
                    "profile": profile,
                    "source": "snapshot",
                    "status": "missing",
                    "error": "快照文件不存在",
                }),
                Err(error) => json!({
                    "profile": profile,
                    "source": "snapshot",
                    "status": "error",
                    "error": error.to_string(),
                }),
            }
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "requestedProfiles": FITNESS_PROFILES,
        "profiles": profiles,
    })))
}

async fn get_fitness_plan(
    State(state): State<AppState>,
    Query(query): Query<FitnessPlanQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Fitness plan 上下文无效",
        "构建 Fitness plan 失败",
    ))?;

    let tier = parse_tier(query.tier.as_deref());
    let scope = parse_scope(query.scope.as_deref());
    let fitness_dir = repo_root.join("docs/fitness");

    // Return empty plan if fitness directory doesn't exist (generic repos may not have it)
    if !fitness_dir.exists() {
        return Ok(Json(json!({
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "repoRoot": repo_root,
            "tier": format!("{tier:?}"),
            "scope": format!("{scope:?}"),
            "dimensions": [],
            "runnerCounts": { "shell": 0, "graph": 0, "sarif": 0 },
            "metricCount": 0,
            "hardGateCount": 0,
        })));
    }

    let entries =
        std::fs::read_dir(&fitness_dir).map_err(map_io_error("构建 Fitness plan 失败"))?;

    let mut markdown_by_path = BTreeMap::new();
    let mut manifest_entries = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if name == "manifest.yaml" {
            manifest_entries = parse_manifest_entries(&path);
            continue;
        }
        if !name.ends_with(".md") || name == "README.md" || name == "REVIEW.md" {
            continue;
        }

        let raw = read_to_string(&path).map_err(map_internal_error("构建 Fitness plan 失败"))?;
        markdown_by_path.insert(name.to_string(), raw.clone());
        markdown_by_path.insert(format!("docs/fitness/{name}"), raw);
    }

    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    for manifest_entry in manifest_entries {
        if let Some(raw) = markdown_by_path.get(&manifest_entry) {
            seen.insert(manifest_entry.clone());
            ordered.push((manifest_entry.clone(), raw.clone()));
        }
    }
    for (key, raw) in markdown_by_path {
        if !key.starts_with("docs/fitness/") && seen.insert(key.clone()) {
            ordered.push((key, raw));
        }
    }

    let mut dimensions = Vec::new();
    let mut runner_counts = json!({ "shell": 0, "graph": 0, "sarif": 0 });
    let mut metric_count = 0;
    let mut hard_gate_count = 0;

    for (name, raw) in ordered {
        let Some(frontmatter) = parse_markdown_frontmatter(&raw) else {
            continue;
        };
        let metrics = frontmatter
            .get("metrics")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(normalize_plan_metric)
            .filter(|metric| tier_passes(metric["tier"].as_str().unwrap_or("normal"), tier))
            .filter(|metric| metric["executionScope"].as_str().unwrap_or("local") == scope)
            .collect::<Vec<_>>();

        if metrics.is_empty() {
            continue;
        }

        for metric in &metrics {
            metric_count += 1;
            if metric["hardGate"].as_bool().unwrap_or(false) {
                hard_gate_count += 1;
            }
            let runner = metric["runner"].as_str().unwrap_or("shell");
            runner_counts[runner] = json!(runner_counts[runner].as_i64().unwrap_or(0) + 1);
        }

        let threshold = frontmatter
            .get("threshold")
            .cloned()
            .unwrap_or_else(|| json!({}));
        dimensions.push(json!({
            "name": frontmatter.get("dimension").and_then(Value::as_str).unwrap_or(name.trim_end_matches(".md")),
            "weight": frontmatter.get("weight").and_then(Value::as_i64).unwrap_or(0),
            "thresholdPass": threshold.get("pass").and_then(Value::as_i64).unwrap_or(90),
            "thresholdWarn": threshold.get("warn").and_then(Value::as_i64).unwrap_or(80),
            "sourceFile": name,
            "metrics": metrics,
        }));
    }

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "tier": tier,
        "scope": scope,
        "repoRoot": repo_root,
        "dimensionCount": dimensions.len(),
        "metricCount": metric_count,
        "hardGateCount": hard_gate_count,
        "runnerCounts": runner_counts,
        "dimensions": dimensions,
    })))
}

async fn get_fitness_specs(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Fitness specs 上下文无效",
        "读取 Fitness specs 失败",
    ))?;

    let fitness_dir = repo_root.join("docs/fitness");

    // Return empty result if fitness directory doesn't exist (generic repos may not have it)
    if !fitness_dir.exists() {
        return Ok(Json(json!({
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "repoRoot": repo_root,
            "fitnessDir": fitness_dir,
            "files": [],
        })));
    }

    let entries =
        std::fs::read_dir(&fitness_dir).map_err(map_io_error("读取 Fitness specs 失败"))?;

    let mut files = Vec::new();
    let mut by_path = BTreeMap::<String, Value>::new();
    let mut manifest_spec: Option<Value> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if is_fluency_model_spec(name) {
            continue;
        }
        let raw = read_to_string(&path).map_err(map_internal_error("读取 Fitness specs 失败"))?;
        let spec = if name.ends_with(".md") {
            parse_markdown_spec(name, &raw)
        } else if name == "manifest.yaml" {
            parse_manifest_spec(name, &raw)
        } else if name.ends_with(".yaml") || name.ends_with(".yml") {
            parse_non_markdown_spec(name, &raw)
        } else {
            continue;
        };
        files.push(spec.clone());
        by_path.insert(name.to_string(), spec.clone());
        by_path.insert(format!("docs/fitness/{name}"), spec.clone());
        if name == "manifest.yaml" {
            manifest_spec = Some(spec);
        }
    }

    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |spec: Option<&Value>| {
        if let Some(spec) = spec {
            let key = spec["relativePath"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if !key.is_empty() && seen.insert(key) {
                ordered.push(spec.clone());
            }
        }
    };

    push(by_path.get("README.md"));
    push(manifest_spec.as_ref());
    if let Some(manifest_entries) = manifest_spec
        .as_ref()
        .and_then(|spec| spec["manifestEntries"].as_array())
    {
        for entry in manifest_entries.iter().filter_map(Value::as_str) {
            push(by_path.get(entry));
        }
    }
    for spec in &files {
        push(Some(spec));
    }

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "fitnessDir": fitness_dir,
        "files": ordered,
    })))
}

fn normalize_profiles(body: &AnalyzeRequest) -> Vec<String> {
    let mut configured = body.profiles.clone().unwrap_or_default();
    if configured.is_empty() {
        if let Some(profile) = &body.profile {
            configured.push(profile.clone());
        }
    }
    if body.run_both == Some(true) && configured.is_empty() {
        return FITNESS_PROFILES
            .iter()
            .map(|value| value.to_string())
            .collect();
    }

    let mut deduped = Vec::new();
    for profile in configured {
        if FITNESS_PROFILES.contains(&profile.as_str()) && !deduped.contains(&profile) {
            deduped.push(profile);
        }
    }

    if deduped.is_empty() {
        vec!["generic".to_string()]
    } else {
        deduped
    }
}

async fn run_fitness_profile(
    repo_root: &Path,
    profile: &str,
    compare_last: bool,
    no_save: bool,
) -> Value {
    let started_at = Instant::now();
    let mut args = vec![
        "run",
        "-p",
        "routa-cli",
        "--",
        "fitness",
        "fluency",
        "--format",
        "json",
        "--profile",
        profile,
    ];
    if compare_last {
        args.push("--compare-last");
    }
    if no_save {
        args.push("--no-save");
    }

    let output = Command::new("cargo")
        .args(&args)
        .current_dir(repo_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let duration_ms = started_at.elapsed().as_millis() as u64;
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            match extract_json_output(&stdout)
                .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|e| e.to_string()))
            {
                Ok(report) => json!({
                    "profile": profile,
                    "source": "analysis",
                    "status": "ok",
                    "durationMs": duration_ms,
                    "report": report,
                }),
                Err(error) => json!({
                    "profile": profile,
                    "source": "analysis",
                    "status": "error",
                    "durationMs": duration_ms,
                    "error": error,
                }),
            }
        }
        Ok(output) => json!({
            "profile": profile,
            "source": "analysis",
            "status": "error",
            "durationMs": duration_ms,
            "error": format!(
                "Command failed (exit {}): {}",
                output.status.code().unwrap_or(1),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        }),
        Err(error) => json!({
            "profile": profile,
            "source": "analysis",
            "status": "error",
            "durationMs": duration_ms,
            "error": error.to_string(),
        }),
    }
}

fn profile_snapshot_path(repo_root: &Path, profile: &str) -> PathBuf {
    repo_root
        .join("docs/fitness/reports")
        .join(if profile == "generic" {
            "harness-fluency-latest.json"
        } else {
            "harness-fluency-agent-orchestrator-latest.json"
        })
}

fn extract_json_output(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return Err("Command produced no output".to_string());
    }
    if serde_json::from_str::<Value>(candidate).is_ok() {
        return Ok(candidate.to_string());
    }
    for (index, ch) in candidate.char_indices().rev() {
        if ch != '{' {
            continue;
        }
        let snippet = candidate[index..].trim();
        if snippet.ends_with('}') && serde_json::from_str::<Value>(snippet).is_ok() {
            return Ok(snippet.to_string());
        }
    }
    Err("Unable to parse command JSON output".to_string())
}

fn parse_manifest_entries(path: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&raw) else {
        return Vec::new();
    };
    value
        .get("evidence_files")
        .and_then(serde_yaml::Value::as_sequence)
        .map(|entries| {
            entries
                .iter()
                .filter_map(serde_yaml::Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_markdown_frontmatter(raw: &str) -> Option<Value> {
    let (frontmatter, _) = extract_frontmatter(raw)?;
    serde_yaml::from_str::<serde_yaml::Value>(&frontmatter)
        .ok()
        .and_then(|value| serde_json::to_value(value).ok())
}

fn normalize_plan_metric(metric: Value) -> Value {
    let hard_gate = metric
        .get("hard_gate")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tier = match metric.get("tier").and_then(Value::as_str) {
        Some("fast" | "normal" | "deep") => metric["tier"].as_str().unwrap_or("normal"),
        _ => "normal",
    };
    let execution_scope = match metric.get("execution_scope").and_then(Value::as_str) {
        Some("ci" | "staging" | "prod_observation") => {
            metric["execution_scope"].as_str().unwrap_or("local")
        }
        _ => "local",
    };
    json!({
        "name": metric.get("name").and_then(Value::as_str).unwrap_or("unknown"),
        "command": metric.get("command").and_then(Value::as_str).unwrap_or(""),
        "description": metric.get("description").and_then(Value::as_str).unwrap_or(""),
        "tier": tier,
        "gate": metric.get("gate").and_then(Value::as_str).unwrap_or(if hard_gate { "hard" } else { "soft" }),
        "hardGate": hard_gate,
        "runner": map_runner(&metric),
        "executionScope": execution_scope,
    })
}

fn parse_markdown_spec(relative_path: &str, raw: &str) -> Value {
    let frontmatter = parse_markdown_frontmatter(raw).unwrap_or_else(|| json!({}));
    let metrics = frontmatter
        .get("metrics")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let frontmatter_source =
        extract_frontmatter(raw).map(|(frontmatter, _)| format!("---\n{frontmatter}\n---"));

    if relative_path == "README.md" {
        return json!({
            "name": relative_path,
            "relativePath": relative_path,
            "kind": "rulebook",
            "language": "markdown",
            "metricCount": 0,
            "metrics": [],
            "source": raw,
            "frontmatterSource": frontmatter_source,
        });
    }

    if metrics.is_empty() {
        return json!({
            "name": relative_path,
            "relativePath": relative_path,
            "kind": "narrative",
            "language": "markdown",
            "metricCount": 0,
            "metrics": [],
            "source": raw,
            "frontmatterSource": frontmatter_source,
        });
    }

    let threshold = frontmatter
        .get("threshold")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let normalized_metrics = metrics
        .into_iter()
        .enumerate()
        .map(|(index, metric)| {
            let hard_gate = metric
                .get("hard_gate")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            json!({
                "name": metric.get("name").and_then(Value::as_str).unwrap_or(&format!("metric-{}", index + 1)),
                "command": metric.get("command").and_then(Value::as_str).unwrap_or(""),
                "description": metric.get("description").and_then(Value::as_str).unwrap_or(""),
                "tier": metric.get("tier").and_then(Value::as_str).unwrap_or("normal"),
                "hardGate": hard_gate,
                "gate": metric.get("gate").and_then(Value::as_str).unwrap_or(if hard_gate { "hard" } else { "soft" }),
                "runner": map_runner(&metric),
                "pattern": metric.get("pattern").and_then(Value::as_str),
                "evidenceType": metric.get("evidence_type").and_then(Value::as_str),
                "scope": normalize_string_list(metric.get("scope")),
                "runWhenChanged": normalize_string_list(metric.get("run_when_changed")),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "name": relative_path,
        "relativePath": relative_path,
        "kind": "dimension",
        "language": "markdown",
        "dimension": frontmatter.get("dimension").and_then(Value::as_str).unwrap_or("unknown"),
        "weight": frontmatter.get("weight").and_then(Value::as_i64).unwrap_or(0),
        "thresholdPass": threshold.get("pass").and_then(Value::as_i64).unwrap_or(90),
        "thresholdWarn": threshold.get("warn").and_then(Value::as_i64).unwrap_or(80),
        "metricCount": normalized_metrics.len(),
        "metrics": normalized_metrics,
        "source": raw,
        "frontmatterSource": frontmatter_source,
    })
}

fn parse_manifest_spec(relative_path: &str, raw: &str) -> Value {
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(raw).unwrap_or_default();
    let manifest_entries = parsed
        .get("evidence_files")
        .and_then(serde_yaml::Value::as_sequence)
        .map(|entries| {
            entries
                .iter()
                .filter_map(serde_yaml::Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "name": relative_path,
        "relativePath": relative_path,
        "kind": "manifest",
        "language": "yaml",
        "metricCount": manifest_entries.len(),
        "metrics": [],
        "source": raw,
        "manifestEntries": manifest_entries,
    })
}

fn parse_non_markdown_spec(relative_path: &str, raw: &str) -> Value {
    json!({
        "name": relative_path,
        "relativePath": relative_path,
        "kind": "policy",
        "language": "yaml",
        "metricCount": 0,
        "metrics": [],
        "source": raw,
    })
}

fn is_fluency_model_spec(relative_path: &str) -> bool {
    matches!(
        relative_path,
        "harness-fluency.model.yaml" | "harness-fluency.model.yml"
    ) || (relative_path.starts_with("harness-fluency.profile.")
        && (relative_path.ends_with(".yaml") || relative_path.ends_with(".yml")))
}

fn normalize_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn map_runner(metric: &Value) -> &'static str {
    if metric.get("evidence_type").and_then(Value::as_str) == Some("sarif")
        || metric.get("evidenceType").and_then(Value::as_str) == Some("sarif")
    {
        "sarif"
    } else if metric
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.starts_with("graph:"))
    {
        "graph"
    } else {
        "shell"
    }
}

fn parse_tier(value: Option<&str>) -> &'static str {
    match value {
        Some("fast") => "fast",
        Some("deep") => "deep",
        _ => "normal",
    }
}

fn parse_scope(value: Option<&str>) -> &'static str {
    match value {
        Some("ci") => "ci",
        Some("staging") => "staging",
        Some("prod_observation") => "prod_observation",
        _ => "local",
    }
}

fn tier_passes(metric_tier: &str, filter_tier: &str) -> bool {
    tier_rank(metric_tier) <= tier_rank(filter_tier)
}

fn tier_rank(tier: &str) -> u8 {
    match tier {
        "fast" => 0,
        "normal" => 1,
        "deep" => 2,
        _ => 1,
    }
}

fn map_context_error(
    public_error: &'static str,
    internal_error: &'static str,
) -> impl Fn(ServerError) -> (StatusCode, Json<Value>) + Clone {
    move |error| match error {
        ServerError::BadRequest(details) => (
            StatusCode::BAD_REQUEST,
            Json(json_error(public_error, details)),
        ),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(internal_error, other.to_string())),
        ),
    }
}

fn map_internal_error(
    public_error: &'static str,
) -> impl Fn(ServerError) -> (StatusCode, Json<Value>) + Clone {
    move |error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(public_error, error.to_string())),
        )
    }
}

fn map_io_error(
    public_error: &'static str,
) -> impl Fn(std::io::Error) -> (StatusCode, Json<Value>) + Clone {
    move |error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(public_error, error.to_string())),
        )
    }
}
