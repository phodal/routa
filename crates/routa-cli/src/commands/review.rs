//! `routa review` — read-only Specialist-backed code review analysis.

use std::path::{Path, PathBuf};
use std::process::Command;

use routa_core::state::AppState;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};
use serde::Serialize;

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
    let mut loader = SpecialistLoader::new();
    if let Some(dir) = specialist_dir {
        loader.load_dir(dir)?;
    } else {
        loader.load_default_dirs();
    }

    loader
        .get("pr-reviewer")
        .cloned()
        .or_else(|| {
            SpecialistLoader::builtin_specialists()
                .into_iter()
                .find(|specialist| specialist.id == "pr-reviewer")
        })
        .ok_or_else(|| "Missing specialist definition: pr-reviewer".to_string())
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
}
