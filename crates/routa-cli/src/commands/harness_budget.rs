use clap::Args;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_CONFIG_PATH: &str = "docs/fitness/file_budgets.json";
const DEFAULT_MAX_LINES: usize = 1600;
const DEFAULT_INCLUDE_ROOTS: &[&str] = &["src", "apps", "crates"];
const DEFAULT_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".rs"];
const DEFAULT_EXCLUDED_PARTS: &[&str] = &[
    "/node_modules/",
    "/target/",
    "/.next/",
    "/_next/",
    "/bundled/",
];

/// Evaluate repository files against the configured long-file budgets.
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

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ViolationKind {
    BudgetExceeded,
    BaselineFrozenGrowth,
    OverrideBudgetExceeded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Structured detail for one file that exceeded its allowed budget.
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
/// Structured output for a complete budget run.
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

/// Run the long-file budget checker and emit either text or JSON output.
pub fn run_budget(args: &FileBudgetArgs, repo_root: &Path) -> Result<(), String> {
    let report = build_budget_report(args, repo_root)?;

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("failed to serialize budget report: {error}"))?
        );
    } else {
        print_text_report(&report);
    }

    if !report.violations.is_empty() {
        return Err(format!(
            "found {} file budget violation(s)",
            report.violations.len()
        ));
    }

    Ok(())
}

fn build_budget_report(
    args: &FileBudgetArgs,
    repo_root: &Path,
) -> Result<FileBudgetReport, String> {
    let config_path = resolve_config_path(repo_root, &args.config);
    let config = load_config(&config_path)?;

    let mut candidates = if args.changed_only {
        list_changed_files(repo_root, &args.base)?
            .into_iter()
            .filter(|path| should_include_file(path, &config))
            .collect()
    } else {
        list_all_budgeted_files(repo_root, &config)
    };
    candidates.sort();

    let mut violations = candidates
        .iter()
        .filter_map(|relative_path| evaluate_file(repo_root, relative_path, &config, args))
        .collect::<Vec<_>>();
    violations.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| right.line_count.cmp(&left.line_count))
    });

    Ok(FileBudgetReport {
        repo_root: repo_root.display().to_string(),
        config_path: config_path.display().to_string(),
        changed_only: args.changed_only,
        base_ref: args.base.clone(),
        overrides_only: args.overrides_only,
        candidate_count: candidates.len(),
        violations,
        warnings: Vec::new(),
    })
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

fn load_config(config_path: &Path) -> Result<NormalizedFileBudgetConfig, String> {
    let raw = fs::read_to_string(config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let config = serde_json::from_str::<FileBudgetConfig>(&raw).map_err(|error| {
        format!(
            "invalid file budget config {}: {error}",
            config_path.display()
        )
    })?;
    Ok(normalize_config(config))
}

fn default_config() -> NormalizedFileBudgetConfig {
    let mut extension_max_lines = HashMap::new();
    extension_max_lines.insert(".rs".to_string(), DEFAULT_MAX_LINES);
    extension_max_lines.insert(".ts".to_string(), DEFAULT_MAX_LINES);
    extension_max_lines.insert(".tsx".to_string(), DEFAULT_MAX_LINES);

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
        normalized.include_roots = include_roots
            .into_iter()
            .map(|value| normalize_root_path(&value))
            .filter(|value| !value.is_empty())
            .collect();
    }
    if let Some(extensions) = config.extensions {
        normalized.extensions = extensions
            .into_iter()
            .map(|value| normalize_extension(&value))
            .filter(|value| !value.is_empty())
            .collect();
    }
    if let Some(extension_max_lines) = config.extension_max_lines {
        normalized.extension_max_lines.extend(
            extension_max_lines
                .into_iter()
                .map(|(key, value)| (normalize_extension(&key), value))
                .filter(|(key, _)| !key.is_empty()),
        );
    }
    if let Some(excluded_parts) = config.excluded_parts {
        normalized.excluded_parts = excluded_parts
            .into_iter()
            .map(|value| normalize_path_sequence(&value))
            .filter(|value| !value.is_empty())
            .collect();
    }
    if let Some(overrides) = config.overrides {
        normalized.overrides = overrides;
    }
    normalized
}

fn list_changed_files(repo_root: &Path, base_ref: &str) -> Result<Vec<String>, String> {
    let output = git_output(
        repo_root,
        [
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            "--end-of-options",
            base_ref,
            "--",
        ],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(normalize_relative_path)
        .collect())
}

fn list_all_budgeted_files(repo_root: &Path, config: &NormalizedFileBudgetConfig) -> Vec<String> {
    let mut collected = Vec::new();
    for root in &config.include_roots {
        let absolute_root = repo_root.join(root);
        if absolute_root.is_dir() {
            walk_files(repo_root, &absolute_root, config, &mut collected);
        }
    }

    collected
}

fn walk_files(
    repo_root: &Path,
    dir: &Path,
    config: &NormalizedFileBudgetConfig,
    collected: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(relative_path) = path.strip_prefix(repo_root) else {
            continue;
        };
        let normalized_relative_path =
            normalize_relative_path(relative_path.to_string_lossy().as_ref());
        if is_excluded_path(&normalized_relative_path, config) {
            continue;
        }

        if path.is_dir() {
            walk_files(repo_root, &path, config, collected);
        } else if path.is_file() && should_include_file(&normalized_relative_path, config) {
            collected.push(normalized_relative_path);
        }
    }
}

fn should_include_file(relative_path: &str, config: &NormalizedFileBudgetConfig) -> bool {
    let normalized_path = normalize_relative_path(relative_path);
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

    !is_excluded_path(&normalized_path, config)
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
    let revision = format!("{base_ref}:{relative_path}");
    git_output(repo_root, ["show", "--end-of-options", &revision]).ok()
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

fn normalize_extension(value: &str) -> String {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with('.') {
        trimmed
    } else {
        format!(".{trimmed}")
    }
}

fn normalize_root_path(value: &str) -> String {
    normalize_path_sequence(value)
}

fn normalize_relative_path(value: &str) -> String {
    normalize_path_sequence(value)
}

fn normalize_path_sequence(value: &str) -> String {
    value
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn is_excluded_path(relative_path: &str, config: &NormalizedFileBudgetConfig) -> bool {
    config
        .excluded_parts
        .iter()
        .any(|excluded| path_contains_sequence(relative_path, excluded))
}

fn path_contains_sequence(path: &str, needle: &str) -> bool {
    let path_parts = path_segments(path);
    let needle_segments = path_segments(needle);

    if needle_segments.is_empty() || needle_segments.len() > path_parts.len() {
        return false;
    }

    path_parts
        .windows(needle_segments.len())
        .any(|window| window == needle_segments.as_slice())
}

fn path_segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        build_budget_report, run_budget, FileBudgetArgs, ViolationKind, DEFAULT_CONFIG_PATH,
    };
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn changed_only_freezes_legacy_hotspots_at_head_baseline() {
        let repo = init_git_repo();
        write_budget_config(
            repo.path(),
            json!({
                "default_max_lines": 3,
                "include_roots": ["src"],
                "extensions": [".ts"],
                "extension_max_lines": { ".ts": 3 },
                "overrides": []
            }),
        );
        write_file(repo.path(), "src/legacy.ts", 5);
        commit_all(repo.path(), "baseline");

        write_file(repo.path(), "src/legacy.ts", 6);

        let report = build_budget_report(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: true,
                base: "HEAD".to_string(),
                overrides_only: false,
                json: false,
            },
            repo.path(),
        )
        .expect("budget report should build");

        assert_eq!(report.violations.len(), 1);
        let violation = &report.violations[0];
        assert_eq!(violation.relative_path, "src/legacy.ts");
        assert_eq!(violation.line_count, 6);
        assert_eq!(violation.budget_limit, 3);
        assert_eq!(violation.allowed_max_lines, 5);
        assert_eq!(violation.baseline_line_count, Some(5));
        assert_eq!(
            violation.violation_kind,
            ViolationKind::BaselineFrozenGrowth
        );
    }

    #[test]
    fn changed_only_candidate_count_ignores_non_budget_files() {
        let repo = init_git_repo();
        write_budget_config(
            repo.path(),
            json!({
                "default_max_lines": 10,
                "include_roots": ["src"],
                "extensions": [".ts"],
                "extension_max_lines": { ".ts": 10 },
                "overrides": []
            }),
        );
        write_file(repo.path(), "README.md", 1);
        write_file(repo.path(), "src/app.ts", 1);
        commit_all(repo.path(), "baseline");

        write_file(repo.path(), "README.md", 2);
        write_file(repo.path(), "src/app.ts", 2);

        let report = build_budget_report(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: true,
                base: "HEAD".to_string(),
                overrides_only: false,
                json: false,
            },
            repo.path(),
        )
        .expect("budget report should build");

        assert_eq!(report.candidate_count, 1);
        assert!(report.violations.is_empty());
    }

    #[test]
    fn overrides_only_reports_only_configured_hotspots() {
        let repo = init_git_repo();
        write_budget_config(
            repo.path(),
            json!({
                "default_max_lines": 3,
                "include_roots": ["src"],
                "extensions": [".ts"],
                "extension_max_lines": { ".ts": 3 },
                "overrides": [
                    {
                        "path": "src/legacy.ts",
                        "max_lines": 4,
                        "reason": "legacy hotspot freeze"
                    }
                ]
            }),
        );
        write_file(repo.path(), "src/legacy.ts", 5);
        write_file(repo.path(), "src/new.ts", 5);

        let report = build_budget_report(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: false,
                base: "HEAD".to_string(),
                overrides_only: true,
                json: false,
            },
            repo.path(),
        )
        .expect("budget report should build");

        assert_eq!(report.violations.len(), 1);
        let violation = &report.violations[0];
        assert_eq!(violation.relative_path, "src/legacy.ts");
        assert_eq!(violation.allowed_max_lines, 4);
        assert_eq!(violation.reason.as_deref(), Some("legacy hotspot freeze"));
        assert_eq!(
            violation.violation_kind,
            ViolationKind::OverrideBudgetExceeded
        );
    }

    #[test]
    fn invalid_budget_config_fails_fast() {
        let repo = init_git_repo();
        let config_path = repo.path().join(DEFAULT_CONFIG_PATH);
        fs::create_dir_all(
            config_path
                .parent()
                .expect("budget config should have a parent directory"),
        )
        .expect("create config dir");
        fs::write(&config_path, "{ not-valid-json").expect("write invalid config");

        let error = build_budget_report(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: false,
                base: "HEAD".to_string(),
                overrides_only: false,
                json: false,
            },
            repo.path(),
        )
        .expect_err("invalid config should fail");

        assert!(error.contains("invalid file budget config"));
        assert!(error.contains("docs/fitness/file_budgets.json"));
    }

    #[test]
    fn run_budget_returns_error_when_violations_exist() {
        let repo = init_git_repo();
        write_budget_config(
            repo.path(),
            json!({
                "default_max_lines": 1,
                "include_roots": ["src"],
                "extensions": [".ts"],
                "extension_max_lines": { ".ts": 1 },
                "overrides": []
            }),
        );
        write_file(repo.path(), "src/app.ts", 2);

        let error = run_budget(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: false,
                base: "HEAD".to_string(),
                overrides_only: false,
                json: false,
            },
            repo.path(),
        )
        .expect_err("violations should fail the command");

        assert_eq!(error, "found 1 file budget violation(s)");
    }

    #[test]
    fn normalize_config_accepts_common_extension_and_path_variants() {
        let repo = init_git_repo();
        write_budget_config(
            repo.path(),
            json!({
                "default_max_lines": 10,
                "include_roots": ["src/"],
                "extensions": ["TS"],
                "extension_max_lines": { "ts": 1 },
                "excluded_parts": ["/generated/"],
                "overrides": []
            }),
        );
        write_file(repo.path(), "src/Mixed.TS", 2);
        write_file(repo.path(), "src/generated/skip.TS", 4);

        let report = build_budget_report(
            &FileBudgetArgs {
                repo_root: None,
                config: DEFAULT_CONFIG_PATH.to_string(),
                changed_only: false,
                base: "HEAD".to_string(),
                overrides_only: false,
                json: false,
            },
            repo.path(),
        )
        .expect("budget report should build");

        assert_eq!(report.candidate_count, 1);
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].relative_path, "src/Mixed.TS");
        assert_eq!(report.violations[0].budget_limit, 1);
    }

    fn init_git_repo() -> TempDir {
        let repo = TempDir::new().expect("temp dir");
        run_git(repo.path(), ["init"]);
        run_git(repo.path(), ["config", "user.name", "Codex"]);
        run_git(repo.path(), ["config", "user.email", "codex@openai.com"]);
        repo
    }

    fn commit_all(repo_root: &Path, message: &str) {
        run_git(repo_root, ["add", "."]);
        run_git(repo_root, ["commit", "-m", message]);
    }

    fn write_budget_config(repo_root: &Path, value: serde_json::Value) {
        let path = repo_root.join(DEFAULT_CONFIG_PATH);
        fs::create_dir_all(
            path.parent()
                .expect("budget config should have a parent directory"),
        )
        .expect("create config dir");
        fs::write(
            path,
            serde_json::to_string_pretty(&value).expect("serialize config"),
        )
        .expect("write config");
    }

    fn write_file(repo_root: &Path, relative_path: &str, line_count: usize) {
        let path = repo_root.join(relative_path);
        fs::create_dir_all(
            path.parent()
                .expect("test file should have a parent directory"),
        )
        .expect("create test dir");
        let body = (1..=line_count)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(path, format!("{body}\n")).expect("write test file");
    }

    fn run_git<const N: usize>(repo_root: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
