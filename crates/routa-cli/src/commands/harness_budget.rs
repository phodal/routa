use clap::Args;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_CONFIG_PATH: &str = "tools/entrix/file_budgets.json";
const DEFAULT_MAX_LINES: usize = 1000;
const DEFAULT_INCLUDE_ROOTS: &[&str] = &["src", "apps", "crates"];
const DEFAULT_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".rs"];
const DEFAULT_EXCLUDED_PARTS: &[&str] = &[
    "/node_modules/",
    "/target/",
    "/.next/",
    "/_next/",
    "/bundled/",
];

#[derive(Args, Debug, Clone)]
pub struct FileBudgetArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Budget config path, relative to repo root unless absolute.
    #[arg(long, default_value = DEFAULT_CONFIG_PATH)]
    pub config: String,

    /// Only inspect files changed relative to the given base ref.
    #[arg(long, default_value_t = false)]
    pub changed_only: bool,

    /// Git base ref used with --changed-only.
    #[arg(long, default_value = "HEAD")]
    pub base: String,

    /// Only inspect files explicitly listed in the config overrides section.
    #[arg(long, default_value_t = false)]
    pub overrides_only: bool,

    /// Emit JSON instead of the default text summary.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct FileBudgetOverride {
    path: Option<String>,
    max_lines: Option<usize>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FileBudgetConfig {
    default_max_lines: Option<usize>,
    include_roots: Option<Vec<String>>,
    extensions: Option<Vec<String>>,
    extension_max_lines: Option<HashMap<String, usize>>,
    excluded_parts: Option<Vec<String>>,
    overrides: Option<Vec<FileBudgetOverride>>,
}

#[derive(Debug, Clone)]
struct NormalizedFileBudgetConfig {
    default_max_lines: usize,
    include_roots: Vec<String>,
    extensions: Vec<String>,
    extension_max_lines: HashMap<String, usize>,
    excluded_parts: Vec<String>,
    overrides: Vec<FileBudgetOverride>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum ViolationKind {
    BudgetExceeded,
    BaselineFrozenGrowth,
    OverrideBudgetExceeded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBudgetViolation {
    relative_path: String,
    line_count: usize,
    budget_limit: usize,
    allowed_max_lines: usize,
    baseline_line_count: Option<usize>,
    reason: Option<String>,
    violation_kind: ViolationKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBudgetReport {
    repo_root: String,
    config_path: String,
    changed_only: bool,
    base_ref: String,
    overrides_only: bool,
    candidate_count: usize,
    violations: Vec<FileBudgetViolation>,
    warnings: Vec<String>,
}

pub fn run_budget(args: &FileBudgetArgs, repo_root: &Path) -> Result<(), String> {
    let mut warnings = Vec::new();
    let config_path = resolve_config_path(repo_root, &args.config);
    let config = load_config(&config_path, &mut warnings);

    let candidates = if args.changed_only {
        list_changed_files(repo_root, &args.base)?
    } else {
        list_all_budgeted_files(repo_root, &config)
    };

    let violations = candidates
        .iter()
        .filter_map(|relative_path| evaluate_file(repo_root, relative_path, &config, args))
        .collect::<Vec<_>>();

    let report = FileBudgetReport {
        repo_root: repo_root.display().to_string(),
        config_path: config_path.display().to_string(),
        changed_only: args.changed_only,
        base_ref: args.base.clone(),
        overrides_only: args.overrides_only,
        candidate_count: candidates.len(),
        violations,
        warnings,
    };

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("failed to serialize budget report: {error}"))?
        );
    } else {
        print_text_report(&report);
    }

    Ok(())
}

fn print_text_report(report: &FileBudgetReport) {
    println!("file_budget_candidates: {}", report.candidate_count);
    println!("file_budget_violations: {}", report.violations.len());

    for warning in &report.warnings {
        println!("warning: {warning}");
    }

    for violation in &report.violations {
        let baseline = violation
            .baseline_line_count
            .map(|value| value.to_string())
            .unwrap_or_else(|| "n/a".to_string());
        let reason = violation
            .reason
            .as_ref()
            .map(|value| format!(" reason={value}"))
            .unwrap_or_default();
        println!(
            "{}: lines={} allowed={} budget={} baseline={} kind={:?}{}",
            violation.relative_path,
            violation.line_count,
            violation.allowed_max_lines,
            violation.budget_limit,
            baseline,
            violation.violation_kind,
            reason
        );
    }
}

fn resolve_config_path(repo_root: &Path, config: &str) -> PathBuf {
    let config_path = Path::new(config);
    if config_path.is_absolute() {
        config_path.to_path_buf()
    } else {
        repo_root.join(config_path)
    }
}

fn load_config(config_path: &Path, warnings: &mut Vec<String>) -> NormalizedFileBudgetConfig {
    if !config_path.exists() {
        warnings.push(format!(
            "Missing {}; using default long-file budget thresholds.",
            config_path.display()
        ));
        return default_config();
    }

    match fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<FileBudgetConfig>(&raw).ok())
    {
        Some(config) => normalize_config(config),
        None => {
            warnings.push(format!(
                "Failed to parse {}; using default long-file budget thresholds.",
                config_path.display()
            ));
            default_config()
        }
    }
}

fn default_config() -> NormalizedFileBudgetConfig {
    let mut extension_max_lines = HashMap::new();
    extension_max_lines.insert(".rs".to_string(), 800);
    extension_max_lines.insert(".ts".to_string(), 1000);
    extension_max_lines.insert(".tsx".to_string(), 1000);

    NormalizedFileBudgetConfig {
        default_max_lines: DEFAULT_MAX_LINES,
        include_roots: DEFAULT_INCLUDE_ROOTS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        extensions: DEFAULT_EXTENSIONS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        extension_max_lines,
        excluded_parts: DEFAULT_EXCLUDED_PARTS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        overrides: Vec::new(),
    }
}

fn normalize_config(config: FileBudgetConfig) -> NormalizedFileBudgetConfig {
    let mut normalized = default_config();
    if let Some(default_max_lines) = config.default_max_lines {
        normalized.default_max_lines = default_max_lines;
    }
    if let Some(include_roots) = config.include_roots {
        normalized.include_roots = include_roots;
    }
    if let Some(extensions) = config.extensions {
        normalized.extensions = extensions;
    }
    if let Some(extension_max_lines) = config.extension_max_lines {
        normalized.extension_max_lines.extend(extension_max_lines);
    }
    if let Some(excluded_parts) = config.excluded_parts {
        normalized.excluded_parts = excluded_parts;
    }
    if let Some(overrides) = config.overrides {
        normalized.overrides = overrides;
    }
    normalized
}

fn list_changed_files(repo_root: &Path, base_ref: &str) -> Result<Vec<String>, String> {
    let output = git_output(
        repo_root,
        ["diff", "--name-only", "--diff-filter=ACMR", base_ref, "--"],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.replace('\\', "/"))
        .collect())
}

fn list_all_budgeted_files(repo_root: &Path, config: &NormalizedFileBudgetConfig) -> Vec<String> {
    let mut collected = Vec::new();
    for root in &config.include_roots {
        let absolute_root = repo_root.join(root);
        if absolute_root.is_dir() {
            walk_files(&absolute_root, &mut collected);
        }
    }

    collected
        .into_iter()
        .filter_map(|absolute_path| {
            absolute_path
                .strip_prefix(repo_root)
                .ok()
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        })
        .filter(|relative_path| should_include_file(relative_path, config))
        .collect()
}

fn walk_files(dir: &Path, collected: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, collected);
        } else if path.is_file() {
            collected.push(path);
        }
    }
}

fn should_include_file(relative_path: &str, config: &NormalizedFileBudgetConfig) -> bool {
    let normalized_path = relative_path.replace('\\', "/");
    let extension = Path::new(&normalized_path)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    if !config
        .extensions
        .iter()
        .any(|candidate| candidate == &extension)
    {
        return false;
    }

    if !config
        .include_roots
        .iter()
        .any(|root| normalized_path == *root || normalized_path.starts_with(&format!("{root}/")))
    {
        return false;
    }

    config
        .excluded_parts
        .iter()
        .all(|excluded| !normalized_path.contains(excluded))
}

fn evaluate_file(
    repo_root: &Path,
    relative_path: &str,
    config: &NormalizedFileBudgetConfig,
    args: &FileBudgetArgs,
) -> Option<FileBudgetViolation> {
    if !should_include_file(relative_path, config) {
        return None;
    }

    let override_entry = find_override(relative_path, &config.overrides);
    if args.overrides_only && override_entry.is_none() {
        return None;
    }

    let absolute_path = repo_root.join(relative_path);
    let source = fs::read_to_string(&absolute_path).ok()?;
    let line_count = count_lines(&source);
    let extension = Path::new(relative_path)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let budget_limit = override_entry
        .and_then(|entry| entry.max_lines)
        .or_else(|| config.extension_max_lines.get(&extension).copied())
        .unwrap_or(config.default_max_lines);

    let baseline_line_count = if args.changed_only {
        read_tracked_file(repo_root, &args.base, relative_path).map(|source| count_lines(&source))
    } else {
        None
    };

    let (allowed_max_lines, violation_kind) =
        if override_entry.and_then(|entry| entry.max_lines).is_some() {
            (budget_limit, ViolationKind::OverrideBudgetExceeded)
        } else if let Some(baseline) = baseline_line_count {
            if baseline > budget_limit {
                (baseline, ViolationKind::BaselineFrozenGrowth)
            } else {
                (budget_limit, ViolationKind::BudgetExceeded)
            }
        } else {
            (budget_limit, ViolationKind::BudgetExceeded)
        };

    if line_count <= allowed_max_lines {
        return None;
    }

    Some(FileBudgetViolation {
        relative_path: relative_path.to_string(),
        line_count,
        budget_limit,
        allowed_max_lines,
        baseline_line_count,
        reason: override_entry.and_then(|entry| entry.reason.clone()),
        violation_kind,
    })
}

fn find_override<'a>(
    relative_path: &str,
    overrides: &'a [FileBudgetOverride],
) -> Option<&'a FileBudgetOverride> {
    overrides.iter().find(|entry| {
        entry
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value == relative_path)
            .unwrap_or(false)
    })
}

fn read_tracked_file(repo_root: &Path, base_ref: &str, relative_path: &str) -> Option<String> {
    git_output(repo_root, ["show", &format!("{base_ref}:{relative_path}")]).ok()
}

fn git_output<const N: usize>(repo_root: &Path, args: [&str; N]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run git {}: {error}", args.join(" ")))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn count_lines(source: &str) -> usize {
    if source.is_empty() {
        0
    } else {
        source.lines().count()
    }
}
