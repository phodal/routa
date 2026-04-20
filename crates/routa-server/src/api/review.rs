use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::{routing::post, Json, Router};
use routa_core::git::{compute_historical_related_files, HistoricalRelatedFile};
use serde::{Deserialize, Serialize};

use crate::error::ServerError;
use crate::state::AppState;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};

const CONFIG_CANDIDATES: &[&str] = &[
    "AGENTS.md",
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    "next.config.ts",
    "Cargo.toml",
    ".routa/review-rules.md",
];

pub fn router() -> Router<AppState> {
    Router::new().route("/analyze", post(analyze_review))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReviewAnalyzeRequest {
    repo_path: Option<String>,
    base: Option<String>,
    head: Option<String>,
    rules_file: Option<String>,
    model: Option<String>,
    validator_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewConfigSnippet {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewAnalysisPayload {
    repo_path: String,
    repo_root: String,
    base: String,
    head: String,
    changed_files: Vec<String>,
    diff_stat: String,
    diff: String,
    config_snippets: Vec<ReviewConfigSnippet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    review_rules: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    graph_review_context: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    historical_related_files: Option<Vec<HistoricalRelatedFile>>,
}

#[derive(Debug, Serialize)]
struct ReviewRawOutput {
    context: String,
    candidates: String,
    validated: String,
}

#[derive(Debug, Serialize)]
struct ReviewAnalyzeResponse {
    payload: ReviewAnalysisPayload,
    context: serde_json::Value,
    candidates: serde_json::Value,
    validated: serde_json::Value,
    raw: ReviewRawOutput,
}

#[derive(Clone, Copy)]
enum ReviewWorkerType {
    Context,
    Candidates,
    Validator,
}

impl ReviewWorkerType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::Candidates => "candidates",
            Self::Validator => "validator",
        }
    }
}

async fn analyze_review(
    Json(body): Json<ReviewAnalyzeRequest>,
) -> Result<Json<ReviewAnalyzeResponse>, ServerError> {
    load_dotenv();

    let repo_root = resolve_repo_root(body.repo_path.as_deref())?;
    let base = body.base.unwrap_or_else(|| "HEAD~1".to_string());
    let head = body.head.unwrap_or_else(|| "HEAD".to_string());
    let payload = build_review_payload(&repo_root, &base, &head, body.rules_file.as_deref())?;
    let specialist = load_pr_reviewer()?;
    let caller = AcpAgentCaller::new();
    let base_model = body.model.as_deref();
    let validator_model = body.validator_model.as_deref().or(base_model);

    let context_raw = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Context,
        &build_worker_prompt(ReviewWorkerType::Context, &payload, None, None)?,
        base_model,
    )
    .await?;
    let candidates_raw = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Candidates,
        &build_worker_prompt(
            ReviewWorkerType::Candidates,
            &payload,
            Some(&context_raw),
            None,
        )?,
        base_model,
    )
    .await?;
    let validated_raw = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Validator,
        &build_worker_prompt(
            ReviewWorkerType::Validator,
            &payload,
            Some(&context_raw),
            Some(&candidates_raw),
        )?,
        validator_model,
    )
    .await?;

    Ok(Json(ReviewAnalyzeResponse {
        context: parse_json_loose(&context_raw),
        candidates: parse_json_loose(&candidates_raw),
        validated: parse_json_loose(&validated_raw),
        raw: ReviewRawOutput {
            context: context_raw,
            candidates: candidates_raw,
            validated: validated_raw,
        },
        payload,
    }))
}

async fn call_review_worker(
    caller: &AcpAgentCaller,
    specialist: &SpecialistDef,
    worker_type: ReviewWorkerType,
    user_request: &str,
    model_override: Option<&str>,
) -> Result<String, ServerError> {
    let config = build_agent_call_config(specialist, model_override)?;
    let prompt = build_specialist_prompt(specialist, worker_type, user_request);
    let response = caller
        .call(&config, &prompt)
        .await
        .map_err(ServerError::Internal)?;

    if !response.success {
        return Err(ServerError::Internal(response.error.unwrap_or_else(|| {
            format!("Review worker {} failed", worker_type.as_str())
        })));
    }

    Ok(response.content.trim().to_string())
}

fn build_agent_call_config(
    specialist: &SpecialistDef,
    model_override: Option<&str>,
) -> Result<AgentCallConfig, ServerError> {
    let api_key = env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| env::var("ANTHROPIC_API_KEY"))
        .map_err(|_| {
            ServerError::Internal(
                "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.".to_string(),
            )
        })?;

    Ok(AgentCallConfig {
        adapter: specialist
            .default_adapter
            .clone()
            .unwrap_or_else(|| "claude-code-sdk".to_string()),
        base_url: env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
        api_key,
        model: model_override
            .map(ToString::to_string)
            .or_else(|| specialist.default_model.clone())
            .unwrap_or_else(|| {
                env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "GLM-4.7".to_string())
            }),
        max_turns: 1,
        max_tokens: 8192,
        temperature: None,
        system_prompt: specialist.system_prompt.clone(),
        env: HashMap::new(),
        timeout_secs: 300,
    })
}

fn build_specialist_prompt(
    specialist: &SpecialistDef,
    worker_type: ReviewWorkerType,
    user_request: &str,
) -> String {
    let mut prompt = specialist.system_prompt.clone();
    if let Some(reminder) = &specialist.role_reminder {
        if !reminder.trim().is_empty() {
            prompt.push_str(&format!("\n\n---\n**Reminder:** {reminder}"));
        }
    }
    prompt.push_str(&format!(
        "\n\n---\n\nInternal Review Worker: {}\nYou are an internal sub-agent invocation under the single public PR Reviewer specialist.\n\n{}",
        worker_type.as_str(),
        user_request
    ));
    prompt
}

fn load_pr_reviewer() -> Result<SpecialistDef, ServerError> {
    let mut loader = SpecialistLoader::new();
    loader.load_default_dirs();

    loader
        .get("pr-reviewer")
        .cloned()
        .or_else(|| {
            SpecialistLoader::builtin_specialists()
                .into_iter()
                .find(|specialist| specialist.id == "pr-reviewer")
        })
        .ok_or_else(|| {
            ServerError::Internal("Missing specialist definition: pr-reviewer".to_string())
        })
}

fn build_worker_prompt(
    worker_type: ReviewWorkerType,
    payload: &ReviewAnalysisPayload,
    context_output: Option<&str>,
    candidates_output: Option<&str>,
) -> Result<String, ServerError> {
    let payload_json = serde_json::to_string_pretty(payload).map_err(|err| {
        ServerError::Internal(format!("Failed to serialize review payload: {err}"))
    })?;

    let prompt = match worker_type {
        ReviewWorkerType::Context => [
            "You are acting as the Context Gathering sub-agent for PR review.",
            "Build project review context from this git review payload.",
            "Return strict JSON only.",
            &payload_json,
        ]
        .join("\n\n"),
        ReviewWorkerType::Candidates => [
            "You are acting as the Diff Analysis sub-agent for PR review.",
            "Review this change set against the project context below.",
            "Return strict JSON only.",
            "## Project Context",
            context_output.unwrap_or("{}"),
            "## Review Payload",
            &payload_json,
        ]
        .join("\n\n"),
        ReviewWorkerType::Validator => [
            "You are acting as the Finding Validation sub-agent for PR review.",
            "Filter review candidates using confidence scoring and exclusion rules.",
            "Return strict JSON only.",
            "## Project Context",
            context_output.unwrap_or("{}"),
            "## Raw Candidates",
            candidates_output.unwrap_or("{}"),
            "## Review Payload",
            &payload_json,
        ]
        .join("\n\n"),
    };

    Ok(prompt)
}

fn build_review_payload(
    repo_root: &Path,
    base: &str,
    head: &str,
    rules_file: Option<&str>,
) -> Result<ReviewAnalysisPayload, ServerError> {
    let diff_range = format!("{base}..{head}");
    let historical_related_files =
        compute_historical_related_files(repo_root, &diff_range, head, 20)
            .ok()
            .filter(|items| !items.is_empty());

    Ok(ReviewAnalysisPayload {
        repo_path: repo_root.display().to_string(),
        repo_root: repo_root.display().to_string(),
        base: base.to_string(),
        head: head.to_string(),
        changed_files: git_exec(repo_root, ["diff", "--name-only", &diff_range])?
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect(),
        diff_stat: git_exec(repo_root, ["diff", "--stat", &diff_range])?
            .trim()
            .to_string(),
        diff: truncate(
            &git_exec(repo_root, ["diff", "--unified=3", &diff_range])?,
            40_000,
        ),
        config_snippets: load_config_snippets(repo_root)?,
        review_rules: load_review_rules(repo_root, rules_file)?,
        graph_review_context: load_graph_review_context(repo_root, base),
        historical_related_files,
    })
}

fn resolve_repo_root(repo_path: Option<&str>) -> Result<PathBuf, ServerError> {
    let cwd = repo_path
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let output = crate::git::git_command()
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&cwd)
        .output()
        .map_err(|err| ServerError::Internal(format!("Failed to run git rev-parse: {err}")))?;

    if !output.status.success() {
        return Err(ServerError::BadRequest(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

fn load_config_snippets(repo_root: &Path) -> Result<Vec<ReviewConfigSnippet>, ServerError> {
    let mut snippets = Vec::new();
    for relative_path in CONFIG_CANDIDATES {
        let file_path = repo_root.join(relative_path);
        if !file_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&file_path).map_err(|err| {
            ServerError::Internal(format!("Failed to read {}: {}", file_path.display(), err))
        })?;
        snippets.push(ReviewConfigSnippet {
            path: (*relative_path).to_string(),
            content: truncate(&content, 4_000),
        });
    }
    Ok(snippets)
}

fn load_review_rules(
    repo_root: &Path,
    rules_file: Option<&str>,
) -> Result<Option<String>, ServerError> {
    let target_path = rules_file
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join(".routa").join("review-rules.md"));

    if !target_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&target_path).map_err(|err| {
        ServerError::Internal(format!("Failed to read {}: {}", target_path.display(), err))
    })?;
    Ok(Some(truncate(&content, 8_000)))
}

fn git_exec<const N: usize>(cwd: &Path, args: [&str; N]) -> Result<String, ServerError> {
    let output = crate::git::git_command()
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|err| ServerError::Internal(format!("Failed to run git: {err}")))?;

    if !output.status.success() {
        return Err(ServerError::Internal(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_json_loose(raw: &str) -> serde_json::Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return serde_json::Value::Null;
    }

    serde_json::from_str(trimmed)
        .or_else(|_| {
            let fence_stripped = trimmed
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            serde_json::from_str(fence_stripped)
        })
        .unwrap_or_else(|_| serde_json::json!({ "raw": trimmed }))
}

fn truncate(content: &str, max_chars: usize) -> String {
    if content.len() <= max_chars {
        return content.to_string();
    }
    format!("{}\n\n[truncated]", &content[..max_chars])
}

fn load_graph_review_context(repo_root: &Path, base: &str) -> Option<serde_json::Value> {
    let output = entrix_command(repo_root)
        .args(["graph", "review-context", "--base", base, "--json"])
        .current_dir(repo_root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).ok()
}

fn entrix_command(repo_root: &Path) -> Command {
    let debug_binary = repo_root
        .join("target")
        .join("debug")
        .join(if cfg!(windows) {
            "entrix.exe"
        } else {
            "entrix"
        });
    if debug_binary.exists() {
        Command::new(debug_binary)
    } else {
        let mut command = Command::new("cargo");
        command.args(["run", "-q", "-p", "entrix", "--"]);
        command
    }
}

fn load_dotenv() {
    let candidates = [".env", ".env.local"];
    for file in candidates {
        let path = Path::new(file);
        if !path.exists() {
            continue;
        }
        if let Ok(content) = fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = trimmed.split_once('=') {
                    env::set_var(key.trim(), value.trim().trim_matches('"'));
                }
            }
        }
    }
}
