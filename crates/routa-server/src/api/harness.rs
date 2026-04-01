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
use routa_core::codeowners::detect_codeowners;
use routa_core::harness::detect_repo_signals;
use routa_core::spec_detector::detect_spec_sources;
use serde::{Deserialize, Serialize};
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
        .route("/agent-hooks", get(get_agent_hooks))
        .route("/codeowners", get(get_codeowners))
        .route("/design-decisions", get(get_design_decisions))
        .route("/github-actions", get(get_github_actions))
        .route("/hooks", get(get_harness_hooks))
        .route("/hooks/preview", get(get_hook_preview))
        .route("/instructions", get(get_harness_instructions))
        .route("/repo-signals", get(get_harness_repo_signals))
        .route("/spec-sources", get(get_spec_sources))
}

async fn get_agent_hooks(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing agent hooks context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await
    .map_err(map_context_error(
        "Agent hooks context invalid",
        "Failed to read agent hooks",
    ))?;

    let mut all_hooks = Vec::new();
    let mut config_files: Vec<Value> = Vec::new();
    let mut warnings = Vec::new();

    /* 1. Scan standard hook config files (Claude Code, Qoder, Codex) */
    let standard_locations = [
        (".claude/settings.json", "claude-code"),
        (".claude/settings.local.json", "claude-code"),
        (".qoder/settings.json", "qoder"),
        (".qoder/settings.local.json", "qoder"),
        (".codex/hooks.json", "codex"),
    ];
    for (rel_path, provider) in &standard_locations {
        let full_path = repo_root.join(rel_path);
        if !full_path.exists() {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&full_path) {
            let (hooks, cf) = parse_standard_hooks_config(&raw, rel_path, provider, &mut warnings);
            all_hooks.extend(hooks);
            config_files.push(cf);
        }
    }

    /* 2. Scan custom YAML config (routa-specific) */
    let (yaml_hooks, yaml_cf, yaml_warnings) = load_agent_hook_config(&repo_root);
    all_hooks.extend(yaml_hooks);
    if yaml_cf != Value::Null {
        config_files.push(yaml_cf);
    }
    warnings.extend(yaml_warnings);

    if all_hooks.is_empty() && config_files.is_empty() {
        warnings.push("No agent hook configuration found.".to_string());
    }

    let primary_config = config_files.first().cloned().unwrap_or(Value::Null);

    Ok(Json(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "repoRoot": repo_root,
        "configFile": primary_config,
        "configFiles": config_files,
        "hooks": all_hooks,
        "warnings": warnings,
    })))
}

async fn get_codeowners(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing CODEOWNERS context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await?;

    let report = detect_codeowners(&repo_root).map_err(ServerError::Internal)?;
    Ok(Json(serde_json::to_value(report).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize CODEOWNERS report: {error}"))
    })?))
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

async fn get_spec_sources(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing spec sources context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await?;

    let report = detect_spec_sources(&repo_root).map_err(ServerError::Internal)?;
    Ok(Json(serde_json::to_value(report).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize report: {error}"))
    })?))
}

async fn get_design_decisions(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing design decisions context. Provide workspaceId, codebaseId, or repoPath.",
    )
    .await?;

    let report = detect_design_decisions(&repo_root).map_err(ServerError::Internal)?;
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
    let release_trigger_file = load_release_trigger_config_source(&repo_root);
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
            "releaseTriggerFile": release_trigger_file,
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
        "releaseTriggerFile": release_trigger_file,
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

fn load_release_trigger_config_source(repo_root: &Path) -> Value {
    let config_path = repo_root.join("docs/fitness/release-triggers.yaml");
    if !config_path.exists() {
        return Value::Null;
    }

    let source = std::fs::read_to_string(&config_path).unwrap_or_default();
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&source).unwrap_or_default();
    let rules = parsed
        .get("release_triggers")
        .and_then(serde_yaml::Value::as_sequence)
        .map(|rules| {
            rules
                .iter()
                .filter_map(serde_yaml::Value::as_mapping)
                .map(|rule| {
                    let patterns = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("patterns".to_string())),
                    );
                    let apply_to = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("apply_to".to_string())),
                    );
                    let paths = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("paths".to_string())),
                    );
                    let group_by = normalize_yaml_string_list(
                        rule.get(serde_yaml::Value::String("group_by".to_string())),
                    );
                    let pattern_count = patterns.len();
                    let apply_to_count = apply_to.len();
                    let path_count = paths.len();
                    let baseline = rule
                        .get(serde_yaml::Value::String("baseline".to_string()))
                        .and_then(serde_yaml::Value::as_str)
                        .filter(|s| !s.trim().is_empty())
                        .map(ToString::to_string);
                    let max_growth_percent = rule
                        .get(serde_yaml::Value::String("max_growth_percent".to_string()))
                        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)));
                    let min_growth_bytes = rule
                        .get(serde_yaml::Value::String("min_growth_bytes".to_string()))
                        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)));
                    json!({
                        "name": yaml_str(rule.get(serde_yaml::Value::String("name".to_string()))).unwrap_or("unknown"),
                        "type": yaml_str(rule.get(serde_yaml::Value::String("type".to_string()))).unwrap_or("unknown"),
                        "severity": yaml_str(rule.get(serde_yaml::Value::String("severity".to_string()))).unwrap_or("medium"),
                        "action": yaml_str(rule.get(serde_yaml::Value::String("action".to_string()))).unwrap_or("require_human_review"),
                        "patterns": patterns,
                        "applyTo": apply_to,
                        "paths": paths,
                        "groupBy": group_by,
                        "baseline": baseline,
                        "maxGrowthPercent": max_growth_percent,
                        "minGrowthBytes": min_growth_bytes,
                        "patternCount": pattern_count,
                        "applyToCount": apply_to_count,
                        "pathCount": path_count,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "relativePath": "docs/fitness/release-triggers.yaml",
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignDecisionReport {
    generated_at: String,
    repo_root: String,
    sources: Vec<DesignDecisionSource>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignDecisionSource {
    kind: String,
    label: String,
    root_path: String,
    confidence: String,
    status: String,
    artifacts: Vec<DesignDecisionArtifact>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignDecisionArtifact {
    id: String,
    title: String,
    path: String,
    #[serde(rename = "type")]
    artifact_type: String,
    status: String,
    summary: Option<String>,
    code_refs: Vec<String>,
}

fn detect_design_decisions(repo_root: &Path) -> Result<DesignDecisionReport, String> {
    let mut warnings = Vec::new();
    let mut sources = Vec::new();

    if let Some(source) = read_architecture_source(repo_root, &mut warnings)? {
        sources.push(source);
    }
    if let Some(source) = read_adr_source(repo_root, &mut warnings)? {
        sources.push(source);
    }

    Ok(DesignDecisionReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        sources,
        warnings,
    })
}

fn read_architecture_source(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> Result<Option<DesignDecisionSource>, String> {
    let candidates = [
        (
            "docs/ARCHITECTURE.md",
            repo_root.join("docs/ARCHITECTURE.md"),
        ),
        (
            "docs/architecture.md",
            repo_root.join("docs/architecture.md"),
        ),
        ("docs/architcture.md", repo_root.join("docs/architcture.md")),
    ];

    let Some((relative_path, absolute_path)) = candidates
        .iter()
        .find(|(_, absolute_path)| absolute_path.is_file())
    else {
        warnings.push(
            "No canonical architecture document found under docs/ARCHITECTURE.md.".to_string(),
        );
        return Ok(None);
    };

    let source = std::fs::read_to_string(absolute_path)
        .map_err(|error| format!("Failed to read {}: {error}", absolute_path.display()))?;
    let artifact = build_architecture_artifact(relative_path, &source);

    Ok(Some(DesignDecisionSource {
        kind: "canonical-doc".to_string(),
        label: "Architecture".to_string(),
        root_path: "docs".to_string(),
        confidence: "high".to_string(),
        status: "documents-present".to_string(),
        artifacts: vec![artifact],
    }))
}

fn read_adr_source(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> Result<Option<DesignDecisionSource>, String> {
    let adr_dir = repo_root.join("docs/adr");
    if !adr_dir.is_dir() {
        warnings.push("No docs/adr directory found for design decision loading.".to_string());
        return Ok(None);
    }

    let mut artifacts = Vec::new();
    let mut entries = std::fs::read_dir(&adr_dir)
        .map_err(|error| format!("Failed to read {}: {error}", adr_dir.display()))?
        .flatten()
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name.eq_ignore_ascii_case("README.md")
            || !file_name.to_ascii_lowercase().ends_with(".md")
        {
            continue;
        }
        if !path.is_file() {
            continue;
        }

        let source = std::fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        let Some(artifact) = build_adr_artifact(&format!("docs/adr/{file_name}"), &source) else {
            warnings.push(format!(
                "Skipped ADR without recognizable title format: docs/adr/{file_name}"
            ));
            continue;
        };
        artifacts.push(artifact);
    }

    if artifacts.is_empty() {
        return Ok(None);
    }

    Ok(Some(DesignDecisionSource {
        kind: "decision-records".to_string(),
        label: "ADRs".to_string(),
        root_path: "docs/adr".to_string(),
        confidence: "high".to_string(),
        status: "documents-present".to_string(),
        artifacts,
    }))
}

fn build_architecture_artifact(source_path: &str, source: &str) -> DesignDecisionArtifact {
    let purpose = extract_frontmatter_value(source, "purpose");
    let core_principles = extract_section_body(source, "Core Principles");
    let summary = purpose
        .or_else(|| extract_first_paragraph(core_principles.as_deref()))
        .or_else(|| {
            Some(
                "Canonical architecture overview for runtime boundaries and cross-backend invariants.".to_string(),
            )
        });

    DesignDecisionArtifact {
        id: "architecture-top-level".to_string(),
        title: "Top-level architecture contract".to_string(),
        path: source_path.to_string(),
        artifact_type: "architecture".to_string(),
        status: "canonical".to_string(),
        summary,
        code_refs: extract_list_items(core_principles.as_deref()),
    }
}

fn build_adr_artifact(source_path: &str, source: &str) -> Option<DesignDecisionArtifact> {
    let title_regex = Regex::new(r"(?m)^#\s+ADR\s+(\d+):\s+(.+)$").ok()?;
    let captures = title_regex.captures(source)?;
    let adr_number = captures.get(1)?.as_str();
    let title = captures.get(2)?.as_str().trim().to_string();

    let decision_section = extract_section_body(source, "Decision");
    let consequences_section = extract_section_body(source, "Consequences");
    let code_refs_section = extract_section_body(source, "Code References");
    let summary = extract_first_paragraph(decision_section.as_deref())
        .or_else(|| extract_first_paragraph(consequences_section.as_deref()))
        .or_else(|| Some("Accepted design decision recorded in ADR.".to_string()));

    Some(DesignDecisionArtifact {
        id: format!("adr-{adr_number}"),
        title,
        path: source_path.to_string(),
        artifact_type: "adr".to_string(),
        status: normalize_adr_status(source),
        summary,
        code_refs: extract_code_references(code_refs_section.as_deref()),
    })
}

fn extract_frontmatter_value(source: &str, key: &str) -> Option<String> {
    let (frontmatter, _) = extract_frontmatter(source)?;
    frontmatter.lines().find_map(|line| {
        let (candidate_key, candidate_value) = line.split_once(':')?;
        if candidate_key.trim() == key {
            Some(
                candidate_value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            )
        } else {
            None
        }
    })
}

fn extract_section_body(source: &str, heading: &str) -> Option<String> {
    let pattern = format!(
        r"(?ms)^##\s+{}\s*$\n(.*?)(?=\n##\s+|\z)",
        regex::escape(heading)
    );
    let regex = Regex::new(&pattern).ok()?;
    let captures = regex.captures(source)?;
    Some(captures.get(1)?.as_str().trim().to_string())
}

fn extract_first_paragraph(source: Option<&str>) -> Option<String> {
    let source = source?.trim();
    if source.is_empty() {
        return None;
    }

    for paragraph in source.split("\n\n") {
        let candidate = paragraph.trim();
        let bytes = candidate.as_bytes();
        let digit_prefix_len = bytes
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        let is_ordered_list_item = digit_prefix_len > 0
            && bytes.get(digit_prefix_len) == Some(&b'.')
            && bytes.get(digit_prefix_len + 1) == Some(&b' ');
        if candidate.is_empty()
            || candidate.starts_with("- ")
            || candidate.starts_with("```")
            || is_ordered_list_item
        {
            continue;
        }
        return Some(
            candidate
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    None
}

fn extract_list_items(source: Option<&str>) -> Vec<String> {
    let Some(source) = source else {
        return Vec::new();
    };
    let line_regex = Regex::new(r"^\s*(?:-|\d+\.)\s+(.+)$").ok();
    source
        .lines()
        .filter_map(|line| {
            line_regex
                .as_ref()?
                .captures(line)
                .and_then(|captures| captures.get(1))
                .map(|item| item.as_str().trim().to_string())
        })
        .collect()
}

fn extract_code_references(source: Option<&str>) -> Vec<String> {
    let backtick_regex = Regex::new(r"`([^`]+)`").ok();
    extract_list_items(source)
        .into_iter()
        .map(|item| {
            if let Some(regex) = &backtick_regex {
                if let Some(captures) = regex.captures(&item) {
                    if let Some(value) = captures.get(1) {
                        return value.as_str().trim().to_string();
                    }
                }
            }

            item.split('—')
                .next()
                .unwrap_or(&item)
                .split('-')
                .next()
                .unwrap_or(&item)
                .trim()
                .to_string()
        })
        .collect()
}

fn normalize_adr_status(source: &str) -> String {
    let Some(regex) = Regex::new(r"(?mi)^- Status:\s+(.+)$").ok() else {
        return "unknown".to_string();
    };
    let Some(captures) = regex.captures(source) else {
        return "unknown".to_string();
    };
    let Some(status) = captures
        .get(1)
        .map(|value| value.as_str().trim().to_ascii_lowercase())
    else {
        return "unknown".to_string();
    };
    match status.as_str() {
        "accepted" => "accepted".to_string(),
        "superseded" => "superseded".to_string(),
        "deprecated" => "deprecated".to_string(),
        _ => "unknown".to_string(),
    }
}

const KNOWN_AGENT_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
];

const BLOCKABLE_AGENT_EVENTS: &[&str] = &["PreToolUse", "UserPromptSubmit", "PermissionRequest"];

const KNOWN_AGENT_HOOK_TYPES: &[&str] = &["command", "http", "prompt", "agent"];

/// Parse standard hooks config files (Claude Code / Qoder / Codex format)
fn parse_standard_hooks_config(
    raw: &str,
    rel_path: &str,
    provider: &str,
    warnings: &mut Vec<String>,
) -> (Vec<Value>, Value) {
    let parsed: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => {
            warnings.push(format!("Failed to parse {rel_path} as JSON."));
            return (
                Vec::new(),
                json!({ "relativePath": rel_path, "source": raw, "provider": provider }),
            );
        }
    };

    let hooks_map = match parsed.get("hooks").and_then(|v| v.as_object()) {
        Some(m) => m,
        None => {
            return (
                Vec::new(),
                json!({ "relativePath": rel_path, "source": raw, "provider": provider }),
            );
        }
    };

    let blockable: HashSet<&str> = BLOCKABLE_AGENT_EVENTS.iter().copied().collect();
    let mut hooks = Vec::new();

    for (event_name, groups) in hooks_map {
        let groups_arr = match groups.as_array() {
            Some(a) => a,
            None => continue,
        };

        for group in groups_arr {
            let matcher = group
                .get("matcher")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());

            let hook_entries = match group.get("hooks").and_then(|v| v.as_array()) {
                Some(a) => a,
                None => continue,
            };

            for entry in hook_entries {
                let hook_type = entry
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("command");
                let blocking = blockable.contains(event_name.as_str());
                let timeout = entry
                    .get("timeout")
                    .and_then(|v| v.as_i64())
                    .filter(|t| *t > 0)
                    .unwrap_or(10);

                let mut hook = json!({
                    "event": event_name,
                    "type": hook_type,
                    "timeout": timeout,
                    "blocking": blocking,
                    "source": format!("{provider}:{rel_path}"),
                });

                if let Some(m) = matcher {
                    hook["matcher"] = json!(m);
                }
                if let Some(c) = entry.get("command").and_then(|v| v.as_str()) {
                    hook["command"] = json!(c);
                }
                if let Some(u) = entry.get("url").and_then(|v| v.as_str()) {
                    hook["url"] = json!(u);
                }
                if let Some(p) = entry.get("prompt").and_then(|v| v.as_str()) {
                    hook["prompt"] = json!(p);
                }

                hooks.push(hook);
            }
        }
    }

    let config_file = json!({
        "relativePath": rel_path,
        "source": raw,
        "provider": provider,
    });

    (hooks, config_file)
}

fn load_agent_hook_config(repo_root: &Path) -> (Vec<Value>, Value, Vec<String>) {
    let config_path = repo_root.join("docs/fitness/runtime/agent-hooks.yaml");
    let mut warnings = Vec::new();

    if !config_path.exists() {
        warnings.push(
            "Missing docs/fitness/runtime/agent-hooks.yaml — no agent hooks configured."
                .to_string(),
        );
        return (Vec::new(), Value::Null, warnings);
    }

    let raw = match std::fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(_) => {
            warnings.push("Failed to read agent-hooks.yaml.".to_string());
            return (Vec::new(), Value::Null, warnings);
        }
    };

    let parsed: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap_or_default();

    let config_file = json!({
        "relativePath": "docs/fitness/runtime/agent-hooks.yaml",
        "source": raw,
        "schema": parsed.get("schema").and_then(serde_yaml::Value::as_str),
    });

    let raw_hooks = match parsed.get("hooks").and_then(serde_yaml::Value::as_sequence) {
        Some(seq) => seq,
        None => return (Vec::new(), config_file, warnings),
    };

    let known_events: HashSet<&str> = KNOWN_AGENT_EVENTS.iter().copied().collect();
    let blockable_events: HashSet<&str> = BLOCKABLE_AGENT_EVENTS.iter().copied().collect();
    let known_types: HashSet<&str> = KNOWN_AGENT_HOOK_TYPES.iter().copied().collect();

    let mut hooks = Vec::new();

    for entry in raw_hooks {
        let mapping = match entry.as_mapping() {
            Some(m) => m,
            None => continue,
        };

        let event = match yaml_str(mapping.get(serde_yaml::Value::String("event".into()))) {
            Some(e) if !e.trim().is_empty() => e.trim(),
            _ => {
                warnings.push("Skipped hook entry with missing event field.".to_string());
                continue;
            }
        };

        if !known_events.contains(event) {
            warnings.push(format!(
                "Unknown agent hook event: \"{event}\". Known events: {}.",
                KNOWN_AGENT_EVENTS.join(", ")
            ));
            continue;
        }

        let hook_type = yaml_str(mapping.get(serde_yaml::Value::String("type".into())))
            .map(str::trim)
            .unwrap_or("command");

        if !known_types.contains(hook_type) {
            warnings.push(format!(
                "Unknown hook type \"{hook_type}\" for event \"{event}\". Known types: {}.",
                KNOWN_AGENT_HOOK_TYPES.join(", ")
            ));
            continue;
        }

        let blocking_raw = mapping
            .get(serde_yaml::Value::String("blocking".into()))
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(false);

        if blocking_raw && !blockable_events.contains(event) {
            warnings.push(format!(
                "Event \"{event}\" does not support blocking. Setting blocking to false."
            ));
        }
        let blocking = blocking_raw && blockable_events.contains(event);

        let timeout = yaml_i64(mapping.get(serde_yaml::Value::String("timeout".into())))
            .filter(|t| *t > 0)
            .unwrap_or(10);

        let matcher = yaml_str(mapping.get(serde_yaml::Value::String("matcher".into())))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let command = yaml_str(mapping.get(serde_yaml::Value::String("command".into())));
        let url = yaml_str(mapping.get(serde_yaml::Value::String("url".into())));
        let prompt = yaml_str(mapping.get(serde_yaml::Value::String("prompt".into())));
        let description = yaml_str(mapping.get(serde_yaml::Value::String("description".into())));

        let mut hook = json!({
            "event": event,
            "type": hook_type,
            "timeout": timeout,
            "blocking": blocking,
            "source": "routa:docs/fitness/runtime/agent-hooks.yaml",
        });

        if let Some(m) = matcher {
            hook["matcher"] = json!(m);
        }
        if let Some(c) = command {
            hook["command"] = json!(c);
        }
        if let Some(u) = url {
            hook["url"] = json!(u);
        }
        if let Some(p) = prompt {
            hook["prompt"] = json!(p);
        }
        if let Some(d) = description {
            hook["description"] = json!(d);
        }

        hooks.push(hook);
    }

    (hooks, config_file, warnings)
}
