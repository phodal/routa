use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use regex::Regex;
use routa_core::harness::detect_repo_signals;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::api::harness_hook_preview_events::{
    parse_json_lines, to_metric_results, to_phase_results,
};
use crate::api::harness_instructions_audit::run_instruction_audit;
use crate::api::repo_context::{
    extract_frontmatter, json_error, read_to_string, resolve_repo_root, RepoContextQuery,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/github-actions", get(get_github_actions))
        .route("/hooks", get(get_harness_hooks))
        .route("/hooks/preview", get(get_hook_preview))
        .route("/instructions", get(get_harness_instructions))
        .route("/repo-signals", get(get_harness_repo_signals))
}

async fn get_harness_repo_signals(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing harness repo context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await?;

    let report = detect_repo_signals(&repo_root).map_err(ServerError::Internal)?;
    Ok(Json(serde_json::to_value(report).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize report: {error}"))
    })?))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookPreviewQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    profile: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstructionsQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    include_audit: Option<String>,
    audit_provider: Option<String>,
}

async fn get_github_actions(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "GitHub Actions 上下文无效",
        "读取 GitHub Actions workflows 失败",
    ))?;

    let workflows_dir = repo_root.join(".github/workflows");
    if !workflows_dir.is_dir() {
        return Ok(Json(json!({
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "repoRoot": repo_root,
            "workflowsDir": workflows_dir,
            "flows": [],
            "warnings": ["No \".github/workflows\" directory found for this repository."],
        })));
    }

    let mut flows = Vec::new();
    let mut warnings = Vec::new();
    let entries = std::fs::read_dir(&workflows_dir)
        .map_err(map_io_error("读取 GitHub Actions workflows 失败"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !path.is_file() || !(name.ends_with(".yaml") || name.ends_with(".yml")) {
            continue;
        }

        match parse_workflow_flow(&repo_root, &path) {
            Ok(Some(flow)) => flows.push(flow),
            Ok(None) => warnings.push(format!(
                "Skipped {name} because it does not define any jobs."
            )),
            Err(error) => warnings.push(format!("Failed to parse {name}: {error}")),
        }
    }

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "workflowsDir": workflows_dir,
        "flows": flows,
        "warnings": warnings,
    })))
}

async fn get_harness_hooks(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Harness hooks 上下文无效",
        "读取 Hook Runtime 失败",
    ))?;

    let hooks_dir = repo_root.join(".husky");
    let (runtime_profiles, mut warnings) = load_hook_runtime_profiles(&repo_root);
    let config_file = load_hook_runtime_config_source(&repo_root);
    let review_trigger_file = load_review_trigger_config_source(&repo_root);
    let known_profiles = runtime_profiles
        .iter()
        .filter_map(|profile| profile["name"].as_str())
        .map(ToString::to_string)
        .collect::<HashSet<_>>();

    if !hooks_dir.is_dir() {
        warnings.push("No \".husky\" directory found for this repository.".to_string());
        let profiles = build_profile_summaries(&repo_root, &[], &runtime_profiles, &mut warnings);
        return Ok(Json(json!({
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "repoRoot": repo_root,
            "hooksDir": hooks_dir,
            "configFile": config_file,
            "reviewTriggerFile": review_trigger_file,
            "hookFiles": [],
            "profiles": profiles,
            "warnings": warnings,
        })));
    }

    let profile_regex = Regex::new(r"--profile(?:=|\s+)([A-Za-z0-9_-]+)\b").unwrap();
    let entries = std::fs::read_dir(&hooks_dir).map_err(map_io_error("读取 Hook Runtime 失败"))?;
    let mut hook_files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !path.is_file() || name.starts_with('_') {
            continue;
        }

        let source = read_to_string(&path).map_err(map_internal_error("读取 Hook Runtime 失败"))?;
        let explicit_profile = profile_regex
            .captures(&source)
            .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()));
        let runtime_profile_name = if source.contains("tools/hook-runtime/src/cli.ts") {
            detect_runtime_profile(name, &source, &known_profiles)
        } else {
            None
        };

        if source.contains("tools/hook-runtime/src/cli.ts") {
            if let Some(explicit_profile) = explicit_profile.as_deref() {
                if !known_profiles.contains(explicit_profile) {
                    warnings.push(format!(
                        "Hook \"{name}\" references unknown profile \"{explicit_profile}\" not defined in hooks.yaml."
                    ));
                }
            }
        }

        let relative_path = path
            .strip_prefix(&repo_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        hook_files.push(json!({
            "name": name,
            "relativePath": relative_path,
            "source": source,
            "triggerCommand": extract_trigger_command(&source),
            "kind": if runtime_profile_name.is_some() { "runtime-profile" } else { "shell-command" },
            "runtimeProfileName": runtime_profile_name,
            "skipEnvVar": if source.contains("SKIP_HOOKS") { Some("SKIP_HOOKS") } else { None::<&str> },
        }));
    }

    let profiles =
        build_profile_summaries(&repo_root, &hook_files, &runtime_profiles, &mut warnings);
    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "hooksDir": hooks_dir,
        "configFile": config_file,
        "reviewTriggerFile": review_trigger_file,
        "hookFiles": hook_files,
        "profiles": profiles,
        "warnings": warnings,
    })))
}

async fn get_hook_preview(
    State(state): State<AppState>,
    Query(query): Query<HookPreviewQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let Some(profile) = query
        .profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "缺少或无效的 profile" })),
        ));
    };

    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Harness hook preview 上下文无效",
        "执行 Hook Runtime preview 失败",
    ))?;

    let mode = if query.mode.as_deref() == Some("live") {
        "live"
    } else {
        "dry-run"
    };
    let mut command = vec![
        "--import",
        "tsx",
        "tools/hook-runtime/src/cli.ts",
        "run",
        "--profile",
        profile,
        "--output",
        "jsonl",
        "--allow-review-unavailable",
        "--tail-lines",
        "20",
    ];
    if mode == "dry-run" {
        command.push("--dry-run");
    }

    let output = Command::new("node")
        .args(&command)
        .current_dir(&repo_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(map_io_error("执行 Hook Runtime preview 失败"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let events = parse_json_lines(&stdout);

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "profile": profile,
        "mode": mode,
        "ok": output.status.success(),
        "exitCode": output.status.code().unwrap_or(1),
        "command": std::iter::once("node").chain(command.into_iter()).collect::<Vec<_>>(),
        "phaseResults": to_phase_results(&events),
        "metricResults": to_metric_results(&events),
        "eventSample": events.iter().rev().take(20).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>(),
        "stderr": stderr,
    })))
}

async fn get_harness_instructions(
    State(state): State<AppState>,
    Query(query): Query<InstructionsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let include_audit = parse_bool_param(query.include_audit.as_deref());
    let audit_provider = query
        .audit_provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            std::env::var("HARNESS_INSTRUCTION_AUDIT_PROVIDER")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "codex".to_string());
    let workspace_id = query
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string();

    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error(
        "Harness 指导文档上下文无效",
        "读取 Harness 指导文档失败",
    ))?;

    for file_name in ["CLAUDE.md", "AGENTS.md"] {
        let absolute_path = repo_root.join(file_name);
        if absolute_path.is_file() {
            let source = read_to_string(&absolute_path)
                .map_err(map_internal_error("读取 Harness 指导文档失败"))?;
            let relative_path = absolute_path
                .strip_prefix(&repo_root)
                .unwrap_or(&absolute_path)
                .to_string_lossy()
                .to_string();
            let audit = if include_audit {
                run_instruction_audit(&repo_root, &workspace_id, &source, &audit_provider).await
            } else {
                Value::Null
            };
            return Ok(Json(json!({
                "generatedAt": chrono::Utc::now().to_rfc3339(),
                "repoRoot": repo_root,
                "fileName": file_name,
                "relativePath": relative_path,
                "source": source,
                "fallbackUsed": file_name != "CLAUDE.md",
                "audit": audit,
            })));
        }
    }

    Err((
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "未找到仓库指导文档",
            "details": "Expected one of: CLAUDE.md, AGENTS.md",
        })),
    ))
}

fn parse_bool_param(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(str::to_lowercase)
        .is_some_and(|normalized| matches!(normalized.as_str(), "1" | "true" | "yes" | "on"))
}

fn parse_workflow_flow(repo_root: &Path, path: &Path) -> Result<Option<Value>, String> {
    let source = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed =
        serde_yaml::from_str::<serde_yaml::Value>(&source).map_err(|error| error.to_string())?;
    let trigger = parsed.get("on").or_else(|| parsed.get("true"));
    let event = summarize_event(trigger);
    let jobs = parsed
        .get("jobs")
        .and_then(serde_yaml::Value::as_mapping)
        .map(|jobs| {
            jobs.iter()
                .filter_map(|(job_id, job)| {
                    let job_id = job_id.as_str()?;
                    let job = job.as_mapping()?;
                    Some(json!({
                        "id": job_id,
                        "name": yaml_str(job.get(serde_yaml::Value::String("name".to_string()))).unwrap_or(job_id),
                        "runner": summarize_runner(job.get(serde_yaml::Value::String("runs-on".to_string()))),
                        "kind": infer_job_kind(job),
                        "stepCount": job.get(serde_yaml::Value::String("steps".to_string())).and_then(serde_yaml::Value::as_sequence).map(|steps| steps.len()),
                        "needs": normalize_yaml_string_list(job.get(serde_yaml::Value::String("needs".to_string()))),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if jobs.is_empty() {
        return Ok(None);
    }

    let id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("workflow");
    let relative_path = path
        .strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    Ok(Some(json!({
        "id": id,
        "name": parsed.get("name").and_then(serde_yaml::Value::as_str).unwrap_or(id),
        "event": event,
        "yaml": source,
        "jobs": jobs,
        "relativePath": relative_path,
    })))
}

fn load_hook_runtime_profiles(repo_root: &Path) -> (Vec<Value>, Vec<String>) {
    let config_path = repo_root.join("docs/fitness/runtime/hooks.yaml");
    let mut warnings = Vec::new();
    if !config_path.exists() {
        warnings.push("Missing docs/fitness/runtime/hooks.yaml.".to_string());
        return (Vec::new(), warnings);
    }

    let Ok(raw) = std::fs::read_to_string(&config_path) else {
        warnings.push("Failed to read hooks.yaml.".to_string());
        return (Vec::new(), warnings);
    };
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&raw).unwrap_or_default();
    let profiles = parsed
        .get("profiles")
        .and_then(serde_yaml::Value::as_mapping)
        .map(|profiles| {
            profiles
                .iter()
                .filter_map(|(name, configured)| {
                    let name = name.as_str()?;
                    let configured = configured.as_mapping()?;
                    let phases = normalize_yaml_string_list(
                        configured.get(serde_yaml::Value::String("phases".to_string())),
                    );
                    let metrics = normalize_yaml_string_list(
                        configured.get(serde_yaml::Value::String("metrics".to_string())),
                    );
                    if phases.is_empty() {
                        warnings.push(format!(
                            "Profile \"{name}\" has no configured phases in hooks.yaml."
                        ));
                    }
                    if metrics.is_empty() {
                        warnings.push(format!(
                            "Profile \"{name}\" has no configured metrics in hooks.yaml."
                        ));
                    }
                    Some(json!({
                        "name": name,
                        "phases": phases,
                        "metrics": metrics,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if profiles.is_empty() {
        warnings.push("hooks.yaml does not define any profiles.".to_string());
    }
    (profiles, warnings)
}

fn load_hook_runtime_config_source(repo_root: &Path) -> Value {
    let config_path = repo_root.join("docs/fitness/runtime/hooks.yaml");
    if !config_path.exists() {
        return Value::Null;
    }
    let source = std::fs::read_to_string(&config_path).unwrap_or_default();
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&source).unwrap_or_default();
    json!({
        "relativePath": "docs/fitness/runtime/hooks.yaml",
        "source": source,
        "schema": parsed.get("schema").and_then(serde_yaml::Value::as_str),
    })
}

fn load_review_trigger_config_source(repo_root: &Path) -> Value {
    let config_path = repo_root.join("docs/fitness/review-triggers.yaml");
    if !config_path.exists() {
        return Value::Null;
    }

    let source = std::fs::read_to_string(&config_path).unwrap_or_default();
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&source).unwrap_or_default();
    let rules = parsed
        .get("review_triggers")
        .and_then(serde_yaml::Value::as_sequence)
        .map(|rules| {
            rules
                .iter()
                .filter_map(serde_yaml::Value::as_mapping)
                .map(|rule| {
                    let boundaries = rule
                        .get(serde_yaml::Value::String("boundaries".to_string()))
                        .and_then(serde_yaml::Value::as_mapping)
                        .map(|mapping| {
                            mapping
                                .iter()
                                .filter_map(|(name, paths)| {
                                    let name = name.as_str()?.trim();
                                    if name.is_empty() {
                                        return None;
                                    }
                                    Some(json!({
                                        "name": name,
                                        "paths": normalize_yaml_string_list(Some(paths)),
                                    }))
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let paths =
                        normalize_yaml_string_list(rule.get(serde_yaml::Value::String("paths".to_string())));
                    let evidence_paths = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("evidence_paths".to_string())),
                    );
                    let directories = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("directories".to_string())),
                    );
                    let path_count = paths.len();
                    let evidence_path_count = evidence_paths.len();
                    let boundary_count = boundaries.len();
                    let directory_count = directories.len();
                    json!({
                        "name": yaml_str(rule.get(serde_yaml::Value::String("name".to_string()))).unwrap_or("unknown"),
                        "type": yaml_str(rule.get(serde_yaml::Value::String("type".to_string()))).unwrap_or("unknown"),
                        "severity": yaml_str(rule.get(serde_yaml::Value::String("severity".to_string()))).unwrap_or("medium"),
                        "action": yaml_str(rule.get(serde_yaml::Value::String("action".to_string()))).unwrap_or("require_human_review"),
                        "paths": paths,
                        "evidencePaths": evidence_paths,
                        "boundaries": boundaries,
                        "directories": directories,
                        "pathCount": path_count,
                        "evidencePathCount": evidence_path_count,
                        "boundaryCount": boundary_count,
                        "directoryCount": directory_count,
                        "minBoundaries": yaml_i64(rule.get(serde_yaml::Value::String("min_boundaries".to_string()))),
                        "maxFiles": yaml_i64(rule.get(serde_yaml::Value::String("max_files".to_string()))),
                        "maxAddedLines": yaml_i64(rule.get(serde_yaml::Value::String("max_added_lines".to_string()))),
                        "maxDeletedLines": yaml_i64(rule.get(serde_yaml::Value::String("max_deleted_lines".to_string()))),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "relativePath": "docs/fitness/review-triggers.yaml",
        "source": source,
        "ruleCount": rules.len(),
        "rules": rules,
    })
}

fn build_profile_summaries(
    repo_root: &Path,
    hook_files: &[Value],
    runtime_profiles: &[Value],
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    let metric_lookup = load_metric_lookup(repo_root, warnings);
    runtime_profiles
        .iter()
        .map(|profile| {
            let name = profile["name"].as_str().unwrap_or_default();
            let fallback_metrics = profile["metrics"].as_array().cloned().unwrap_or_default();
            let hooks = hook_files
                .iter()
                .filter(|hook| hook["runtimeProfileName"].as_str() == Some(name))
                .filter_map(|hook| hook["name"].as_str().map(ToString::to_string))
                .collect::<Vec<_>>();
            let metrics = fallback_metrics
                .iter()
                .filter_map(Value::as_str)
                .map(|metric_name| {
                    metric_lookup.get(metric_name).cloned().unwrap_or_else(|| {
                        json!({
                            "name": metric_name,
                            "command": "",
                            "description": "",
                            "hardGate": false,
                            "resolved": false,
                        })
                    })
                })
                .collect::<Vec<_>>();

            json!({
                "name": name,
                "phases": profile["phases"].clone(),
                "fallbackMetrics": fallback_metrics,
                "metrics": metrics,
                "hooks": hooks,
            })
        })
        .collect()
}

fn load_metric_lookup(repo_root: &Path, warnings: &mut Vec<String>) -> HashMap<String, Value> {
    let mut lookup = HashMap::new();
    let manifest_path = repo_root.join("docs/fitness/manifest.yaml");
    if !manifest_path.exists() {
        warnings.push(
            "Missing docs/fitness/manifest.yaml, so hook metrics could not be resolved."
                .to_string(),
        );
        return lookup;
    }

    let Ok(raw_manifest) = std::fs::read_to_string(&manifest_path) else {
        warnings.push("Failed to read hook metric manifest.".to_string());
        return lookup;
    };
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&raw_manifest).unwrap_or_default();
    let evidence_files = parsed
        .get("evidence_files")
        .and_then(serde_yaml::Value::as_sequence)
        .cloned()
        .unwrap_or_default();

    for relative_file in evidence_files.iter().filter_map(serde_yaml::Value::as_str) {
        let absolute_file = repo_root.join(relative_file);
        if !absolute_file.exists() {
            warnings.push(format!("Missing metric source file: {relative_file}"));
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&absolute_file) else {
            warnings.push(format!(
                "Failed to read metric source file: {relative_file}"
            ));
            continue;
        };
        let Some((frontmatter, _)) = extract_frontmatter(&raw) else {
            continue;
        };
        let Ok(parsed) = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter) else {
            continue;
        };
        let Some(metrics) = parsed
            .get("metrics")
            .and_then(serde_yaml::Value::as_sequence)
        else {
            continue;
        };
        for metric in metrics {
            let Some(metric) = metric.as_mapping() else {
                continue;
            };
            let Some(name) = yaml_str(metric.get(serde_yaml::Value::String("name".to_string())))
            else {
                continue;
            };
            let Some(command) =
                yaml_str(metric.get(serde_yaml::Value::String("command".to_string())))
            else {
                continue;
            };
            lookup.insert(
                name.to_string(),
                json!({
                    "name": name,
                    "command": command,
                    "description": yaml_str(metric.get(serde_yaml::Value::String("description".to_string()))).unwrap_or(""),
                    "hardGate": metric.get(serde_yaml::Value::String("hard_gate".to_string())).and_then(serde_yaml::Value::as_bool).unwrap_or(false),
                    "resolved": true,
                    "sourceFile": relative_file,
                }),
            );
        }
    }

    lookup
}

fn detect_runtime_profile(
    hook_name: &str,
    source: &str,
    known_profiles: &HashSet<String>,
) -> Option<String> {
    let profile_regex = Regex::new(r"--profile(?:=|\s+)([A-Za-z0-9_-]+)\b").unwrap();
    let explicit_profile = profile_regex
        .captures(source)
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()));
    if let Some(explicit_profile) = explicit_profile {
        if known_profiles.contains(&explicit_profile) {
            return Some(explicit_profile);
        }
    }
    if known_profiles.contains(hook_name) {
        return Some(hook_name.to_string());
    }
    None
}

fn extract_trigger_command(source: &str) -> String {
    if let Some(runtime_line) = source
        .lines()
        .map(str::trim)
        .find(|line| line.contains("tools/hook-runtime/src/cli.ts"))
    {
        return runtime_line.to_string();
    }

    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .next_back()
        .unwrap_or("(no command detected)")
        .to_string()
}

fn summarize_runner(value: Option<&serde_yaml::Value>) -> String {
    match value {
        Some(serde_yaml::Value::String(value)) if !value.trim().is_empty() => {
            value.trim().to_string()
        }
        Some(serde_yaml::Value::Sequence(values)) => {
            let parts = values
                .iter()
                .filter_map(serde_yaml::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if parts.is_empty() {
                "unspecified".to_string()
            } else {
                parts.join(" + ")
            }
        }
        Some(serde_yaml::Value::Mapping(_)) => "expression".to_string(),
        _ => "unspecified".to_string(),
    }
}

fn infer_job_kind(job: &serde_yaml::Mapping) -> &'static str {
    if job.contains_key(serde_yaml::Value::String("environment".to_string())) {
        "approval"
    } else if summarize_runner(job.get(serde_yaml::Value::String("runs-on".to_string())))
        .to_lowercase()
        .contains("release")
    {
        "release"
    } else {
        "job"
    }
}

fn summarize_event(value: Option<&serde_yaml::Value>) -> String {
    match value {
        Some(serde_yaml::Value::String(value)) => value.to_string(),
        Some(serde_yaml::Value::Sequence(values)) => values
            .iter()
            .filter_map(serde_yaml::Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        Some(serde_yaml::Value::Mapping(values)) => values
            .keys()
            .filter_map(serde_yaml::Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        _ => "unknown".to_string(),
    }
}

fn normalize_yaml_string_list(value: Option<&serde_yaml::Value>) -> Vec<String> {
    match value {
        Some(serde_yaml::Value::String(value)) if !value.trim().is_empty() => {
            vec![value.trim().to_string()]
        }
        Some(serde_yaml::Value::Sequence(values)) => values
            .iter()
            .filter_map(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn yaml_str(value: Option<&serde_yaml::Value>) -> Option<&str> {
    value.and_then(serde_yaml::Value::as_str)
}

fn yaml_i64(value: Option<&serde_yaml::Value>) -> Option<i64> {
    match value {
        Some(serde_yaml::Value::Number(number)) => number.as_i64(),
        Some(serde_yaml::Value::String(value)) => value.trim().parse::<i64>().ok(),
        _ => None,
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
