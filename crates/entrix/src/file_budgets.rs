use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetOverride {
    pub path: String,
    pub max_lines: usize,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileBudgetConfig {
    pub default_max_lines: usize,
    pub include_roots: Vec<String>,
    pub extensions: Vec<String>,
    pub extension_max_lines: BTreeMap<String, usize>,
    pub excluded_parts: Vec<String>,
    #[serde(default)]
    pub overrides: Vec<BudgetOverride>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileBudgetViolation {
    pub path: String,
    pub line_count: usize,
    pub max_lines: usize,
    #[serde(default)]
    pub reason: String,
}

pub fn load_config(config_path: &Path) -> Result<FileBudgetConfig, String> {
    let raw = std::fs::read_to_string(config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid file budget config: {error}"))
}

pub fn is_tracked_source_file(relative_path: &str, config: &FileBudgetConfig) -> bool {
    if !config
        .include_roots
        .iter()
        .any(|root| relative_path == root || relative_path.starts_with(&format!("{root}/")))
    {
        return false;
    }
    if !config
        .extensions
        .iter()
        .any(|extension| relative_path.ends_with(extension))
    {
        return false;
    }
    !config
        .excluded_parts
        .iter()
        .any(|part| relative_path.contains(part))
}

pub fn list_changed_files(
    repo_root: &Path,
    base: &str,
    staged_only: bool,
) -> Result<Vec<String>, String> {
    let mut command = Command::new("git");
    command.current_dir(repo_root).arg("diff");
    if staged_only {
        command.arg("--cached");
    }
    command.args(["--name-only", "--diff-filter=ACMR"]);
    if !staged_only {
        command.arg(base);
    }
    let git_roots = config_roots_for_git_diff(repo_root);
    if !git_roots.is_empty() {
        command.arg("--");
        command.args(git_roots);
    }

    let output = command
        .output()
        .map_err(|error| format!("failed to run git diff: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git diff failed".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

pub fn resolve_paths(
    repo_root: &Path,
    config: &FileBudgetConfig,
    explicit_paths: &[String],
    changed_only: bool,
    staged_only: bool,
    base: &str,
    overrides_only: bool,
) -> Result<Vec<String>, String> {
    if staged_only {
        let mut paths = list_changed_files(repo_root, base, true)?;
        if overrides_only {
            retain_override_paths(&mut paths, config);
        }
        return Ok(paths);
    }

    if changed_only {
        let mut paths = list_changed_files(repo_root, base, false)?;
        if overrides_only {
            retain_override_paths(&mut paths, config);
        }
        return Ok(paths);
    }

    if overrides_only {
        return Ok(config
            .overrides
            .iter()
            .map(|entry| entry.path.clone())
            .collect());
    }

    if !explicit_paths.is_empty() {
        return Ok(explicit_paths.to_vec());
    }

    let mut collected = Vec::new();
    for root in &config.include_roots {
        let base = repo_root.join(root);
        if !base.exists() {
            continue;
        }
        collect_all_files(repo_root, &base, &mut collected);
    }
    Ok(collected)
}

pub fn evaluate_paths(
    repo_root: &Path,
    relative_paths: &[String],
    config: &FileBudgetConfig,
    use_head_ratchet: bool,
) -> Vec<FileBudgetViolation> {
    let mut violations = Vec::new();
    for relative_path in BTreeSet::<String>::from_iter(relative_paths.iter().cloned()) {
        if !is_tracked_source_file(&relative_path, config) {
            continue;
        }
        let file_path = repo_root.join(&relative_path);
        if !file_path.is_file() {
            continue;
        }

        let (configured_max_lines, mut reason) = resolve_budget(&relative_path, config);
        let mut max_lines = configured_max_lines;
        if use_head_ratchet {
            if let Some(baseline_lines) = count_head_lines(repo_root, &relative_path) {
                max_lines = max_lines.max(baseline_lines);
                if baseline_lines > configured_max_lines && reason.is_empty() {
                    reason =
                        format!("legacy hotspot frozen at HEAD baseline ({baseline_lines} lines)");
                }
            }
        }
        let line_count = count_lines(&file_path);
        if line_count > max_lines {
            violations.push(FileBudgetViolation {
                path: relative_path,
                line_count,
                max_lines,
                reason,
            });
        }
    }
    violations
}

fn retain_override_paths(paths: &mut Vec<String>, config: &FileBudgetConfig) {
    let overrides = config
        .overrides
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<BTreeSet<_>>();
    paths.retain(|path| overrides.contains(path.as_str()));
}

pub fn resolve_budget(relative_path: &str, config: &FileBudgetConfig) -> (usize, String) {
    if let Some(entry) = config
        .overrides
        .iter()
        .find(|entry| entry.path == relative_path)
    {
        return (entry.max_lines, entry.reason.clone());
    }
    let extension = Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    if let Some(extension) = extension {
        if let Some(limit) = config.extension_max_lines.get(&extension) {
            return (*limit, String::new());
        }
    }
    (config.default_max_lines, String::new())
}

pub fn count_lines(file_path: &Path) -> usize {
    match std::fs::read_to_string(file_path) {
        Ok(content) if !content.is_empty() => content.lines().count(),
        Ok(_) => 0,
        Err(_) => 0,
    }
}

pub fn count_head_lines(repo_root: &Path, relative_path: &str) -> Option<usize> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{relative_path}")])
        .current_dir(repo_root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).lines().count())
}

fn config_roots_for_git_diff(repo_root: &Path) -> Vec<&'static str> {
    let roots = ["src", "apps", "crates", "scripts", "tests", "e2e", "tools"];
    roots
        .into_iter()
        .filter(|root| repo_root.join(root).exists())
        .collect()
}

fn collect_all_files(repo_root: &Path, base: &Path, collected: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_all_files(repo_root, &path, collected);
        } else if path.is_file() {
            collected.push(normalize_repo_path(&path, repo_root));
        }
    }
}

pub fn normalize_repo_path(path: &Path, repo_root: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_config() -> FileBudgetConfig {
        FileBudgetConfig {
            default_max_lines: 10,
            include_roots: vec!["src".to_string(), "crates".to_string()],
            extensions: vec![".ts".to_string(), ".rs".to_string()],
            extension_max_lines: BTreeMap::from([(".rs".to_string(), 8)]),
            excluded_parts: vec!["/target/".to_string()],
            overrides: vec![BudgetOverride {
                path: "src/legacy.ts".to_string(),
                max_lines: 12,
                reason: "legacy hotspot".to_string(),
            }],
        }
    }

    #[test]
    fn tracked_source_file_checks_roots_extensions_and_exclusions() {
        let config = make_config();
        assert!(is_tracked_source_file("crates/foo/src/lib.rs", &config));
        assert!(!is_tracked_source_file(
            "docs/fitness/code-quality.md",
            &config
        ));
        assert!(!is_tracked_source_file(
            "crates/foo/target/generated.rs",
            &config
        ));
    }

    #[test]
    fn evaluate_paths_applies_budgets() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        std::fs::create_dir_all(repo_root.join("src")).expect("src");
        std::fs::write(repo_root.join("src/app.ts"), ["x"; 11].join("\n")).expect("write");

        let violations = evaluate_paths(
            repo_root,
            &["src/app.ts".to_string()],
            &make_config(),
            false,
        );

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].max_lines, 10);
    }
}
