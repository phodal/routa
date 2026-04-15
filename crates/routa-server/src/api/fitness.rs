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
use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::api::repo_context::{
    extract_frontmatter, json_error, read_to_string, resolve_repo_root, RepoContextQuery,
    ResolveRepoRootOptions,
};
use crate::error::ServerError;
use crate::state::AppState;

const FITNESS_PROFILES: [&str; 2] = ["generic", "agent_orchestrator"];
const ARCHITECTURE_SUITES: [&str; 2] = ["boundaries", "cycles"];
const RUNTIME_FITNESS_MODES: [&str; 2] = ["fast", "full"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/analyze", post(analyze_fitness))
        .route("/architecture", get(get_fitness_architecture))
        .route("/plan", get(get_fitness_plan))
        .route("/report", get(get_fitness_report))
        .route("/runtime", get(get_fitness_runtime))
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

#[derive(Clone, Debug, Deserialize)]
struct RuntimeFitnessEventRecord {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    observed_at_ms: Option<i64>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    final_score: Option<f64>,
    #[serde(default)]
    hard_gate_blocked: Option<bool>,
    #[serde(default)]
    score_blocked: Option<bool>,
    #[serde(default)]
    duration_ms: Option<f64>,
    #[serde(default)]
    dimension_count: Option<usize>,
    #[serde(default)]
    metric_count: Option<usize>,
    #[serde(default)]
    artifact_path: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFitnessCompletedSummary {
    status: String,
    observed_at: String,
    final_score: Option<f64>,
    hard_gate_blocked: Option<bool>,
    score_blocked: Option<bool>,
    duration_ms: Option<f64>,
    dimension_count: Option<usize>,
    metric_count: Option<usize>,
    artifact_path: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFitnessModeSummary {
    mode: String,
    current_status: String,
    current_observed_at: Option<String>,
    final_score: Option<f64>,
    hard_gate_blocked: Option<bool>,
    score_blocked: Option<bool>,
    duration_ms: Option<f64>,
    dimension_count: Option<usize>,
    metric_count: Option<usize>,
    artifact_path: Option<String>,
    last_completed: Option<RuntimeFitnessCompletedSummary>,
    #[serde(skip)]
    current_observed_at_ms: Option<i64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFitnessStatusPayload {
    generated_at: String,
    repo_root: String,
    has_running: bool,
    modes: Vec<RuntimeFitnessModeSummary>,
    latest: Option<RuntimeFitnessModeSummary>,
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
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
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
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
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

async fn get_fitness_runtime(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 runtime fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
    )
    .await
    .map_err(map_context_error(
        "Runtime Fitness 上下文无效",
        "读取 Runtime Fitness 状态失败",
    ))?;

    let payload = read_runtime_fitness_status(&repo_root)
        .map_err(map_internal_error("读取 Runtime Fitness 状态失败"))?;
    Ok(Json(
        serde_json::to_value(payload).expect("runtime fitness payload should serialize"),
    ))
}

async fn get_fitness_architecture(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
    )
    .await
    .map_err(map_context_error(
        "Architecture quality 上下文无效",
        "加载 Architecture quality 失败",
    ))?;

    let mut reports = Vec::with_capacity(ARCHITECTURE_SUITES.len());
    for suite in ARCHITECTURE_SUITES {
        let report = run_architecture_suite(&repo_root, suite)
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json_error("加载 Architecture quality 失败", error)),
                )
            })?;
        reports.push(report);
    }

    let snapshot_path = architecture_snapshot_path(&repo_root);

    let rule_count = reports
        .iter()
        .map(|report| report["ruleCount"].as_u64().unwrap_or(0))
        .sum::<u64>();
    let failed_rule_count = reports
        .iter()
        .map(|report| report["failedRuleCount"].as_u64().unwrap_or(0))
        .sum::<u64>();
    let violation_count = reports
        .iter()
        .flat_map(|report| report["results"].as_array().into_iter().flatten())
        .map(|result| result["violationCount"].as_u64().unwrap_or(0))
        .sum::<u64>();
    let summary_status = if reports
        .iter()
        .any(|report| report["summaryStatus"].as_str() == Some("fail"))
    {
        "fail"
    } else if reports
        .iter()
        .any(|report| report["summaryStatus"].as_str() == Some("skipped"))
    {
        "skipped"
    } else {
        "pass"
    };

    let mut note_set = HashSet::new();
    let notes = reports
        .iter()
        .flat_map(|report| report["notes"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .filter(|note| note_set.insert((*note).to_string()))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let arch_unit_source = reports
        .iter()
        .find_map(|report| report["archUnitSource"].as_str())
        .map(ToString::to_string);
    let tsconfig_path = reports
        .iter()
        .find_map(|report| report["tsconfigPath"].as_str())
        .unwrap_or_default()
        .to_string();
    let mut notes = notes;

    let mut response = json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "summaryStatus": summary_status,
        "archUnitSource": arch_unit_source,
        "tsconfigPath": tsconfig_path,
        "snapshotPath": snapshot_path.to_string_lossy().to_string(),
        "suiteCount": reports.len(),
        "ruleCount": rule_count,
        "failedRuleCount": failed_rule_count,
        "violationCount": violation_count,
        "reports": reports,
        "notes": notes,
        "comparison": Value::Null,
    });

    let comparison = match load_architecture_snapshot(&snapshot_path) {
        Ok(Some(previous_snapshot)) => {
            Some(build_architecture_comparison(&previous_snapshot, &response))
        }
        Ok(None) => None,
        Err(error) => {
            notes.push(format!(
                "Unable to read previous architecture snapshot: {error}"
            ));
            None
        }
    };

    if let Some(object) = response.as_object_mut() {
        object.insert("notes".to_string(), json!(dedupe_strings(notes)));
        object.insert("comparison".to_string(), comparison.unwrap_or(Value::Null));
    }

    let mut snapshot_payload = response.clone();
    if let Some(object) = snapshot_payload.as_object_mut() {
        object.insert("comparison".to_string(), Value::Null);
    }

    if let Err(error) = persist_architecture_snapshot(&snapshot_payload, &snapshot_path) {
        let mut snapshot_notes = response["notes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(ToString::to_string))
            .collect::<Vec<_>>();
        snapshot_notes.push(format!("Unable to persist architecture snapshot: {error}"));
        if let Some(object) = response.as_object_mut() {
            object.insert("notes".to_string(), json!(dedupe_strings(snapshot_notes)));
        }
    }

    Ok(Json(response))
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
        ResolveRepoRootOptions::default(),
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
        ResolveRepoRootOptions::default(),
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

async fn run_architecture_suite(repo_root: &Path, suite: &str) -> Result<Value, String> {
    let app_root = std::env::current_dir().map_err(|error| error.to_string())?;
    let script_path = app_root.join("scripts/fitness/check-backend-architecture.ts");
    let args = vec![
        "--import".to_string(),
        "tsx".to_string(),
        script_path.to_string_lossy().to_string(),
        "--repo-root".to_string(),
        repo_root.to_string_lossy().to_string(),
        "--suite".to_string(),
        suite.to_string(),
        "--json".to_string(),
    ];

    let output = Command::new("node")
        .args(&args)
        .current_dir(&app_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_json_output(&stdout)
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string()))
        .map_err(|error| {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                format!(
                    "Failed to execute architecture suite {suite} (exit {}) : {error}",
                    output.status.code().unwrap_or(1)
                )
            } else {
                format!(
                    "Failed to execute architecture suite {suite} (exit {}) : {stderr}",
                    output.status.code().unwrap_or(1)
                )
            }
        })
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

fn architecture_snapshot_path(repo_root: &Path) -> PathBuf {
    repo_root
        .join("docs/fitness/reports")
        .join("backend-architecture-latest.json")
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn load_architecture_snapshot(snapshot_path: &Path) -> Result<Option<Value>, String> {
    match std::fs::read_to_string(snapshot_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .map(Some)
            .map_err(|error| format!("unable to parse {}: {error}", snapshot_path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "unable to read {}: {error}",
            snapshot_path.display()
        )),
    }
}

fn persist_architecture_snapshot(report: &Value, snapshot_path: &Path) -> Result<(), String> {
    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("unable to create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("unable to serialize architecture snapshot: {error}"))?;
    std::fs::write(snapshot_path, format!("{json}\n"))
        .map_err(|error| format!("unable to write {}: {error}", snapshot_path.display()))
}

#[derive(Clone)]
struct ArchitectureRuleEntry {
    id: String,
    title: String,
    suite: String,
    status: String,
    violation_count: i64,
}

fn architecture_rule_entries(report: &Value) -> Vec<ArchitectureRuleEntry> {
    report["reports"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|suite_report| {
            suite_report["results"]
                .as_array()
                .into_iter()
                .flatten()
                .map(move |result| ArchitectureRuleEntry {
                    id: result["id"].as_str().unwrap_or_default().to_string(),
                    title: result["title"].as_str().unwrap_or_default().to_string(),
                    suite: result["suite"].as_str().unwrap_or("boundaries").to_string(),
                    status: result["status"].as_str().unwrap_or("pass").to_string(),
                    violation_count: result["violationCount"].as_i64().unwrap_or(0),
                })
        })
        .collect()
}

fn build_architecture_comparison(previous: &Value, current: &Value) -> Value {
    let previous_rules = architecture_rule_entries(previous)
        .into_iter()
        .map(|rule| (format!("{}:{}", rule.suite, rule.id), rule))
        .collect::<BTreeMap<_, _>>();
    let current_rules = architecture_rule_entries(current)
        .into_iter()
        .map(|rule| (format!("{}:{}", rule.suite, rule.id), rule))
        .collect::<BTreeMap<_, _>>();
    let keys = previous_rules
        .keys()
        .chain(current_rules.keys())
        .cloned()
        .collect::<HashSet<_>>();

    let mut changed_rules = keys
        .into_iter()
        .filter_map(|key| {
            let previous_rule = previous_rules.get(&key);
            let current_rule = current_rules.get(&key);
            let previous_status = previous_rule
                .map(|rule| rule.status.as_str())
                .unwrap_or("missing");
            let current_status = current_rule
                .map(|rule| rule.status.as_str())
                .unwrap_or("missing");
            let previous_violation_count =
                previous_rule.map(|rule| rule.violation_count).unwrap_or(0);
            let current_violation_count =
                current_rule.map(|rule| rule.violation_count).unwrap_or(0);

            if previous_status == current_status
                && previous_violation_count == current_violation_count
            {
                return None;
            }

            Some(json!({
                "id": current_rule
                    .map(|rule| rule.id.clone())
                    .or_else(|| previous_rule.map(|rule| rule.id.clone()))
                    .unwrap_or_default(),
                "title": current_rule
                    .map(|rule| rule.title.clone())
                    .or_else(|| previous_rule.map(|rule| rule.title.clone()))
                    .unwrap_or_default(),
                "suite": current_rule
                    .map(|rule| rule.suite.clone())
                    .or_else(|| previous_rule.map(|rule| rule.suite.clone()))
                    .unwrap_or_else(|| "boundaries".to_string()),
                "previousStatus": previous_status,
                "currentStatus": current_status,
                "previousViolationCount": previous_violation_count,
                "currentViolationCount": current_violation_count,
                "violationDelta": current_violation_count - previous_violation_count,
            }))
        })
        .collect::<Vec<_>>();

    changed_rules.sort_by(|left, right| {
        let left_count = left["currentViolationCount"].as_i64().unwrap_or(0);
        let right_count = right["currentViolationCount"].as_i64().unwrap_or(0);
        right_count
            .cmp(&left_count)
            .then_with(|| {
                left["suite"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(right["suite"].as_str().unwrap_or_default())
            })
            .then_with(|| {
                left["title"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(right["title"].as_str().unwrap_or_default())
            })
    });

    let new_failing_rules = changed_rules
        .iter()
        .filter(|rule| {
            rule["currentStatus"].as_str() == Some("fail")
                && rule["previousStatus"].as_str() != Some("fail")
        })
        .cloned()
        .collect::<Vec<_>>();
    let resolved_rules = changed_rules
        .iter()
        .filter(|rule| {
            rule["previousStatus"].as_str() == Some("fail")
                && rule["currentStatus"].as_str() != Some("fail")
        })
        .cloned()
        .collect::<Vec<_>>();

    json!({
        "previousGeneratedAt": previous["generatedAt"].as_str().unwrap_or_default(),
        "previousSummaryStatus": previous["summaryStatus"].as_str().unwrap_or("pass"),
        "currentSummaryStatus": current["summaryStatus"].as_str().unwrap_or("pass"),
        "ruleDelta": current["ruleCount"].as_i64().unwrap_or(0) - previous["ruleCount"].as_i64().unwrap_or(0),
        "failedRuleDelta": current["failedRuleCount"].as_i64().unwrap_or(0) - previous["failedRuleCount"].as_i64().unwrap_or(0),
        "violationDelta": current["violationCount"].as_i64().unwrap_or(0) - previous["violationCount"].as_i64().unwrap_or(0),
        "changedRules": changed_rules,
        "newFailingRules": new_failing_rules,
        "resolvedRules": resolved_rules,
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

fn runtime_fitness_marker(repo_root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(repo_root.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn runtime_fitness_root(repo_root: &Path) -> PathBuf {
    Path::new("/tmp")
        .join("harness-monitor")
        .join("runtime")
        .join(runtime_fitness_marker(repo_root))
}

fn runtime_fitness_event_path(repo_root: &Path) -> PathBuf {
    runtime_fitness_root(repo_root).join("events.jsonl")
}

fn runtime_fitness_artifact_path(repo_root: &Path, mode: &str) -> PathBuf {
    runtime_fitness_root(repo_root)
        .join("artifacts")
        .join("fitness")
        .join(format!("latest-{mode}.json"))
}

fn normalize_runtime_fitness_mode(value: Option<&str>) -> Option<&'static str> {
    match value {
        Some("fast") => Some("fast"),
        Some("full") | Some("normal") => Some("full"),
        _ => None,
    }
}

fn normalize_runtime_fitness_status(value: Option<&str>) -> Option<&'static str> {
    match value {
        Some("running") => Some("running"),
        Some("passed") => Some("passed"),
        Some("failed") => Some("failed"),
        Some("skipped") => Some("skipped"),
        _ => None,
    }
}

fn is_terminal_runtime_fitness_status(status: &str) -> bool {
    matches!(status, "passed" | "failed" | "skipped")
}

fn timestamp_ms_to_rfc3339(timestamp_ms: Option<i64>) -> Option<String> {
    timestamp_ms
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
        .map(|value| value.to_rfc3339())
}

fn derive_runtime_fitness_artifact_status(
    hard_gate_blocked: Option<bool>,
    score_blocked: Option<bool>,
) -> &'static str {
    if hard_gate_blocked.unwrap_or(false) || score_blocked.unwrap_or(false) {
        "failed"
    } else {
        "passed"
    }
}

fn completed_summary_from_runtime_event(
    event: &RuntimeFitnessEventRecord,
) -> Option<RuntimeFitnessCompletedSummary> {
    let status = normalize_runtime_fitness_status(event.status.as_deref())?;
    if !is_terminal_runtime_fitness_status(status) {
        return None;
    }
    let observed_at = timestamp_ms_to_rfc3339(event.observed_at_ms)?;
    Some(RuntimeFitnessCompletedSummary {
        status: status.to_string(),
        observed_at,
        final_score: event.final_score,
        hard_gate_blocked: event.hard_gate_blocked,
        score_blocked: event.score_blocked,
        duration_ms: event.duration_ms,
        dimension_count: event.dimension_count,
        metric_count: event.metric_count,
        artifact_path: event.artifact_path.clone(),
    })
}

fn read_runtime_fitness_artifact_summary(
    repo_root: &Path,
    mode: &str,
) -> Result<Option<(i64, RuntimeFitnessCompletedSummary)>, ServerError> {
    let artifact_path = runtime_fitness_artifact_path(repo_root, mode);
    let raw = match std::fs::read_to_string(&artifact_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(ServerError::Internal(format!(
                "读取 Runtime Fitness artifact 失败: {error}"
            )))
        }
    };
    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
        ServerError::Internal(format!("解析 Runtime Fitness artifact 失败: {error}"))
    })?;
    let generated_at_ms = parsed.get("generated_at_ms").and_then(Value::as_i64);
    let Some(generated_at_ms) = generated_at_ms else {
        return Ok(None);
    };
    let Some(observed_at) = timestamp_ms_to_rfc3339(Some(generated_at_ms)) else {
        return Ok(None);
    };
    let hard_gate_blocked = parsed.get("hard_gate_blocked").and_then(Value::as_bool);
    let score_blocked = parsed.get("score_blocked").and_then(Value::as_bool);
    Ok(Some((
        generated_at_ms,
        RuntimeFitnessCompletedSummary {
            status: derive_runtime_fitness_artifact_status(hard_gate_blocked, score_blocked)
                .to_string(),
            observed_at,
            final_score: parsed.get("final_score").and_then(Value::as_f64),
            hard_gate_blocked,
            score_blocked,
            duration_ms: parsed.get("duration_ms").and_then(Value::as_f64),
            dimension_count: parsed
                .get("dimensions")
                .and_then(Value::as_array)
                .map(std::vec::Vec::len),
            metric_count: parsed
                .get("metric_count")
                .and_then(Value::as_u64)
                .map(|value| value as usize),
            artifact_path: Some(artifact_path.to_string_lossy().to_string()),
        },
    )))
}

fn missing_runtime_fitness_mode_summary(mode: &str) -> RuntimeFitnessModeSummary {
    RuntimeFitnessModeSummary {
        mode: mode.to_string(),
        current_status: "missing".to_string(),
        current_observed_at: None,
        final_score: None,
        hard_gate_blocked: None,
        score_blocked: None,
        duration_ms: None,
        dimension_count: None,
        metric_count: None,
        artifact_path: None,
        last_completed: None,
        current_observed_at_ms: None,
    }
}

fn summarize_runtime_fitness_mode_from_completed(
    mode: &str,
    summary: RuntimeFitnessCompletedSummary,
) -> RuntimeFitnessModeSummary {
    RuntimeFitnessModeSummary {
        mode: mode.to_string(),
        current_status: summary.status.clone(),
        current_observed_at: Some(summary.observed_at.clone()),
        final_score: summary.final_score,
        hard_gate_blocked: summary.hard_gate_blocked,
        score_blocked: summary.score_blocked,
        duration_ms: summary.duration_ms,
        dimension_count: summary.dimension_count,
        metric_count: summary.metric_count,
        artifact_path: summary.artifact_path.clone(),
        last_completed: Some(summary.clone()),
        current_observed_at_ms: chrono::DateTime::parse_from_rfc3339(&summary.observed_at)
            .ok()
            .map(|value| value.timestamp_millis()),
    }
}

fn build_runtime_fitness_mode_summary(
    repo_root: &Path,
    mode: &str,
    latest_event: Option<&RuntimeFitnessEventRecord>,
    latest_terminal_event: Option<&RuntimeFitnessEventRecord>,
) -> Result<RuntimeFitnessModeSummary, ServerError> {
    let latest_artifact = read_runtime_fitness_artifact_summary(repo_root, mode)?;
    let last_completed = latest_terminal_event
        .and_then(completed_summary_from_runtime_event)
        .or_else(|| latest_artifact.as_ref().map(|(_, summary)| summary.clone()));

    let current_status =
        latest_event.and_then(|event| normalize_runtime_fitness_status(event.status.as_deref()));

    if current_status == Some("running") {
        return Ok(RuntimeFitnessModeSummary {
            mode: mode.to_string(),
            current_status: "running".to_string(),
            current_observed_at: timestamp_ms_to_rfc3339(
                latest_event.and_then(|event| event.observed_at_ms),
            ),
            final_score: latest_event.and_then(|event| event.final_score),
            hard_gate_blocked: latest_event.and_then(|event| event.hard_gate_blocked),
            score_blocked: latest_event.and_then(|event| event.score_blocked),
            duration_ms: latest_event.and_then(|event| event.duration_ms),
            dimension_count: latest_event.and_then(|event| event.dimension_count),
            metric_count: latest_event.and_then(|event| event.metric_count),
            artifact_path: latest_event.and_then(|event| event.artifact_path.clone()),
            last_completed,
            current_observed_at_ms: latest_event.and_then(|event| event.observed_at_ms),
        });
    }

    if let Some(summary) = latest_event.and_then(completed_summary_from_runtime_event) {
        return Ok(summarize_runtime_fitness_mode_from_completed(mode, summary));
    }

    if let Some(summary) = last_completed {
        return Ok(summarize_runtime_fitness_mode_from_completed(mode, summary));
    }

    Ok(missing_runtime_fitness_mode_summary(mode))
}

fn read_runtime_fitness_status(
    repo_root: &Path,
) -> Result<RuntimeFitnessStatusPayload, ServerError> {
    let mut latest_by_mode = BTreeMap::<String, RuntimeFitnessEventRecord>::new();
    let mut latest_terminal_by_mode = BTreeMap::<String, RuntimeFitnessEventRecord>::new();

    let event_path = runtime_fitness_event_path(repo_root);
    match std::fs::read_to_string(&event_path) {
        Ok(raw) => {
            for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
                let parsed = match serde_json::from_str::<RuntimeFitnessEventRecord>(line) {
                    Ok(parsed) => parsed,
                    Err(_) => continue,
                };
                if parsed.r#type.as_deref() != Some("fitness") {
                    continue;
                }
                let Some(mode) = normalize_runtime_fitness_mode(parsed.mode.as_deref()) else {
                    continue;
                };
                let Some(status) = normalize_runtime_fitness_status(parsed.status.as_deref())
                else {
                    continue;
                };
                latest_by_mode.insert(mode.to_string(), parsed.clone());
                if is_terminal_runtime_fitness_status(status) {
                    latest_terminal_by_mode.insert(mode.to_string(), parsed);
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ServerError::Internal(format!(
                "读取 Runtime Fitness event log 失败: {error}"
            )))
        }
    }

    let modes = RUNTIME_FITNESS_MODES
        .iter()
        .map(|mode| {
            build_runtime_fitness_mode_summary(
                repo_root,
                mode,
                latest_by_mode.get(*mode),
                latest_terminal_by_mode.get(*mode),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let latest = modes
        .iter()
        .filter(|summary| summary.current_status != "missing")
        .max_by_key(|summary| summary.current_observed_at_ms.unwrap_or(-1))
        .cloned();

    Ok(RuntimeFitnessStatusPayload {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.to_string_lossy().to_string(),
        has_running: modes
            .iter()
            .any(|summary| summary.current_status == "running"),
        modes,
        latest,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn runtime_fitness_status_surfaces_running_and_previous_completed_summary() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        let runtime_root = runtime_fitness_root(repo_root);
        std::fs::create_dir_all(runtime_root.join("artifacts").join("fitness"))
            .expect("runtime artifact dir");
        std::fs::write(
            runtime_root.join("events.jsonl"),
            format!(
                "{}\n{}\n",
                json!({
                    "type": "fitness",
                    "repo_root": repo_root.display().to_string(),
                    "observed_at_ms": 1_700_000_000_000i64,
                    "mode": "full",
                    "status": "passed",
                    "final_score": 92.4,
                    "hard_gate_blocked": false,
                    "score_blocked": false,
                    "duration_ms": 2180.0,
                    "dimension_count": 8,
                    "metric_count": 18,
                    "artifact_path": runtime_root
                        .join("artifacts")
                        .join("fitness")
                        .join("latest-full.json")
                        .to_string_lossy()
                        .to_string(),
                }),
                json!({
                    "type": "fitness",
                    "repo_root": repo_root.display().to_string(),
                    "observed_at_ms": 1_700_000_020_000i64,
                    "mode": "full",
                    "status": "running",
                    "metric_count": 19,
                }),
            ),
        )
        .expect("event log");
        std::fs::write(
            runtime_root
                .join("artifacts")
                .join("fitness")
                .join("latest-full.json"),
            serde_json::to_string_pretty(&json!({
                "generated_at_ms": 1_700_000_000_000i64,
                "final_score": 92.4,
                "hard_gate_blocked": false,
                "score_blocked": false,
                "duration_ms": 2180.0,
                "metric_count": 18,
                "dimensions": vec![json!({}); 8],
            }))
            .expect("serialize artifact"),
        )
        .expect("write artifact");

        let payload = read_runtime_fitness_status(repo_root).expect("runtime fitness payload");

        assert!(payload.has_running);
        let latest = payload.latest.expect("latest runtime fitness summary");
        assert_eq!(latest.mode, "full");
        assert_eq!(latest.current_status, "running");
        assert_eq!(latest.metric_count, Some(19));

        let full = payload
            .modes
            .iter()
            .find(|summary| summary.mode == "full")
            .expect("full summary");
        assert_eq!(full.current_status, "running");
        let last_completed = full.last_completed.as_ref().expect("completed summary");
        assert_eq!(last_completed.status, "passed");
        assert_eq!(last_completed.final_score, Some(92.4));
        assert_eq!(last_completed.dimension_count, Some(8));
        assert_eq!(last_completed.metric_count, Some(18));
    }

    #[test]
    fn runtime_fitness_status_returns_missing_when_runtime_is_absent() {
        let temp = tempdir().expect("tempdir");
        let payload = read_runtime_fitness_status(temp.path()).expect("runtime fitness payload");

        assert!(!payload.has_running);
        assert!(payload.latest.is_none());
        assert_eq!(payload.modes.len(), 2);
        assert!(payload
            .modes
            .iter()
            .all(|summary| summary.current_status == "missing"));
    }

    #[test]
    fn runtime_fitness_status_ignores_artifacts_without_valid_generated_at_ms() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        let runtime_root = runtime_fitness_root(repo_root);
        std::fs::create_dir_all(runtime_root.join("artifacts").join("fitness"))
            .expect("runtime artifact dir");
        std::fs::write(
            runtime_root.join("events.jsonl"),
            format!(
                "{}\n",
                json!({
                    "type": "fitness",
                    "repo_root": repo_root.display().to_string(),
                    "observed_at_ms": 1_700_000_020_000i64,
                    "mode": "full",
                    "status": "passed",
                    "final_score": 92.4,
                    "hard_gate_blocked": false,
                    "score_blocked": false,
                    "duration_ms": 2180.0,
                    "dimension_count": 8,
                    "metric_count": 18,
                }),
            ),
        )
        .expect("event log");
        std::fs::write(
            runtime_root
                .join("artifacts")
                .join("fitness")
                .join("latest-fast.json"),
            serde_json::to_string_pretty(&json!({
                "generated_at_ms": "invalid",
                "final_score": 61.0,
                "hard_gate_blocked": true,
            }))
            .expect("serialize artifact"),
        )
        .expect("write invalid artifact");

        let payload = read_runtime_fitness_status(repo_root).expect("runtime fitness payload");

        let latest = payload.latest.expect("latest runtime fitness summary");
        assert_eq!(latest.mode, "full");
        assert_eq!(latest.current_status, "passed");
        let fast = payload
            .modes
            .iter()
            .find(|summary| summary.mode == "fast")
            .expect("fast summary");
        assert_eq!(fast.current_status, "missing");
    }
}
