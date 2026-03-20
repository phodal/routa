//! `routa review` — read-only Specialist-backed code review analysis.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use routa_core::state::AppState;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::stream_parser::{
    extract_agent_output_from_history, extract_agent_output_from_process_output,
    extract_text_from_prompt_result, extract_update_text, update_contains_turn_complete,
};

const CONFIG_CANDIDATES: &[&str] = &[
    "AGENTS.md",
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    "next.config.ts",
    "Cargo.toml",
    ".routa/review-rules.md",
];
const SECURITY_REVIEW_VENV_DIR: &str = ".venv-security-review";
const SECURITY_REVIEW_HOME_DIR: &str = ".tmp-home";
const SECURITY_SEMGREP_RULES_PATH: &str = "resources/review/semgrep-security-v1.yaml";
const SECURITY_DISPATCH_MAX_SPECIALISTS: usize = 3;
const SECURITY_DISPATCH_OUTPUT_PREVIEW_CHARS: usize = 6_000;

pub struct ReviewAnalyzeOptions<'a> {
    pub base: &'a str,
    pub head: &'a str,
    pub repo_path: Option<&'a str>,
    pub rules_file: Option<&'a str>,
    pub verbose: bool,
    pub as_json: bool,
    pub payload_only: bool,
    pub specialist_dir: Option<&'a str>,
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

#[derive(Debug, Serialize)]
struct ReviewInputPayload {
    repo_path: String,
    repo_root: String,
    base: String,
    head: String,
    changed_files: Vec<String>,
    diff_stat: String,
    diff: String,
    config_snippets: Vec<ConfigSnippet>,
    review_rules: Option<String>,
}

#[derive(Debug, Serialize)]
struct ConfigSnippet {
    path: String,
    content: String,
}

#[derive(Debug, Serialize, Clone)]
struct SecurityEvidencePack {
    total_candidates: usize,
    buckets: Vec<SecurityCandidateBucket>,
}

#[derive(Debug, Serialize)]
struct SecurityReviewPayload {
    repo_path: String,
    repo_root: String,
    base: String,
    head: String,
    changed_files: Vec<String>,
    diff_stat: String,
    diff: String,
    config_snippets: Vec<ConfigSnippet>,
    review_rules: Option<String>,
    security_guidance: Option<String>,
    evidence_pack: SecurityEvidencePack,
    specialist_dispatch_plan: Vec<SecuritySpecialistDispatch>,
    specialist_reports: Vec<SecuritySpecialistReport>,
    pre_merged_findings: Vec<SecurityRootFinding>,
    tool_trace: Vec<ToolTrace>,
    heuristic_candidates: Vec<SecurityCandidate>,
    semgrep_candidates: Vec<SecurityCandidate>,
    fitness_review_context: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
struct SecurityCandidateBucket {
    category: String,
    candidate_count: usize,
    candidates: Vec<SecurityCandidate>,
}

#[derive(Debug, Serialize, Clone)]
struct ToolTrace {
    tool: String,
    status: String,
    details: String,
}

#[derive(Debug, Serialize, Clone)]
struct SecurityCandidate {
    rule_id: String,
    category: String,
    severity: String,
    summary: String,
    locations: Vec<String>,
    evidence: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SecurityRootFinding {
    #[serde(default)]
    title: String,
    #[serde(default)]
    severity: String,
    #[serde(default)]
    root_cause: String,
    #[serde(default)]
    affected_locations: Vec<String>,
    #[serde(default)]
    attack_path: String,
    #[serde(default)]
    why_it_matters: String,
    #[serde(default)]
    guardrails_present: Vec<String>,
    #[serde(default)]
    recommended_fix: String,
    #[serde(default)]
    related_variants: Vec<String>,
    #[serde(default)]
    confidence: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct SecuritySpecialistDispatch {
    specialist_id: String,
    categories: Vec<String>,
    candidate_count: usize,
    reason: String,
}

#[derive(Debug, Serialize, Clone)]
struct SecuritySpecialistReport {
    specialist_id: String,
    status: String,
    categories: Vec<String>,
    findings: Vec<SecurityRootFinding>,
    trace: Vec<String>,
    parse_error: Option<String>,
    output_preview: String,
}

#[derive(Debug, Serialize)]
struct SecurityDispatchInput {
    specialist_id: String,
    categories: Vec<String>,
    evidence_pack: SecurityEvidencePack,
    repo_path: String,
    base: String,
    head: String,
    diff: String,
    changed_files: Vec<String>,
    tool_trace: Vec<ToolTrace>,
    security_guidance: Option<String>,
    candidates: Vec<SecurityCandidate>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SecuritySpecialistOutput {
    #[serde(default)]
    specialist_id: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    findings: Vec<SecurityRootFinding>,
    #[serde(default)]
    notes: Option<String>,
}

struct SecurityCandidateWorkload {
    specialist_id: String,
    categories: Vec<String>,
    candidates: Vec<SecurityCandidate>,
    max_candidates: Option<usize>,
    reason: String,
}

pub async fn analyze(_state: &AppState, options: ReviewAnalyzeOptions<'_>) -> Result<(), String> {
    load_dotenv();

    let repo_root = resolve_repo_root(options.repo_path)?;
    let payload =
        build_review_input_payload(&repo_root, options.base, options.head, options.rules_file)?;
    let specialist = load_pr_reviewer(options.specialist_dir)?;
    let caller = AcpAgentCaller::new();

    let context_prompt = build_worker_prompt(ReviewWorkerType::Context, &payload, None, None)?;
    let context_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Context,
        &context_prompt,
        options.verbose,
    )
    .await?;

    let candidates_prompt = build_worker_prompt(
        ReviewWorkerType::Candidates,
        &payload,
        Some(&context_output),
        None,
    )?;
    let candidates_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Candidates,
        &candidates_prompt,
        options.verbose,
    )
    .await?;

    let validator_prompt = build_worker_prompt(
        ReviewWorkerType::Validator,
        &payload,
        Some(&context_output),
        Some(&candidates_output),
    )?;
    let final_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Validator,
        &validator_prompt,
        options.verbose,
    )
    .await?;

    if final_output.is_empty() {
        return Err("Review workflow completed without producing an output.".to_string());
    }

    println!();
    println!("═══ Review Result ═══");
    if options.as_json {
        match serde_json::from_str::<serde_json::Value>(&final_output) {
            Ok(value) => println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|err| format!("Failed to format review output: {}", err))?
            ),
            Err(_) => println!("{}", final_output),
        }
    } else {
        println!("{}", final_output);
    }

    Ok(())
}

pub async fn security(state: &AppState, options: ReviewAnalyzeOptions<'_>) -> Result<(), String> {
    // Resolve PATH for provider commands (opencode/claude/codex, etc.).
    let full_path = routa_core::shell_env::full_path();
    std::env::set_var("PATH", full_path);

    load_dotenv();

    let repo_root = resolve_repo_root(options.repo_path)?;
    let payload =
        build_security_review_payload(&repo_root, options.base, options.head, options.rules_file)?;

    if options.payload_only {
        println!(
            "{}",
            serde_json::to_string_pretty(&payload)
                .map_err(|err| format!("Failed to format security review payload: {}", err))?
        );
        return Ok(());
    }

    // Use a writable home directory for local ACP runtimes (avoids failures to write
    // runtime config under restricted system HOME locations in CLI contexts).
    let _acp_runtime_env = SecurityAcpRuntimeEnv::install(&repo_root)?;

    let specialist = load_specialist_by_id("security-reviewer", options.specialist_dir)?;

    let (dispatch_plan, specialist_reports) =
        dispatch_security_specialists(state, options.specialist_dir, &payload, options.verbose)
            .await?;
    let pre_merged_findings =
        merge_specialist_findings(&payload.pre_merged_findings, &specialist_reports);

    let mut final_payload = payload;
    final_payload.specialist_dispatch_plan = dispatch_plan;
    final_payload.specialist_reports = specialist_reports;
    final_payload.pre_merged_findings = pre_merged_findings;

    let prompt = build_security_specialist_prompt(&final_payload)?;
    let provider = resolve_security_provider(&specialist);

    if options.verbose {
        println!(
            "── Security Review Specialist: {} (provider: {}) ──",
            specialist.id, provider
        );
    }

    let final_output = call_security_specialist_via_acp(
        state,
        &specialist,
        &prompt,
        options.verbose,
        &provider,
        &final_payload.repo_root,
    )
    .await?
    .trim()
    .to_string();
    if final_output.is_empty() {
        return Err("Security review completed without producing an output.".to_string());
    }

    println!();
    println!("═══ Security Review Result ═══");
    if options.as_json {
        match serde_json::from_str::<serde_json::Value>(&final_output) {
            Ok(value) => println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|err| format!("Failed to format security review output: {}", err))?
            ),
            Err(_) => println!("{}", final_output),
        }
    } else {
        println!("{}", final_output);
    }

    Ok(())
}

struct SecurityAcpRuntimeEnv {
    home: Option<OsString>,
    xdg_config_home: Option<OsString>,
    xdg_data_home: Option<OsString>,
    xdg_cache_home: Option<OsString>,
    enabled: bool,
}

impl SecurityAcpRuntimeEnv {
    fn install(repo_root: &Path) -> Result<Self, String> {
        let acp_home = repo_root.join(SECURITY_REVIEW_HOME_DIR).join("acp");
        let previous_home = std::env::var_os("HOME");
        let previous_xdg_config_home = std::env::var_os("XDG_CONFIG_HOME");
        let previous_xdg_data_home = std::env::var_os("XDG_DATA_HOME");
        let previous_xdg_cache_home = std::env::var_os("XDG_CACHE_HOME");

        if !needs_isolated_acp_runtime() {
            return Ok(Self {
                home: None,
                xdg_config_home: None,
                xdg_data_home: None,
                xdg_cache_home: None,
                enabled: false,
            });
        }

        let acp_runtime_env = prepare_isolated_acp_runtime(&acp_home, previous_home.as_deref())?;

        std::env::set_var("HOME", &acp_runtime_env.home_dir);
        std::env::set_var("XDG_CONFIG_HOME", &acp_runtime_env.xdg_config_home);
        std::env::set_var("XDG_DATA_HOME", &acp_runtime_env.xdg_data_home);
        std::env::set_var("XDG_CACHE_HOME", &acp_runtime_env.xdg_cache_home);

        Ok(Self {
            home: previous_home,
            xdg_config_home: previous_xdg_config_home,
            xdg_data_home: previous_xdg_data_home,
            xdg_cache_home: previous_xdg_cache_home,
            enabled: true,
        })
    }
}

impl Drop for SecurityAcpRuntimeEnv {
    fn drop(&mut self) {
        if !self.enabled {
            return;
        }

        if let Some(home) = &self.home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        if let Some(xdg_config_home) = &self.xdg_config_home {
            std::env::set_var("XDG_CONFIG_HOME", xdg_config_home);
        } else {
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        if let Some(xdg_data_home) = &self.xdg_data_home {
            std::env::set_var("XDG_DATA_HOME", xdg_data_home);
        } else {
            std::env::remove_var("XDG_DATA_HOME");
        }

        if let Some(xdg_cache_home) = &self.xdg_cache_home {
            std::env::set_var("XDG_CACHE_HOME", xdg_cache_home);
        } else {
            std::env::remove_var("XDG_CACHE_HOME");
        }
    }
}

#[derive(Debug)]
struct IsolatedAcpRuntimeHome {
    home_dir: PathBuf,
    xdg_config_home: PathBuf,
    xdg_data_home: PathBuf,
    xdg_cache_home: PathBuf,
}

fn needs_isolated_acp_runtime() -> bool {
    let base_home = match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home),
        None => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };
    !is_writable_with_probe(&base_home.join(".config"))
        || !is_writable_with_probe(&base_home.join(".local").join("share"))
        || !is_writable_with_probe(&base_home.join(".cache"))
}

fn prepare_isolated_acp_runtime(
    acp_home: &Path,
    fallback_home: Option<&std::ffi::OsStr>,
) -> Result<IsolatedAcpRuntimeHome, String> {
    let xdg_config_home = acp_home.join(".config");
    let xdg_data_home = acp_home.join(".local").join("share");
    let xdg_cache_home = acp_home.join(".cache");

    for dir in [&xdg_config_home, &xdg_data_home, &xdg_cache_home] {
        fs::create_dir_all(dir).map_err(|err| {
            format!(
                "Failed to prepare isolated ACP runtime dir {}: {}",
                dir.display(),
                err
            )
        })?;
    }

    let _ = fallback_home;
    if let Some(raw_home) = fallback_home {
        let home_dir = Path::new(raw_home);
        let source_entries = [
            home_dir.join(".config").join("opencode"),
            home_dir.join(".local").join("share").join("opencode"),
            home_dir.join(".cache").join("opencode"),
        ];
        for source in source_entries {
            if !source.exists() {
                continue;
            }
            let rel = source
                .strip_prefix(home_dir)
                .map_err(|err| format!("Invalid source path {}: {}", source.display(), err))?;

            let destination = acp_home.join(rel);
            if source.is_file() {
                if let Err(err) = copy_file_with_parent(&source, &destination) {
                    tracing::warn!(
                        "Skip copying ACP runtime file {} -> {}: {}",
                        source.display(),
                        destination.display(),
                        err
                    );
                }
            } else if source.is_dir() {
                if let Err(err) = copy_dir_recursive(&source, &destination) {
                    tracing::warn!(
                        "Skip copying ACP runtime directory {} -> {}: {}",
                        source.display(),
                        destination.display(),
                        err
                    );
                }
            }
        }
    }

    Ok(IsolatedAcpRuntimeHome {
        home_dir: acp_home.to_path_buf(),
        xdg_config_home,
        xdg_data_home,
        xdg_cache_home,
    })
}

fn is_writable_with_probe(path: &Path) -> bool {
    if !fs::create_dir_all(path).is_ok() {
        return false;
    }
    let marker = path.join(".routa-acp-write-check");
    if fs::write(&marker, b"ok").is_err() {
        return false;
    }
    let _ = fs::remove_file(&marker);
    true
}

fn copy_file_with_parent(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create parent dir {}: {}", parent.display(), err))?;
    }
    fs::copy(src, dst).map_err(|err| {
        format!(
            "Failed to copy {} -> {}: {}",
            src.display(),
            dst.display(),
            err
        )
    })?;
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|err| {
        format!(
            "Failed to create destination dir {}: {}",
            dst.display(),
            err
        )
    })?;

    for entry in src
        .read_dir()
        .map_err(|err| format!("Failed to read source dir {}: {}", src.display(), err))?
    {
        let entry = entry
            .map_err(|err| format!("Failed to read source entry in {}: {}", src.display(), err))?;
        let source_path = entry.path();
        let destination_path = dst.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            copy_file_with_parent(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

async fn call_review_worker(
    caller: &AcpAgentCaller,
    specialist: &SpecialistDef,
    worker_type: ReviewWorkerType,
    user_request: &str,
    verbose: bool,
) -> Result<String, String> {
    let config = build_agent_call_config(specialist)?;
    let prompt = build_specialist_prompt(specialist, worker_type, user_request);

    if verbose {
        println!(
            "── Internal Review Worker: {} (model: {}) ──",
            worker_type.as_str(),
            config.model
        );
    }

    let response = caller.call(&config, &prompt).await?;
    if !response.success {
        return Err(response
            .error
            .unwrap_or_else(|| format!("Review worker {} failed", worker_type.as_str())));
    }

    Ok(response.content.trim().to_string())
}

async fn call_security_specialist_via_acp(
    state: &AppState,
    specialist: &SpecialistDef,
    user_request: &str,
    verbose: bool,
    provider: &str,
    cwd: &str,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let workspace_id = "default".to_string();
    let cwd = cwd.to_string();

    if verbose {
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║  Security Specialist ACP Execution                    ║");
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║  Specialist: {:<40} ║", truncate(&specialist.id, 40));
        println!("║  Provider  : {:<40} ║", truncate(&provider, 40));
        println!("║  Role      : {:<40} ║", truncate(&specialist.role, 40));
        println!("║  Workspace : {:<40} ║", truncate(&workspace_id, 40));
        println!("║  CWD       : {:<40} ║", truncate(&cwd, 40));
        println!("╚══════════════════════════════════════════════════════════╝");

        print_security_acp_runtime_diagnostics(provider, &cwd, verbose);
    }

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some(specialist.role.clone()),
            specialist.default_model.clone(),
            None,
            None,
            None,
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    let mut maybe_rx = state.acp_manager.subscribe(&session_id).await;
    let prompt = build_security_final_prompt(specialist, user_request);

    let prompt_response = state
        .acp_manager
        .prompt(&session_id, &prompt)
        .await
        .map_err(|error| format!("Failed to send prompt: {}", error))?;

    let streamed_output = if let Some(mut rx) = maybe_rx.take() {
        wait_for_turn_complete_with_updates(state, &session_id, &mut rx, verbose).await?
    } else {
        wait_for_turn_complete_without_updates(state, &session_id).await?;
        String::new()
    };

    let history = state
        .acp_manager
        .get_session_history(&session_id)
        .await
        .unwrap_or_default();
    let output = if streamed_output.trim().is_empty() {
        extract_agent_output_from_history(&history)
    } else {
        streamed_output
    };
    let output = if output.trim().is_empty() {
        extract_text_from_prompt_result(&prompt_response).unwrap_or_default()
    } else {
        output
    };
    let output = if output.trim().is_empty() {
        extract_agent_output_from_process_output(&history)
    } else {
        output
    };

    state.acp_manager.kill_session(&session_id).await;

    if output.trim().is_empty() {
        let response_preview = truncate(&prompt_response.to_string(), 600);
        return Err(format!(
            "Security specialist completed without producing an output. prompt_response={}, history_entries={}",
            response_preview,
            history.len()
        ));
    }

    Ok(output)
}

fn resolve_security_specialist_provider(specialist: &SpecialistDef) -> String {
    std::env::var("ROUTA_REVIEW_PROVIDER")
        .ok()
        .or_else(|| specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string())
}

fn build_security_final_prompt(specialist: &SpecialistDef, user_request: &str) -> String {
    let mut prompt = specialist.system_prompt.clone();
    if let Some(reminder) = &specialist.role_reminder {
        if !reminder.trim().is_empty() {
            prompt.push_str(&format!("\n\n---\n**Reminder:** {}", reminder));
        }
    }
    prompt.push_str(&format!("\n\n---\n\n## User Request\n\n{}", user_request));
    prompt
}

async fn wait_for_turn_complete_with_updates(
    state: &AppState,
    session_id: &str,
    rx: &mut tokio::sync::broadcast::Receiver<serde_json::Value>,
    verbose: bool,
) -> Result<String, String> {
    let mut renderer = if verbose {
        Some(crate::commands::tui::TuiRenderer::new())
    } else {
        None
    };

    let mut collected_output = String::new();
    let mut idle_count = 0u32;
    let max_idle = 600;
    let idle_with_output_threshold = 15;

    loop {
        match tokio::time::timeout(Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                if let Some(renderer) = renderer.as_mut() {
                    renderer.handle_update(&update);
                }

                if let Some(text) = update
                    .get("params")
                    .and_then(|params| params.get("update"))
                    .and_then(|value| value.as_object())
                    .and_then(extract_update_text)
                {
                    collected_output.push_str(&text);
                }
                idle_count = 0;

                let is_done = update
                    .get("params")
                    .and_then(|params| params.get("update"))
                    .and_then(|update| update.get("sessionUpdate"))
                    .and_then(|value| value.as_str())
                    == Some("turn_complete");
                if is_done {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            }
            Ok(Err(err)) => match err {
                tokio::sync::broadcast::error::RecvError::Lagged(_) => {
                    // Large sessions (for example codex-acp) can emit many updates quickly.
                    // Keep consuming the latest updates instead of terminating early.
                    idle_count = 0;
                }
                tokio::sync::broadcast::error::RecvError::Closed => {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            },
            Err(_) => {
                idle_count += 1;
                if idle_count >= idle_with_output_threshold && !collected_output.trim().is_empty() {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
                if idle_count >= max_idle {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }

                if !state.acp_manager.is_alive(session_id).await {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            }
        }

        if let Some(history) = state.acp_manager.get_session_history(session_id).await {
            if update_contains_turn_complete(&history) {
                if let Some(renderer) = renderer.as_mut() {
                    renderer.finish();
                }
                if collected_output.trim().is_empty() {
                    return Ok(extract_agent_output_from_history(&history));
                }
                return Ok(collected_output);
            }
        } else if !state.acp_manager.is_alive(session_id).await {
            if let Some(renderer) = renderer.as_mut() {
                renderer.finish();
            }
            return Ok(collected_output);
        }
    }
}

fn resolve_security_provider(specialist: &SpecialistDef) -> String {
    std::env::var("ROUTA_REVIEW_PROVIDER")
        .ok()
        .or_else(|| specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string())
}

async fn wait_for_turn_complete_without_updates(
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    let mut idle_ticks = 0u32;
    let max_idle = 600;
    loop {
        match state.acp_manager.get_session_history(session_id).await {
            Some(history) if update_contains_turn_complete(&history) => return Ok(()),
            Some(_) => {}
            None => {
                return Err("Session disappeared before completion.".to_string());
            }
        }

        if !state.acp_manager.is_alive(session_id).await {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
        idle_ticks += 1;
        if idle_ticks >= max_idle {
            return Ok(());
        }
    }
}

fn load_pr_reviewer(specialist_dir: Option<&str>) -> Result<SpecialistDef, String> {
    load_specialist_by_id("pr-reviewer", specialist_dir)
}

fn load_specialist_by_id(
    specialist_id: &str,
    specialist_dir: Option<&str>,
) -> Result<SpecialistDef, String> {
    let mut loader = SpecialistLoader::new();
    if let Some(dir) = specialist_dir {
        loader.load_dir(dir)?;
    } else {
        loader.load_default_dirs();
    }

    loader
        .get(specialist_id)
        .cloned()
        .or_else(|| {
            SpecialistLoader::builtin_specialists()
                .into_iter()
                .find(|specialist| specialist.id == specialist_id)
        })
        .ok_or_else(|| format!("Missing specialist definition: {}", specialist_id))
}

fn build_agent_call_config(specialist: &SpecialistDef) -> Result<AgentCallConfig, String> {
    let use_mock_adapter = std::env::var("ROUTA_REVIEW_MOCK")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"));

    let api_key = if use_mock_adapter {
        "mock-key".to_string()
    } else {
        std::env::var("ANTHROPIC_AUTH_TOKEN")
            .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
            .map_err(|_| {
                "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.".to_string()
            })?
    };

    let adapter = if use_mock_adapter {
        "mock".to_string()
    } else {
        specialist
            .default_adapter
            .clone()
            .unwrap_or_else(|| "claude-code-sdk".to_string())
    };

    Ok(AgentCallConfig {
        adapter,
        base_url: std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
        api_key,
        model: specialist.default_model.clone().unwrap_or_else(|| {
            std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "GLM-4.7".to_string())
        }),
        max_turns: 1,
        max_tokens: 8192,
        temperature: None,
        system_prompt: specialist.system_prompt.clone(),
        env: std::collections::HashMap::new(),
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
            prompt.push_str(&format!("\n\n---\n**Reminder:** {}", reminder));
        }
    }
    prompt.push_str(&format!(
        "\n\n---\n\nInternal Review Worker: {}\nYou are an internal sub-agent invocation under the single public PR Reviewer specialist.\n\n{}",
        worker_type.as_str(),
        user_request
    ));
    prompt
}

fn build_worker_prompt(
    worker_type: ReviewWorkerType,
    payload: &ReviewInputPayload,
    context_output: Option<&str>,
    candidates_output: Option<&str>,
) -> Result<String, String> {
    let payload_json = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Failed to serialize review payload: {}", err))?;

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

fn provider_runtime_binary(provider: &str) -> String {
    let normalized = provider.to_lowercase();
    match normalized.as_str() {
        "codex" => "codex-acp".to_string(),
        _ => normalized,
    }
}

fn print_security_acp_runtime_diagnostics(provider: &str, cwd: &str, verbose: bool) {
    if !verbose {
        return;
    }

    let env_home = std::env::var("HOME").unwrap_or_else(|_| "<unset>".to_string());
    let env_path = std::env::var("PATH").unwrap_or_else(|_| "<unset>".to_string());
    let trimmed_path = if env_path.len() > 140 {
        format!("{}...", &env_path[..137])
    } else {
        env_path
    };

    let binary = provider_runtime_binary(provider);
    let resolved_binary =
        routa_core::shell_env::which(&binary).unwrap_or_else(|| "<not found in PATH>".to_string());
    let cfg_home = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| {
        if env_home == "<unset>" {
            "<unset>".to_string()
        } else {
            format!("{}/.config", env_home)
        }
    });
    let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
        if env_home == "<unset>" {
            "<unset>".to_string()
        } else {
            format!("{}/.local/share", env_home)
        }
    });
    let cache_home = std::env::var("XDG_CACHE_HOME").unwrap_or_else(|_| {
        if env_home == "<unset>" {
            "<unset>".to_string()
        } else {
            format!("{}/.cache", env_home)
        }
    });

    println!("┌──────────────── ACP Runtime Diagnostics ────────────────┐");
    println!("│ provider       = {:<34} │", truncate(provider, 34));
    println!("│ runtime binary = {:<34} │", truncate(&binary, 34));
    println!(
        "│ resolved       = {:<34} │",
        truncate(&resolved_binary, 34)
    );
    println!("│ HOME          = {:<34} │", truncate(&env_home, 34));
    println!("│ XDG_CONFIG    = {:<34} │", truncate(&cfg_home, 34));
    println!("│ XDG_DATA_HOME = {:<34} │", truncate(&data_home, 34));
    println!("│ XDG_CACHE_HOME= {:<34} │", truncate(&cache_home, 34));
    println!("│ CWD           = {:<34} │", truncate(cwd, 34));
    println!("│ PATH          = {:<34} │", truncate(&trimmed_path, 34));
    println!(
        "│ OPENCODE_BIN  = {:<34} │",
        truncate(
            &std::env::var("OPENCODE_BIN").unwrap_or_else(|_| "-".to_string()),
            34
        )
    );
    println!(
        "│ CODEX_ACP_BIN = {:<34} │",
        truncate(
            &std::env::var("CODEX_ACP_BIN").unwrap_or_else(|_| "-".to_string()),
            34
        )
    );

    let probe_path = PathBuf::from(&env_home).join(".config");
    let probe_status = match fs::metadata(&probe_path) {
        Ok(meta) if meta.is_dir() => match fs::create_dir_all(probe_path.join("routa-acp-debug")) {
            Ok(()) => "ok".to_string(),
            Err(err) => format!("write-failed: {}", err),
        },
        Ok(_) => "invalid-config-dir".to_string(),
        Err(err) => format!("missing-config-dir: {}", err),
    };
    println!("│ $HOME/.config = {:<34} │", truncate(&probe_status, 34));
    println!("└───────────────────────────────────────────────────────┘");
}

fn build_security_specialist_prompt(payload: &SecurityReviewPayload) -> Result<String, String> {
    let payload_json = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Failed to serialize security review payload: {}", err))?;

    Ok([
        "You are running a tool-driven security review.",
        "You are the final aggregation specialist.",
        "Treat this payload as the primary evidence source.",
        "Do not rediscover the whole repository from scratch.",
        "Use the trace, candidate evidence pack, dynamic specialist outputs, and pre-merged findings when available.",
        "Validate all findings by source-to-sink reasoning and merge by root cause.",
        "Return the output exactly in the structure required by your specialist instructions.",
        "If dynamic specialist output is empty or unavailable, still produce a conservative output from evidence.",
        "## Security Review Payload",
        &payload_json,
    ]
    .join("\n\n"))
}

async fn dispatch_security_specialists(
    state: &AppState,
    specialist_dir: Option<&str>,
    payload: &SecurityReviewPayload,
    verbose: bool,
) -> Result<
    (
        Vec<SecuritySpecialistDispatch>,
        Vec<SecuritySpecialistReport>,
    ),
    String,
> {
    let workloads = select_security_specialist_workloads(specialist_dir, payload, verbose)?;
    if workloads.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut plans = Vec::new();
    let mut reports = Vec::new();
    for workload in workloads {
        let specialist = load_specialist_by_id(&workload.specialist_id, specialist_dir)?;
        let provider = resolve_security_specialist_provider(&specialist);
        let task = SecurityDispatchInput {
            specialist_id: specialist.id.clone(),
            categories: workload.categories.clone(),
            evidence_pack: payload.evidence_pack.clone(),
            repo_path: payload.repo_path.clone(),
            base: payload.base.clone(),
            head: payload.head.clone(),
            diff: truncate(&payload.diff, 12_000),
            changed_files: payload.changed_files.clone(),
            tool_trace: payload.tool_trace.clone(),
            security_guidance: payload.security_guidance.clone(),
            candidates: workload.candidates.clone(),
        };
        let task_json = serde_json::to_string_pretty(&task).map_err(|err| {
            format!(
                "Failed to serialize dispatch task {}: {}",
                workload.specialist_id, err
            )
        })?;
        let prompt = [
            "You are a scoped security specialist.",
            "Use only the evidence and candidate payload below.",
            "Return strict JSON only.",
            "You must use this schema:",
            r#"{"specialist_id":"string","category":"optional canonical category","findings":[{"title":"string","severity":"CRITICAL|HIGH|MEDIUM|LOW","root_cause":"string","affected_locations":["string"],"attack_path":"string","why_it_matters":"string","guardrails_present":["string"],"recommended_fix":"string","related_variants":["string"],"confidence":"LOW|MEDIUM|HIGH"}],"notes":"optional text"}"#,
            &task_json,
        ]
        .join("\n\n");
        if verbose {
            println!(
                "── Dispatch Specialist: {} ({} candidates) ──",
                specialist.id,
                workload.candidates.len()
            );
        }

        let response = call_security_specialist_via_acp(
            state,
            &specialist,
            &prompt,
            false,
            &provider,
            &payload.repo_root,
        )
        .await?;
        plans.push(SecuritySpecialistDispatch {
            specialist_id: specialist.id.clone(),
            categories: workload.categories.clone(),
            candidate_count: workload.candidates.len(),
            reason: workload.reason.clone(),
        });

        let raw_output = response.trim().to_string();
        let parsed = parse_specialist_output(&raw_output);
        let status = if parsed.is_some() {
            "ok"
        } else {
            "unstructured"
        };
        let findings = parsed
            .as_ref()
            .map_or_else(Vec::new, |parsed| parsed.findings.clone());
        let trace = vec![if parsed.is_some() {
            "parsed JSON output".to_string()
        } else {
            "failed to parse JSON output, returning raw output preview".to_string()
        }
        .to_string()];
        let parse_error = if parsed.is_none() {
            Some("Could not parse specialist JSON; output may still be used by root aggregator as raw_text".to_string())
        } else {
            None
        };

        reports.push(SecuritySpecialistReport {
            specialist_id: specialist.id.clone(),
            status: status.to_string(),
            categories: workload.categories.clone(),
            findings,
            trace,
            parse_error,
            output_preview: truncate(&raw_output, SECURITY_DISPATCH_OUTPUT_PREVIEW_CHARS),
        });
    }

    Ok((plans, reports))
}

fn parse_specialist_output(raw_output: &str) -> Option<SecuritySpecialistOutput> {
    let trimmed = raw_output.trim();
    if let Ok(parsed) = serde_json::from_str::<SecuritySpecialistOutput>(trimmed) {
        return Some(parsed);
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    let candidate = &trimmed[start..=end];
    serde_json::from_str(candidate).ok()
}

fn merge_specialist_findings(
    pre_merged_findings: &[SecurityRootFinding],
    specialist_reports: &[SecuritySpecialistReport],
) -> Vec<SecurityRootFinding> {
    let mut merged: HashMap<String, SecurityRootFinding> = HashMap::new();

    for finding in pre_merged_findings {
        let key = finding.root_cause.to_lowercase();
        merged.insert(key, finding.clone());
    }

    for report in specialist_reports {
        for finding in &report.findings {
            let key = finding.root_cause.to_lowercase();
            match merged.get_mut(&key) {
                Some(existing) => {
                    existing.affected_locations = merge_unique_strings(
                        &existing.affected_locations,
                        &finding.affected_locations,
                    );
                    existing.attack_path = if finding.attack_path.len() > existing.attack_path.len()
                    {
                        finding.attack_path.clone()
                    } else {
                        existing.attack_path.clone()
                    };
                    existing.recommended_fix =
                        if finding.recommended_fix.len() > existing.recommended_fix.len() {
                            finding.recommended_fix.clone()
                        } else {
                            existing.recommended_fix.clone()
                        };
                    existing.related_variants =
                        merge_unique_strings(&existing.related_variants, &finding.related_variants);
                    existing.guardrails_present = merge_unique_strings(
                        &existing.guardrails_present,
                        &finding.guardrails_present,
                    );
                    existing.why_it_matters =
                        if finding.why_it_matters.len() > existing.why_it_matters.len() {
                            finding.why_it_matters.clone()
                        } else {
                            existing.why_it_matters.clone()
                        };
                    existing.confidence = higher_confidence(
                        existing.confidence.as_deref(),
                        finding.confidence.as_deref(),
                    );
                    existing.severity = max_severity(&existing.severity, &finding.severity);
                }
                None => {
                    merged.insert(key, finding.clone());
                }
            }
        }
    }

    merged.into_values().collect::<Vec<_>>()
}

fn merge_unique_strings(target: &[String], additions: &[String]) -> Vec<String> {
    let mut merged = target.to_vec();
    let mut existing = merged
        .iter()
        .map(|entry| entry.to_lowercase())
        .collect::<HashSet<_>>();
    for item in additions {
        let key = item.to_lowercase();
        if existing.insert(key) {
            merged.push(item.clone());
        }
    }
    merged
}

fn higher_confidence(current: Option<&str>, candidate: Option<&str>) -> Option<String> {
    let ranked = ["", "LOW", "MEDIUM", "HIGH", "VERY_HIGH", "CONFIRMED"];
    let score = |value: &str| {
        ranked
            .iter()
            .position(|candidate| value.eq_ignore_ascii_case(candidate))
            .unwrap_or(0)
    };
    match (current, candidate) {
        (None, Some(value)) => Some(value.to_string()),
        (Some(current), None) => Some(current.to_string()),
        (Some(current), Some(candidate)) => {
            if score(candidate) >= score(current) {
                Some(candidate.to_string())
            } else {
                Some(current.to_string())
            }
        }
        _ => None,
    }
}

fn max_severity(current: &str, candidate: &str) -> String {
    let weights = ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
    let rank = |value: &str| {
        let upper = value.to_uppercase();
        weights
            .iter()
            .position(|entry| entry == &upper)
            .unwrap_or(0)
    };
    if rank(candidate) >= rank(current) {
        candidate.to_string()
    } else {
        current.to_string()
    }
}

fn select_security_specialist_workloads(
    specialist_dir: Option<&str>,
    payload: &SecurityReviewPayload,
    verbose: bool,
) -> Result<Vec<SecurityCandidateWorkload>, String> {
    let specialist_candidates = load_security_candidates_for_dispatch(specialist_dir)?;
    let mut category_map: HashMap<String, SecurityCandidate> = HashMap::new();
    for candidate in payload
        .heuristic_candidates
        .iter()
        .chain(payload.semgrep_candidates.iter())
    {
        let key = format!(
            "{}|{}|{}",
            candidate.rule_id,
            candidate.category,
            candidate.locations.first().cloned().unwrap_or_default()
        );
        category_map.entry(key).or_insert_with(|| candidate.clone());
    }

    let mut candidates_by_category =
        group_candidates_by_category(category_map.into_values().collect());
    if candidates_by_category.is_empty() {
        return Ok(Vec::new());
    }

    candidates_by_category.sort_by_key(|bucket| std::cmp::Reverse(bucket.candidate_count));

    let mut workload_map: HashMap<String, SecurityCandidateWorkload> = HashMap::new();
    for bucket in candidates_by_category {
        if bucket.candidates.is_empty() {
            continue;
        }
        let selected_specialist =
            select_security_specialist_for_category(&specialist_candidates, &bucket.category);
        let Some((specialist_id, reason, max_candidates)) = selected_specialist else {
            if verbose {
                println!(
                    "── Dispatch mapping: no specialist for category `{}` ({} candidates)",
                    bucket.category, bucket.candidate_count
                );
            }
            continue;
        };

        let entry =
            workload_map
                .entry(specialist_id.clone())
                .or_insert(SecurityCandidateWorkload {
                    specialist_id: specialist_id.clone(),
                    categories: Vec::new(),
                    candidates: Vec::new(),
                    max_candidates,
                    reason: reason.clone(),
                });

        entry.categories.push(bucket.category);
        entry.categories.sort();
        entry.categories.dedup();
        entry.candidates.extend(bucket.candidates);
        if entry.max_candidates.is_none() {
            entry.max_candidates = max_candidates;
        } else if let (Some(current), Some(next)) = (entry.max_candidates, max_candidates) {
            entry.max_candidates = Some(current.max(next));
        }
    }

    let mut workloads: Vec<SecurityCandidateWorkload> = workload_map
        .into_values()
        .filter(|workload| !workload.candidates.is_empty())
        .collect();
    for workload in workloads.iter_mut() {
        if let Some(limit) = workload.max_candidates {
            if workload.candidates.len() > limit {
                workload.candidates.truncate(limit);
            }
        }
    }
    workloads.sort_by_key(|workload| std::cmp::Reverse(workload.candidates.len()));

    if workloads.len() > SECURITY_DISPATCH_MAX_SPECIALISTS {
        workloads.truncate(SECURITY_DISPATCH_MAX_SPECIALISTS);
    }

    workloads.sort_by(|left, right| left.specialist_id.cmp(&right.specialist_id));

    Ok(workloads)
}

fn select_security_specialist_for_category(
    specialists: &[SpecialistDef],
    category: &str,
) -> Option<(String, String, Option<usize>)> {
    let normalized_category = category.to_lowercase();
    let direct_id = format!("security-{}-reviewer", normalized_category);
    for specialist in specialists {
        if specialist.id == direct_id {
            return Some((
                specialist.id.clone(),
                "direct-id-match".to_string(),
                specialist
                    .capabilities
                    .as_ref()
                    .and_then(|capabilities| capabilities.max_candidates),
            ));
        }
        if let Some(capabilities) = &specialist.capabilities {
            if capabilities
                .categories
                .iter()
                .any(|capability| capability.eq_ignore_ascii_case(&normalized_category))
            {
                return Some((
                    specialist.id.clone(),
                    "capability-match".to_string(),
                    capabilities.max_candidates,
                ));
            }
        }
    }
    None
}

fn load_security_candidates_for_dispatch(
    specialist_dir: Option<&str>,
) -> Result<Vec<SpecialistDef>, String> {
    let mut loader = SpecialistLoader::new();
    if let Some(dir) = specialist_dir {
        loader.load_dir(dir)?;
    } else {
        loader.load_default_dirs();
    }
    let mut specialists = loader.specialists.values().cloned().collect::<Vec<_>>();
    for builtin in SpecialistLoader::builtin_specialists() {
        if !specialists.iter().any(|entry| entry.id == builtin.id) {
            specialists.push(builtin);
        }
    }
    Ok(specialists)
}

fn group_candidates_by_category(
    candidates: Vec<SecurityCandidate>,
) -> Vec<SecurityCandidateBucket> {
    let mut buckets: HashMap<String, Vec<SecurityCandidate>> = HashMap::new();

    for candidate in candidates {
        let category = candidate.category.to_lowercase();
        buckets.entry(category).or_default().push(candidate);
    }

    let mut grouped: Vec<SecurityCandidateBucket> = buckets
        .into_iter()
        .map(|(category, candidates)| SecurityCandidateBucket {
            category,
            candidate_count: candidates.len(),
            candidates,
        })
        .collect();

    grouped.sort_by_key(|bucket| std::cmp::Reverse(bucket.candidate_count));
    grouped
}

fn build_review_input_payload(
    repo_root: &Path,
    base: &str,
    head: &str,
    rules_file: Option<&str>,
) -> Result<ReviewInputPayload, String> {
    let diff_range = format!("{}..{}", base, head);
    let changed_files = git_lines(repo_root, &["diff", "--name-only", &diff_range])?;
    let diff_stat = git_output(repo_root, &["diff", "--stat", &diff_range])?;
    let diff = truncate(
        &git_output(repo_root, &["diff", "--unified=3", &diff_range])?,
        40_000,
    );
    let review_rules = load_review_rules(repo_root, rules_file)?;
    let config_snippets = load_config_snippets(repo_root);

    Ok(ReviewInputPayload {
        repo_path: repo_root.display().to_string(),
        repo_root: repo_root.display().to_string(),
        base: base.to_string(),
        head: head.to_string(),
        changed_files,
        diff_stat,
        diff,
        config_snippets,
        review_rules,
    })
}

fn build_security_review_payload(
    repo_root: &Path,
    base: &str,
    head: &str,
    rules_file: Option<&str>,
) -> Result<SecurityReviewPayload, String> {
    let review_payload = build_review_input_payload(repo_root, base, head, rules_file)?;
    let security_guidance = load_security_guidance(repo_root);

    let mut tool_trace = Vec::new();
    note_ast_grep_availability(&mut tool_trace);
    let heuristic_candidates =
        collect_security_candidates(repo_root, &review_payload.changed_files, &mut tool_trace);
    let semgrep_candidates =
        collect_semgrep_candidates(repo_root, &review_payload.changed_files, &mut tool_trace);
    let evidence_pack = build_security_evidence_pack(&heuristic_candidates, &semgrep_candidates);
    let pre_merged_findings =
        build_pre_merged_findings_from_evidence(&security_guidance, &evidence_pack);
    let fitness_review_context = collect_fitness_review_context(
        repo_root,
        &review_payload.changed_files,
        base,
        &mut tool_trace,
    );

    Ok(SecurityReviewPayload {
        repo_path: review_payload.repo_path.clone(),
        repo_root: review_payload.repo_root.clone(),
        base: review_payload.base,
        head: review_payload.head,
        changed_files: review_payload.changed_files,
        diff_stat: review_payload.diff_stat,
        diff: review_payload.diff,
        config_snippets: review_payload.config_snippets,
        review_rules: review_payload.review_rules,
        security_guidance,
        evidence_pack,
        specialist_dispatch_plan: Vec::new(),
        specialist_reports: Vec::new(),
        pre_merged_findings,
        tool_trace,
        heuristic_candidates,
        semgrep_candidates,
        fitness_review_context,
    })
}

fn build_security_evidence_pack(
    heuristic_candidates: &[SecurityCandidate],
    semgrep_candidates: &[SecurityCandidate],
) -> SecurityEvidencePack {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for candidate in heuristic_candidates.iter().chain(semgrep_candidates.iter()) {
        if candidate.category.trim().is_empty() {
            continue;
        }
        let fingerprint = format!(
            "{}|{}|{}",
            candidate.category,
            candidate.rule_id,
            candidate.locations.first().cloned().unwrap_or_default()
        );
        if seen.insert(fingerprint) {
            merged.push(candidate.clone());
        }
    }

    SecurityEvidencePack {
        total_candidates: merged.len(),
        buckets: group_candidates_by_category(merged),
    }
}

fn build_pre_merged_findings_from_evidence(
    security_guidance: &Option<String>,
    evidence_pack: &SecurityEvidencePack,
) -> Vec<SecurityRootFinding> {
    let mut findings = Vec::new();

    for bucket in &evidence_pack.buckets {
        for candidate in &bucket.candidates {
            findings.push(SecurityRootFinding {
                title: format!("{}: {}", bucket.category, candidate.rule_id),
                severity: candidate.severity.clone(),
                root_cause: if bucket.category.is_empty() {
                    candidate.summary.clone()
                } else {
                    format!("{} in changed code path", bucket.category)
                },
                affected_locations: candidate.locations.clone(),
                attack_path: candidate.summary.clone(),
                why_it_matters: candidate.summary.clone(),
                guardrails_present: Vec::new(),
                recommended_fix: "Validate with a scoped specialist before finalizing".to_string(),
                related_variants: Vec::new(),
                confidence: Some("LOW".to_string()),
            });
        }
    }

    if security_guidance.is_some() {
        findings.push(SecurityRootFinding {
            title: "Security guidance loaded".to_string(),
            severity: "LOW".to_string(),
            root_cause: "Security guidance was loaded and treated as a workflow hint".to_string(),
            affected_locations: Vec::new(),
            attack_path: "Security policy and guidance were included in payload".to_string(),
            why_it_matters: "Policy references can change review confidence and required depth"
                .to_string(),
            guardrails_present: Vec::new(),
            recommended_fix: "Keep guidance aligned with current security policy".to_string(),
            related_variants: Vec::new(),
            confidence: Some("LOW".to_string()),
        });
    }

    findings
}

fn note_ast_grep_availability(tool_trace: &mut Vec<ToolTrace>) {
    let ast_grep = find_command_in_path("ast-grep").or_else(|| find_command_in_path("sg"));
    match ast_grep {
        Some(path) => tool_trace.push(ToolTrace {
            tool: "ast-grep".to_string(),
            status: "available".to_string(),
            details: format!("available at {}", path.display()),
        }),
        None => tool_trace.push(ToolTrace {
            tool: "ast-grep".to_string(),
            status: "unavailable".to_string(),
            details: "ast-grep/sg not installed".to_string(),
        }),
    }
}

fn load_security_guidance(repo_root: &Path) -> Option<String> {
    let path = repo_root.join("docs").join("fitness").join("security.md");
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .map(|content| truncate(&content, 8_000))
}

fn collect_security_candidates(
    repo_root: &Path,
    changed_files: &[String],
    tool_trace: &mut Vec<ToolTrace>,
) -> Vec<SecurityCandidate> {
    let scoped_files: Vec<String> = changed_files
        .iter()
        .filter(|path| !is_security_review_tooling_file(path))
        .cloned()
        .collect();

    if scoped_files.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-scanner".to_string(),
            status: "skipped".to_string(),
            details: "Changed files only touch security review tooling".to_string(),
        });
        return Vec::new();
    }

    let mut candidates = Vec::new();

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "exec\\s*\\(|child_process\\.exec|execSync\\s*\\(",
        SecurityCandidate {
            rule_id: "command-execution".to_string(),
            category: "command-injection".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches shell execution or command-launch paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "dangerouslySetInnerHTML|marked\\.parse\\(",
        SecurityCandidate {
            rule_id: "html-rendering".to_string(),
            category: "xss".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches HTML rendering from potentially untrusted content."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "\\bfetch\\s*\\(",
        SecurityCandidate {
            rule_id: "outbound-fetch".to_string(),
            category: "ssrf".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches outbound request paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate_filtered(
        repo_root,
        &scoped_files,
        "baseUrl|ANTHROPIC_BASE_URL",
        SecurityCandidate {
            rule_id: "base-url-override".to_string(),
            category: "ssrf".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed backend or provider code touches base URL override paths."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        |entry| {
            let path = entry.split(':').next().unwrap_or_default();
            path.contains("/api/")
                || path.contains("/core/")
                || path.starts_with("crates/")
                || path.starts_with("docker/")
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "bypassPermissions|dangerously-skip-permissions|allow-all-tools|no-ask-user",
        SecurityCandidate {
            rule_id: "permission-bypass".to_string(),
            category: "authorization".to_string(),
            severity: "CRITICAL".to_string(),
            summary: "Changed code touches tool permission bypass or auto-approval flags."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "docker run|docker pull|0\\.0\\.0\\.0|/var/run/docker\\.sock|~/.ssh|--network host|--privileged",
        SecurityCandidate {
            rule_id: "docker-exposure".to_string(),
            category: "container-exposure".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches Docker execution, exposure, or host-mount paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    let auth_candidates = heuristic_auth_candidates(repo_root, &scoped_files);
    if auth_candidates.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-auth-check".to_string(),
            status: "ok".to_string(),
            details:
                "No unauthenticated high-privilege API route candidates found in changed files"
                    .to_string(),
        });
    } else {
        tool_trace.push(ToolTrace {
            tool: "heuristic-auth-check".to_string(),
            status: "warning".to_string(),
            details: format!(
                "Found {} API route candidate(s) missing obvious auth guards",
                auth_candidates.len()
            ),
        });
        candidates.extend(auth_candidates);
    }

    candidates
}

fn collect_semgrep_candidates(
    repo_root: &Path,
    changed_files: &[String],
    tool_trace: &mut Vec<ToolTrace>,
) -> Vec<SecurityCandidate> {
    let scoped_files: Vec<String> = changed_files
        .iter()
        .filter(|path| !is_security_review_tooling_file(path))
        .cloned()
        .collect();

    if scoped_files.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "skipped".to_string(),
            details: "Changed files only touch security review tooling".to_string(),
        });
        return Vec::new();
    }

    let Some(semgrep_command) = preferred_semgrep_command(repo_root) else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "unavailable".to_string(),
            details: "semgrep/pysemgrep not installed".to_string(),
        });
        return Vec::new();
    };

    let rules_path = repo_root.join(SECURITY_SEMGREP_RULES_PATH);
    if !rules_path.is_file() {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "unavailable".to_string(),
            details: format!("missing local Semgrep rules file: {}", rules_path.display()),
        });
        return Vec::new();
    }

    let semgrep_home = security_review_tool_home(repo_root);
    let semgrep_home_log = semgrep_home.join(".semgrep");
    if let Err(err) = std::fs::create_dir_all(&semgrep_home_log) {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details: format!("failed to prepare semgrep home directory: {}", err),
        });
        return Vec::new();
    }

    let mut args = vec![
        "scan".to_string(),
        "--metrics".to_string(),
        "off".to_string(),
        "--disable-version-check".to_string(),
        "--config".to_string(),
        rules_path.display().to_string(),
        "--json".to_string(),
        "--quiet".to_string(),
    ];
    args.extend(scoped_files.iter().cloned());

    let mut semgrep_cmd = Command::new(&semgrep_command);
    semgrep_cmd
        .args(&args)
        .env("HOME", &semgrep_home)
        .env("XDG_CONFIG_HOME", &semgrep_home)
        .env("SEMGREP_LOG_FILE", semgrep_home_log.join("semgrep.log"))
        .env("SEMGREP_SEND_METRICS", "off")
        .env("SEMGREP_ENABLE_VERSION_CHECK", "0")
        .current_dir(repo_root);
    if let Some(ssl_cert_file) = preferred_ssl_cert_file() {
        semgrep_cmd.env("SSL_CERT_FILE", ssl_cert_file);
    }
    let output = semgrep_cmd.output();

    let Ok(output) = output else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details: "failed to execute semgrep".to_string(),
        });
        return Vec::new();
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let exit_code = output
            .status
            .code()
            .map_or_else(|| "unknown".to_string(), |code| code.to_string());
        let details = match (stderr.is_empty(), stdout.is_empty()) {
            (false, false) => truncate(
                &format!(
                    "exit_code={} stderr:\n{}\n\nstdout:\n{}",
                    exit_code, stderr, stdout
                ),
                2_000,
            ),
            (false, true) => truncate(
                &format!("exit_code={} stderr: {}", exit_code, stderr),
                1_500,
            ),
            (true, false) => truncate(
                &format!("exit_code={} stdout: {}", exit_code, stdout),
                1_500,
            ),
            (true, true) => "semgrep failed without stderr/stdout output".to_string(),
        };
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details,
        });
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let Ok(value) = serde_json::from_str::<Value>(&stdout) else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details: "failed to parse semgrep JSON output".to_string(),
        });
        return Vec::new();
    };

    let Some(results) = value.get("results").and_then(|v| v.as_array()) else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "ok".to_string(),
            details: "semgrep returned no results".to_string(),
        });
        return Vec::new();
    };

    let mut candidates = Vec::new();
    for result in results {
        let path = result
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let line = result
            .get("start")
            .and_then(|v| v.get("line"))
            .and_then(|v| v.as_i64())
            .unwrap_or_default();
        let check_id = result
            .get("check_id")
            .and_then(|v| v.as_str())
            .unwrap_or("semgrep.unknown")
            .to_string();
        let severity = result
            .get("extra")
            .and_then(|v| v.get("severity"))
            .and_then(|v| v.as_str())
            .unwrap_or("WARNING")
            .to_string();
        let message = result
            .get("extra")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Semgrep finding")
            .to_string();
        let lines = result
            .get("extra")
            .and_then(|v| v.get("lines"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let category = infer_semgrep_category(&check_id, &message);

        candidates.push(SecurityCandidate {
            rule_id: check_id,
            category,
            severity,
            summary: message,
            locations: vec![if line > 0 {
                format!("{}:{}", path, line)
            } else {
                path
            }],
            evidence: if lines.is_empty() {
                Vec::new()
            } else {
                vec![truncate(&lines, 500)]
            },
        });
    }

    tool_trace.push(ToolTrace {
        tool: "semgrep".to_string(),
        status: "ok".to_string(),
        details: format!(
            "Collected {} semgrep candidate(s) via {}",
            candidates.len(),
            semgrep_command.display()
        ),
    });

    candidates
}

fn find_command_in_path(command: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(command);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn preferred_semgrep_command(repo_root: &Path) -> Option<PathBuf> {
    preferred_tool_command(repo_root, &["pysemgrep", "semgrep"])
}

fn preferred_ssl_cert_file() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SSL_CERT_FILE") {
        return Some(PathBuf::from(path));
    }

    let fallback_paths = [
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
    ];

    fallback_paths
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn preferred_routa_fitness_command(repo_root: &Path) -> Option<PathBuf> {
    preferred_tool_command(repo_root, &["routa-fitness"])
}

fn preferred_tool_command(repo_root: &Path, commands: &[&str]) -> Option<PathBuf> {
    for command in commands {
        let local_candidate = repo_root
            .join(SECURITY_REVIEW_VENV_DIR)
            .join("bin")
            .join(command);
        if local_candidate.is_file() {
            return Some(local_candidate);
        }
    }

    commands
        .iter()
        .find_map(|command| find_command_in_path(command))
}

fn security_review_tool_home(repo_root: &Path) -> PathBuf {
    repo_root.join(SECURITY_REVIEW_HOME_DIR)
}

fn infer_semgrep_category(check_id: &str, message: &str) -> String {
    let combined = format!("{} {}", check_id.to_lowercase(), message.to_lowercase());
    if combined.contains("xss") || combined.contains("innerhtml") {
        "xss".to_string()
    } else if combined.contains("ssrf") || combined.contains("fetch") || combined.contains("url") {
        "ssrf".to_string()
    } else if combined.contains("exec")
        || combined.contains("shell")
        || combined.contains("command")
        || combined.contains("child-process")
    {
        "command-injection".to_string()
    } else if combined.contains("auth") || combined.contains("permission") {
        "authentication".to_string()
    } else if combined.contains("docker") || combined.contains("container") {
        "container-exposure".to_string()
    } else {
        "security".to_string()
    }
}

fn maybe_push_candidate(
    repo_root: &Path,
    changed_files: &[String],
    pattern: &str,
    mut candidate: SecurityCandidate,
    tool_trace: &mut Vec<ToolTrace>,
    candidates: &mut Vec<SecurityCandidate>,
) {
    match rg_search(repo_root, pattern, changed_files) {
        Ok(matches) if matches.is_empty() => {
            tool_trace.push(ToolTrace {
                tool: "rg".to_string(),
                status: "ok".to_string(),
                details: format!("No matches for pattern `{}`", pattern),
            });
        }
        Ok(matches) => {
            candidate.locations = matches
                .iter()
                .map(|entry| compact_location(entry))
                .collect();
            candidate.evidence = matches
                .into_iter()
                .take(8)
                .map(|entry| truncate(&entry, 300))
                .collect();
            tool_trace.push(ToolTrace {
                tool: "rg".to_string(),
                status: "warning".to_string(),
                details: format!(
                    "Pattern `{}` matched {} location(s)",
                    pattern,
                    candidate.locations.len()
                ),
            });
            candidates.push(candidate);
        }
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "rg".to_string(),
                status: "error".to_string(),
                details: err,
            });
        }
    }
}

fn maybe_push_candidate_filtered<F>(
    repo_root: &Path,
    changed_files: &[String],
    pattern: &str,
    mut candidate: SecurityCandidate,
    filter: F,
    tool_trace: &mut Vec<ToolTrace>,
    candidates: &mut Vec<SecurityCandidate>,
) where
    F: Fn(&str) -> bool,
{
    match rg_search(repo_root, pattern, changed_files) {
        Ok(matches) => {
            let filtered_matches: Vec<String> =
                matches.into_iter().filter(|entry| filter(entry)).collect();
            if filtered_matches.is_empty() {
                tool_trace.push(ToolTrace {
                    tool: "rg".to_string(),
                    status: "ok".to_string(),
                    details: format!("No filtered matches for pattern `{}`", pattern),
                });
                return;
            }

            candidate.locations = filtered_matches
                .iter()
                .map(|entry| compact_location(entry))
                .collect();
            candidate.evidence = filtered_matches
                .into_iter()
                .take(8)
                .map(|entry| truncate(&entry, 300))
                .collect();
            tool_trace.push(ToolTrace {
                tool: "rg".to_string(),
                status: "warning".to_string(),
                details: format!(
                    "Pattern `{}` matched {} filtered location(s)",
                    pattern,
                    candidate.locations.len()
                ),
            });
            candidates.push(candidate);
        }
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "rg".to_string(),
                status: "error".to_string(),
                details: err,
            });
        }
    }
}

fn rg_search(
    repo_root: &Path,
    pattern: &str,
    changed_files: &[String],
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "-n".to_string(),
        "-H".to_string(),
        "-S".to_string(),
        "-e".to_string(),
        pattern.to_string(),
    ];
    args.extend(changed_files.iter().cloned());

    let output = Command::new("rg")
        .args(&args)
        .current_dir(repo_root)
        .output()
        .map_err(|err| format!("Failed to run rg for pattern `{}`: {}", pattern, err))?;

    match output.status.code() {
        Some(0) => Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_string)
            .collect()),
        Some(1) => Ok(Vec::new()),
        _ => Err(format!(
            "rg failed for pattern `{}`: {}",
            pattern,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
    }
}

fn heuristic_auth_candidates(repo_root: &Path, changed_files: &[String]) -> Vec<SecurityCandidate> {
    let mut candidates = Vec::new();

    for relative_path in changed_files {
        if !relative_path.contains("/api/") {
            continue;
        }

        let file_path = repo_root.join(relative_path);
        let Ok(content) = std::fs::read_to_string(&file_path) else {
            continue;
        };
        if !content.contains("export async function") {
            continue;
        }

        let lower = content.to_lowercase();
        let has_auth_signal = [
            "verifyauth",
            "requireauth",
            "ensureauthorized",
            "unauthorized",
            "bearer ",
            "getserversession",
            "session.user",
            "auth(",
        ]
        .iter()
        .any(|needle| lower.contains(needle));

        if has_auth_signal {
            continue;
        }

        candidates.push(SecurityCandidate {
            rule_id: "unauthenticated-api-route".to_string(),
            category: "authentication".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed API route exports handlers without obvious authentication checks."
                .to_string(),
            locations: vec![relative_path.clone()],
            evidence: vec![truncate(&content, 600)],
        });
    }

    candidates
}

fn compact_location(entry: &str) -> String {
    let mut parts = entry.splitn(3, ':');
    let path = parts.next().unwrap_or_default();
    let line = parts.next().unwrap_or_default();
    if path.is_empty() || line.is_empty() {
        entry.to_string()
    } else {
        format!("{}:{}", path, line)
    }
}

fn collect_fitness_review_context(
    repo_root: &Path,
    changed_files: &[String],
    base: &str,
    tool_trace: &mut Vec<ToolTrace>,
) -> Option<Value> {
    let scoped_files: Vec<String> = changed_files
        .iter()
        .filter(|path| !is_security_review_tooling_file(path))
        .cloned()
        .collect();

    if scoped_files.is_empty() {
        return None;
    }

    let Some(routa_fitness_command) = preferred_routa_fitness_command(repo_root) else {
        tool_trace.push(ToolTrace {
            tool: "routa-fitness graph review-context".to_string(),
            status: "unavailable".to_string(),
            details: "routa-fitness is not installed or not available in PATH".to_string(),
        });
        return None;
    };

    let output = Command::new(&routa_fitness_command)
        .arg("graph")
        .arg("review-context")
        .args(&scoped_files)
        .arg("--base")
        .arg(base)
        .arg("--json")
        .current_dir(repo_root)
        .output();

    let Ok(output) = output else {
        tool_trace.push(ToolTrace {
            tool: "routa-fitness graph review-context".to_string(),
            status: "unavailable".to_string(),
            details: "routa-fitness is not installed or not available in PATH".to_string(),
        });
        return None;
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        tool_trace.push(ToolTrace {
            tool: "routa-fitness graph review-context".to_string(),
            status: "error".to_string(),
            details: if !stderr.is_empty() {
                truncate(&stderr, 1_500)
            } else if !stdout.is_empty() {
                truncate(&stdout, 1_500)
            } else {
                "command failed without stderr/stdout output".to_string()
            },
        });
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    match serde_json::from_str::<Value>(&stdout) {
        Ok(value) => {
            tool_trace.push(ToolTrace {
                tool: "routa-fitness graph review-context".to_string(),
                status: "ok".to_string(),
                details: format!(
                    "Loaded graph-based review context via {}",
                    routa_fitness_command.display()
                ),
            });
            Some(value)
        }
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "routa-fitness graph review-context".to_string(),
                status: "error".to_string(),
                details: format!("Failed to parse JSON output: {}", err),
            });
            None
        }
    }
}

fn is_security_review_tooling_file(path: &str) -> bool {
    matches!(
        path,
        "crates/routa-cli/src/commands/review.rs"
            | "crates/routa-cli/src/main.rs"
            | "resources/specialists/review/security-reviewer.yaml"
    ) || path.starts_with("resources/specialists/review/")
}

fn resolve_repo_root(repo_path: Option<&str>) -> Result<PathBuf, String> {
    let root = if let Some(path) = repo_path {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .map_err(|err| format!("Failed to read current directory: {}", err))?
    };

    let resolved = git_output(&root, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(resolved.trim()))
}

fn load_config_snippets(repo_root: &Path) -> Vec<ConfigSnippet> {
    CONFIG_CANDIDATES
        .iter()
        .filter_map(|relative_path| {
            let file_path = repo_root.join(relative_path);
            if !file_path.exists() {
                return None;
            }

            let content = std::fs::read_to_string(&file_path).ok()?;
            Some(ConfigSnippet {
                path: relative_path.to_string(),
                content: truncate(&content, 4_000),
            })
        })
        .collect()
}

fn load_review_rules(repo_root: &Path, rules_file: Option<&str>) -> Result<Option<String>, String> {
    let path = if let Some(file) = rules_file {
        PathBuf::from(file)
    } else {
        repo_root.join(".routa").join("review-rules.md")
    };

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read review rules '{}': {}", path.display(), err))?;
    Ok(Some(truncate(&content, 8_000)))
}

fn git_output(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|err| format!("Failed to run git {}: {}", args.join(" "), err))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn git_lines(repo_root: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    Ok(git_output(repo_root, args)?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn truncate(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        content.to_string()
    } else {
        let truncated: String = content.chars().take(max_chars).collect();
        format!("{}\n\n[truncated]", truncated)
    }
}

fn load_dotenv() {
    for filename in &[".env.local", ".env"] {
        let path = std::path::Path::new(filename);
        if !path.exists() {
            continue;
        }

        if let Ok(content) = std::fs::read_to_string(path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }

                if let Some(eq_idx) = line.find('=') {
                    let key = line[..eq_idx].trim();
                    let mut value = line[eq_idx + 1..].trim().to_string();
                    if (value.starts_with('"') && value.ends_with('"'))
                        || (value.starts_with('\'') && value.ends_with('\''))
                    {
                        value = value[1..value.len() - 1].to_string();
                    }

                    if std::env::var(key).is_err() {
                        std::env::set_var(key, &value);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_marks_truncated_content() {
        let content = "abcdefghijklmnopqrstuvwxyz";
        let truncated = truncate(content, 8);
        assert!(truncated.contains("[truncated]"));
        assert!(truncated.starts_with("abcdefgh"));
    }

    #[test]
    fn load_config_snippets_ignores_missing_files() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        std::fs::write(temp_dir.join("AGENTS.md"), "test").expect("fixture should be written");

        let snippets = load_config_snippets(&temp_dir);
        assert_eq!(snippets.len(), 1);
        assert_eq!(snippets[0].path, "AGENTS.md");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn heuristic_auth_candidates_flags_route_without_auth() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-auth-{}", uuid::Uuid::new_v4()));
        let api_dir = temp_dir.join("src/app/api/demo");
        std::fs::create_dir_all(&api_dir).expect("api dir should be created");
        std::fs::write(
            api_dir.join("route.ts"),
            "export async function POST(req: Request) { return Response.json({ ok: true }); }",
        )
        .expect("fixture should be written");

        let candidates =
            heuristic_auth_candidates(&temp_dir, &[String::from("src/app/api/demo/route.ts")]);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].rule_id, "unauthenticated-api-route");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn heuristic_auth_candidates_ignores_route_with_auth_signal() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-auth-ok-{}", uuid::Uuid::new_v4()));
        let api_dir = temp_dir.join("src/app/api/demo");
        std::fs::create_dir_all(&api_dir).expect("api dir should be created");
        std::fs::write(
            api_dir.join("route.ts"),
            "export async function POST(req: Request) { if (!verifyAuth(req)) return new Response('Unauthorized', { status: 401 }); return Response.json({ ok: true }); }",
        )
        .expect("fixture should be written");

        let candidates =
            heuristic_auth_candidates(&temp_dir, &[String::from("src/app/api/demo/route.ts")]);
        assert!(candidates.is_empty());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn preferred_tool_command_uses_local_security_review_venv_first() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-tool-{}", uuid::Uuid::new_v4()));
        let bin_dir = temp_dir.join(SECURITY_REVIEW_VENV_DIR).join("bin");
        std::fs::create_dir_all(&bin_dir).expect("bin dir should be created");
        let expected = bin_dir.join("pysemgrep");
        std::fs::write(&expected, "#!/bin/sh\n").expect("fixture should be written");

        let actual = preferred_tool_command(&temp_dir, &["pysemgrep", "semgrep"])
            .expect("local tool should be discovered");
        assert_eq!(actual, expected);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn load_security_specialists_supports_capability_filtering() {
        let mut specialist_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
        while !specialist_dir.join("resources").is_dir() {
            assert!(specialist_dir.pop(), "workspace root should exist");
        }
        let specialist_dir = specialist_dir.join("resources/specialists");
        let specialists = load_security_candidates_for_dispatch(Some(
            specialist_dir
                .to_str()
                .expect("specialist dir path should be valid utf8"),
        ))
        .expect("load specialists");
        let mut has_auth = false;
        let mut has_command = false;
        for specialist in specialists {
            if specialist.id == "security-authentication-reviewer" {
                has_auth = true;
                let categories = specialist
                    .capabilities
                    .as_ref()
                    .expect("authentication specialist should declare capabilities")
                    .categories
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                assert!(categories.contains(&"authentication"));
            }
            if specialist.id == "security-command-injection-reviewer" {
                has_command = true;
                let categories = specialist
                    .capabilities
                    .as_ref()
                    .expect("command specialist should declare capabilities")
                    .categories
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                assert!(categories.contains(&"command-injection"));
            }
        }
        assert!(has_auth);
        assert!(has_command);
    }

    #[test]
    fn select_security_specialist_workloads_matches_categories() {
        let payload = SecurityReviewPayload {
            repo_path: "/tmp".to_string(),
            repo_root: "/tmp".to_string(),
            base: "HEAD~1".to_string(),
            head: "HEAD".to_string(),
            changed_files: vec!["src/app/api/demo/route.ts".to_string()],
            diff_stat: String::new(),
            diff: String::new(),
            config_snippets: Vec::new(),
            review_rules: None,
            security_guidance: None,
            evidence_pack: SecurityEvidencePack {
                total_candidates: 2,
                buckets: vec![],
            },
            specialist_dispatch_plan: Vec::new(),
            specialist_reports: Vec::new(),
            pre_merged_findings: Vec::new(),
            tool_trace: Vec::new(),
            heuristic_candidates: vec![
                SecurityCandidate {
                    rule_id: "auth".to_string(),
                    category: "authentication".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "auth".to_string(),
                    locations: vec!["route.ts:1".to_string()],
                    evidence: Vec::new(),
                },
                SecurityCandidate {
                    rule_id: "exec".to_string(),
                    category: "command-injection".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "cmd".to_string(),
                    locations: vec!["route.ts:2".to_string()],
                    evidence: Vec::new(),
                },
                SecurityCandidate {
                    rule_id: "ignore".to_string(),
                    category: "other".to_string(),
                    severity: "LOW".to_string(),
                    summary: "noop".to_string(),
                    locations: vec!["route.ts:3".to_string()],
                    evidence: Vec::new(),
                },
            ],
            semgrep_candidates: vec![],
            fitness_review_context: None,
        };

        let mut specialist_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
        while !specialist_dir.join("resources").is_dir() {
            assert!(specialist_dir.pop(), "workspace root should exist");
        }
        let specialist_dir = specialist_dir.join("resources/specialists");
        let workloads = select_security_specialist_workloads(
            Some(
                specialist_dir
                    .to_str()
                    .expect("specialist dir path should be valid utf8"),
            ),
            &payload,
            false,
        )
        .expect("load workloads");

        assert!(!workloads.is_empty());
        assert_eq!(workloads.len(), 2);

        let mut assigned = workloads
            .iter()
            .map(|workload| workload.specialist_id.as_str())
            .collect::<Vec<_>>();
        assigned.sort();
        assert!(assigned.contains(&"security-authentication-reviewer"));
        assert!(assigned.contains(&"security-command-injection-reviewer"));
    }

    #[test]
    fn build_pre_merged_findings_from_evidence_adds_hints() {
        let pack = SecurityEvidencePack {
            total_candidates: 1,
            buckets: vec![SecurityCandidateBucket {
                category: "command-injection".to_string(),
                candidate_count: 1,
                candidates: vec![SecurityCandidate {
                    rule_id: "command-execution".to_string(),
                    category: "command-injection".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "exec path".to_string(),
                    locations: vec!["src/app.rs:10".to_string()],
                    evidence: vec!["exec('id')".to_string()],
                }],
            }],
        };

        let findings = build_pre_merged_findings_from_evidence(&Some("policy".to_string()), &pack);

        assert!(!findings.is_empty());
        let base_finding = findings
            .iter()
            .find(|finding| finding.title == "command-injection: command-execution")
            .expect("command injection hint should be present");
        assert_eq!(base_finding.affected_locations, vec!["src/app.rs:10"]);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn merge_specialist_findings_prefers_stronger_signals() {
        let pre_merged = vec![SecurityRootFinding {
            title: "Base finding".to_string(),
            severity: "MEDIUM".to_string(),
            root_cause: "privileged command path".to_string(),
            affected_locations: vec!["src/app.rs:1".to_string()],
            attack_path: "path-a".to_string(),
            why_it_matters: "impact".to_string(),
            guardrails_present: vec!["check".to_string()],
            recommended_fix: "baseline".to_string(),
            related_variants: vec!["a".to_string()],
            confidence: Some("LOW".to_string()),
        }];

        let reports = vec![SecuritySpecialistReport {
            specialist_id: "security-command-injection-reviewer".to_string(),
            status: "ok".to_string(),
            categories: vec!["command-injection".to_string()],
            findings: vec![SecurityRootFinding {
                title: "Specialist finding".to_string(),
                severity: "CRITICAL".to_string(),
                root_cause: "privileged command path".to_string(),
                affected_locations: vec!["src/app.rs:2".to_string()],
                attack_path: "path-a + tainted input".to_string(),
                why_it_matters: "critical".to_string(),
                guardrails_present: vec!["no guard".to_string()],
                recommended_fix: "sanitize input".to_string(),
                related_variants: vec!["variant-1".to_string()],
                confidence: Some("HIGH".to_string()),
            }],
            trace: vec!["ok".to_string()],
            parse_error: None,
            output_preview: String::new(),
        }];

        let merged = merge_specialist_findings(&pre_merged, &reports);
        assert_eq!(merged.len(), 1);
        let final_finding = &merged[0];
        assert_eq!(final_finding.severity, "CRITICAL");
        assert_eq!(final_finding.confidence, Some("HIGH".to_string()));
        assert!(final_finding
            .affected_locations
            .contains(&"src/app.rs:1".to_string()));
        assert!(final_finding
            .affected_locations
            .contains(&"src/app.rs:2".to_string()));
        assert!(final_finding
            .related_variants
            .contains(&"variant-1".to_string()));
    }
}
