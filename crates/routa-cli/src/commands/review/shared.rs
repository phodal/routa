use std::path::{Path, PathBuf};
use std::process::Command;

use routa_core::git::{compute_historical_related_files, HistoricalRelatedFile};
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const CONFIG_CANDIDATES: &[&str] = &[
    "AGENTS.md",
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    "next.config.ts",
    "Cargo.toml",
    ".routa/review-rules.md",
];
pub(crate) const SECURITY_REVIEW_VENV_DIR: &str = ".venv-security-review";
pub(crate) const SECURITY_REVIEW_HOME_DIR: &str = ".tmp-home";
pub(crate) const SECURITY_SEMGREP_RULES_PATH: &str = "resources/review/semgrep-security-v1.yaml";
pub(crate) const SECURITY_DISPATCH_MAX_SPECIALISTS: usize = 3;
pub(crate) const SECURITY_DISPATCH_OUTPUT_PREVIEW_CHARS: usize = 6_000;

pub struct ReviewAnalyzeOptions<'a> {
    pub base: &'a str,
    pub head: &'a str,
    pub repo_path: Option<&'a str>,
    pub rules_file: Option<&'a str>,
    pub model: Option<&'a str>,
    pub validator_model: Option<&'a str>,
    pub verbose: bool,
    pub as_json: bool,
    pub payload_only: bool,
    pub specialist_dir: Option<&'a str>,
}

#[derive(Clone, Copy)]
pub(crate) enum ReviewWorkerType {
    Context,
    Candidates,
    Validator,
}

impl ReviewWorkerType {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::Candidates => "candidates",
            Self::Validator => "validator",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewInputPayload {
    pub repo_path: String,
    pub repo_root: String,
    pub base: String,
    pub head: String,
    pub changed_files: Vec<String>,
    pub diff_stat: String,
    pub diff: String,
    pub config_snippets: Vec<ConfigSnippet>,
    pub review_rules: Option<String>,
    pub graph_review_context: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub historical_related_files: Option<Vec<HistoricalRelatedFile>>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ConfigSnippet {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SecurityEvidencePack {
    pub total_candidates: usize,
    pub buckets: Vec<SecurityCandidateBucket>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SecurityReviewPayload {
    pub repo_path: String,
    pub repo_root: String,
    pub base: String,
    pub head: String,
    pub changed_files: Vec<String>,
    pub diff_stat: String,
    pub diff: String,
    pub config_snippets: Vec<ConfigSnippet>,
    pub review_rules: Option<String>,
    pub security_guidance: Option<String>,
    pub evidence_pack: SecurityEvidencePack,
    pub specialist_dispatch_plan: Vec<SecuritySpecialistDispatch>,
    pub specialist_reports: Vec<SecuritySpecialistReport>,
    pub pre_merged_findings: Vec<SecurityRootFinding>,
    pub tool_trace: Vec<ToolTrace>,
    pub heuristic_candidates: Vec<SecurityCandidate>,
    pub semgrep_candidates: Vec<SecurityCandidate>,
    pub fitness_review_context: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SecurityCandidateBucket {
    pub category: String,
    pub candidate_count: usize,
    pub candidates: Vec<SecurityCandidate>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ToolTrace {
    pub tool: String,
    pub status: String,
    pub details: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SecurityCandidate {
    pub rule_id: String,
    pub category: String,
    pub severity: String,
    pub summary: String,
    pub locations: Vec<String>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SecurityRootFinding {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub root_cause: String,
    #[serde(default)]
    pub affected_locations: Vec<String>,
    #[serde(default)]
    pub attack_path: String,
    #[serde(default)]
    pub why_it_matters: String,
    #[serde(default)]
    pub guardrails_present: Vec<String>,
    #[serde(default)]
    pub recommended_fix: String,
    #[serde(default)]
    pub related_variants: Vec<String>,
    #[serde(default)]
    pub confidence: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SecuritySpecialistDispatch {
    pub specialist_id: String,
    pub categories: Vec<String>,
    pub candidate_count: usize,
    pub reason: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SecuritySpecialistReport {
    pub specialist_id: String,
    pub status: String,
    pub categories: Vec<String>,
    pub findings: Vec<SecurityRootFinding>,
    pub trace: Vec<String>,
    pub parse_error: Option<String>,
    pub output_preview: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SecurityDispatchInput {
    pub specialist_id: String,
    pub categories: Vec<String>,
    pub evidence_pack: SecurityEvidencePack,
    pub repo_path: String,
    pub base: String,
    pub head: String,
    pub diff: String,
    pub changed_files: Vec<String>,
    pub tool_trace: Vec<ToolTrace>,
    pub security_guidance: Option<String>,
    pub candidates: Vec<SecurityCandidate>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SecuritySpecialistOutput {
    #[serde(default)]
    pub specialist_id: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub findings: Vec<SecurityRootFinding>,
    #[serde(default)]
    pub notes: Option<String>,
}

pub(crate) struct SecurityCandidateWorkload {
    pub specialist_id: String,
    pub categories: Vec<String>,
    pub candidates: Vec<SecurityCandidate>,
    pub max_candidates: Option<usize>,
    pub reason: String,
}

pub(crate) fn provider_runtime_binary(provider: &str) -> String {
    let normalized = provider.to_lowercase();
    match normalized.as_str() {
        "codex" => "codex-acp".to_string(),
        _ => normalized,
    }
}

pub(crate) fn find_command_in_path(command: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(command);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            for ext in ["exe", "cmd", "bat"] {
                let windows_candidate = dir.join(format!("{}.{}", command, ext));
                if windows_candidate.is_file() {
                    return Some(windows_candidate);
                }
            }
        }
        None
    })
}

pub(crate) fn resolve_repo_root(repo_path: Option<&str>) -> Result<PathBuf, String> {
    let root = if let Some(path) = repo_path {
        PathBuf::from(path)
    } else {
        std::env::current_dir().map_err(|err| format!("Failed to read current directory: {err}"))?
    };

    let resolved = git_output(&root, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(resolved.trim()))
}

pub(crate) fn load_config_snippets(repo_root: &Path) -> Vec<ConfigSnippet> {
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
                content: truncate_like_review(&content, 4_000),
            })
        })
        .collect()
}

pub(crate) fn load_review_rules(
    repo_root: &Path,
    rules_file: Option<&str>,
) -> Result<Option<String>, String> {
    let path = match rules_file {
        Some(file) => PathBuf::from(file),
        None => repo_root.join(".routa").join("review-rules.md"),
    };

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read review rules '{}': {}", path.display(), err))?;
    Ok(Some(truncate_like_review(&content, 8_000)))
}

pub(crate) fn git_output(repo_root: &Path, args: &[&str]) -> Result<String, String> {
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

pub(crate) fn git_lines(repo_root: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    Ok(git_output(repo_root, args)?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

pub(crate) fn load_dotenv() {
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

fn truncate_like_review(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        content.to_string()
    } else {
        let truncated: String = content.chars().take(max_chars).collect();
        format!("{truncated}\n\n[truncated]")
    }
}

pub(crate) fn build_review_input_payload(
    repo_root: &Path,
    base: &str,
    head: &str,
    rules_file: Option<&str>,
) -> Result<ReviewInputPayload, String> {
    let diff_range = format!("{base}..{head}");
    let changed_files = git_lines(repo_root, &["diff", "--name-only", &diff_range])?;
    let diff_stat = git_output(repo_root, &["diff", "--stat", &diff_range])?;
    let diff = truncate_like_review(
        &git_output(repo_root, &["diff", "--unified=3", &diff_range])?,
        40_000,
    );
    let review_rules = load_review_rules(repo_root, rules_file)?;
    let config_snippets = load_config_snippets(repo_root);
    let historical_related_files =
        compute_historical_related_files(repo_root, &diff_range, head, 20)
            .ok()
            .filter(|items| !items.is_empty());

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
        graph_review_context: load_graph_review_context(repo_root, base),
        historical_related_files,
    })
}

fn load_graph_review_context(repo_root: &Path, base: &str) -> Option<Value> {
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

pub(crate) fn load_specialist_by_id(
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
        .ok_or_else(|| format!("Missing specialist definition: {specialist_id}"))
}
