//! `routa review` — read-only Specialist-backed code review analysis.

use std::path::{Path, PathBuf};
use std::process::Command;

use routa_core::state::AppState;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};
use serde::Serialize;
use serde_json::Value;

const CONFIG_CANDIDATES: &[&str] = &[
    "AGENTS.md",
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    "next.config.ts",
    "Cargo.toml",
    ".routa/review-rules.md",
];

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
    tool_trace: Vec<ToolTrace>,
    heuristic_candidates: Vec<SecurityCandidate>,
    fitness_review_context: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ToolTrace {
    tool: String,
    status: String,
    details: String,
}

#[derive(Debug, Serialize)]
struct SecurityCandidate {
    rule_id: String,
    category: String,
    severity: String,
    summary: String,
    locations: Vec<String>,
    evidence: Vec<String>,
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

pub async fn security(_state: &AppState, options: ReviewAnalyzeOptions<'_>) -> Result<(), String> {
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

    let specialist = load_specialist_by_id("security-reviewer", options.specialist_dir)?;
    let caller = AcpAgentCaller::new();
    let config = build_agent_call_config(&specialist)?;
    let prompt = build_security_specialist_prompt(&payload)?;

    if options.verbose {
        println!(
            "── Security Review Specialist: {} (model: {}) ──",
            specialist.id, config.model
        );
    }

    let response = caller.call(&config, &prompt).await?;
    if !response.success {
        return Err(response
            .error
            .unwrap_or_else(|| "Security review specialist failed".to_string()));
    }

    let final_output = response.content.trim().to_string();
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
    let api_key = std::env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
        .map_err(|_| {
            "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.".to_string()
        })?;

    Ok(AgentCallConfig {
        adapter: specialist
            .default_adapter
            .clone()
            .unwrap_or_else(|| "claude-code-sdk".to_string()),
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

fn build_security_specialist_prompt(payload: &SecurityReviewPayload) -> Result<String, String> {
    let payload_json = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Failed to serialize security review payload: {}", err))?;

    Ok([
        "You are running a tool-driven security review.",
        "Treat the payload below as the primary evidence source.",
        "Do not rediscover the whole repository from scratch.",
        "Use the tool trace, heuristic candidates, diff, and fitness context to cluster root causes and produce the final security review.",
        "Return the output exactly in the structure required by your specialist instructions.",
        "## Security Review Payload",
        &payload_json,
    ]
    .join("\n\n"))
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
    let heuristic_candidates = collect_security_candidates(
        repo_root,
        &review_payload.changed_files,
        &mut tool_trace,
    );
    let fitness_review_context =
        collect_fitness_review_context(repo_root, &review_payload.changed_files, base, &mut tool_trace);

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
        tool_trace,
        heuristic_candidates,
        fitness_review_context,
    })
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
    if changed_files.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-scanner".to_string(),
            status: "skipped".to_string(),
            details: "No changed files in diff range".to_string(),
        });
        return Vec::new();
    }

    let mut candidates = Vec::new();

    maybe_push_candidate(
        repo_root,
        changed_files,
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
        changed_files,
        "dangerouslySetInnerHTML|marked\\.parse\\(",
        SecurityCandidate {
            rule_id: "html-rendering".to_string(),
            category: "xss".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches HTML rendering from potentially untrusted content.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        changed_files,
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
        changed_files,
        "baseUrl|ANTHROPIC_BASE_URL",
        SecurityCandidate {
            rule_id: "base-url-override".to_string(),
            category: "ssrf".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed backend or provider code touches base URL override paths.".to_string(),
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
        changed_files,
        "bypassPermissions|dangerously-skip-permissions|allow-all-tools|no-ask-user",
        SecurityCandidate {
            rule_id: "permission-bypass".to_string(),
            category: "authorization".to_string(),
            severity: "CRITICAL".to_string(),
            summary: "Changed code touches tool permission bypass or auto-approval flags.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        changed_files,
        "docker run|docker pull|0\\.0\\.0\\.0|-p\\s+\\d|/var/run/docker\\.sock|~/.ssh",
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

    let auth_candidates = heuristic_auth_candidates(repo_root, changed_files);
    if auth_candidates.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-auth-check".to_string(),
            status: "ok".to_string(),
            details: "No unauthenticated high-privilege API route candidates found in changed files".to_string(),
        });
    } else {
        tool_trace.push(ToolTrace {
            tool: "heuristic-auth-check".to_string(),
            status: "warning".to_string(),
            details: format!("Found {} API route candidate(s) missing obvious auth guards", auth_candidates.len()),
        });
        candidates.extend(auth_candidates);
    }

    candidates
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
            candidate.locations = matches.iter().map(|entry| compact_location(entry)).collect();
            candidate.evidence = matches.into_iter().take(8).map(|entry| truncate(&entry, 300)).collect();
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
            let filtered_matches: Vec<String> = matches.into_iter().filter(|entry| filter(entry)).collect();
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

fn rg_search(repo_root: &Path, pattern: &str, changed_files: &[String]) -> Result<Vec<String>, String> {
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
            summary: "Changed API route exports handlers without obvious authentication checks.".to_string(),
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
    if changed_files.is_empty() {
        return None;
    }

    let output = Command::new("routa-fitness")
        .arg("graph")
        .arg("review-context")
        .args(changed_files)
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
                details: "Loaded graph-based review context".to_string(),
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
}
