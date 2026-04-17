use crate::ui::state::RuntimeState;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(in crate::ui::tui) enum TestMappingAnalysisMode {
    #[default]
    Fast,
    Full,
}

impl TestMappingAnalysisMode {
    pub(in crate::ui::tui) fn uses_graph(self) -> bool {
        matches!(self, Self::Full)
    }

    pub(in crate::ui::tui) fn label(self) -> &'static str {
        match self {
            Self::Fast => "fast heuristic",
            Self::Full => "graph-aware",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(in crate::ui::tui) struct TestMappingSnapshot {
    pub(in crate::ui::tui) cache_key: String,
    pub(in crate::ui::tui) analysis_mode: TestMappingAnalysisMode,
    pub(in crate::ui::tui) by_file: BTreeMap<String, TestMappingEntry>,
    pub(in crate::ui::tui) skipped_test_files: BTreeSet<String>,
    pub(in crate::ui::tui) status_counts: BTreeMap<String, usize>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(in crate::ui::tui) struct TestMappingEntry {
    #[serde(default)]
    pub(in crate::ui::tui) source_file: String,
    #[serde(default)]
    pub(in crate::ui::tui) language: String,
    #[serde(default)]
    pub(in crate::ui::tui) status: String,
    #[serde(default)]
    pub(in crate::ui::tui) related_test_files: Vec<String>,
    #[serde(default)]
    pub(in crate::ui::tui) graph_test_files: Vec<String>,
    #[serde(default)]
    pub(in crate::ui::tui) resolver_kind: String,
    #[serde(default)]
    pub(in crate::ui::tui) confidence: String,
    #[serde(default)]
    pub(in crate::ui::tui) has_inline_tests: bool,
}

#[derive(Debug, Default, Deserialize)]
struct TestMappingCliPayload {
    #[serde(default)]
    mappings: Vec<TestMappingEntry>,
    #[serde(default)]
    skipped_test_files: Vec<String>,
    #[serde(default)]
    status_counts: BTreeMap<String, usize>,
}

#[cfg(test)]
pub(super) fn build_test_mapping_snapshot(
    cache_key: String,
    analysis_mode: TestMappingAnalysisMode,
    entries: Vec<TestMappingEntry>,
    skipped_test_files: Vec<String>,
) -> TestMappingSnapshot {
    let mut status_counts = BTreeMap::new();
    for entry in &entries {
        *status_counts.entry(entry.status.clone()).or_insert(0) += 1;
    }

    TestMappingSnapshot {
        cache_key,
        analysis_mode,
        by_file: entries
            .into_iter()
            .map(|entry| (entry.source_file.clone(), entry))
            .collect(),
        skipped_test_files: skipped_test_files.into_iter().collect(),
        status_counts,
    }
}

pub(super) fn test_mapping_cache_key(state: &RuntimeState) -> String {
    let mut markers = state
        .file_items()
        .iter()
        .filter(|file| file.dirty || file.conflicted)
        .map(|file| {
            format!(
                "{}:{}:{}",
                file.rel_path, file.state_code, file.last_modified_at_ms
            )
        })
        .collect::<Vec<_>>();
    markers.sort();
    markers.join("|")
}

pub(super) fn test_mapping_full_cache_key(state: &RuntimeState) -> Option<String> {
    let branch_oid = state.branch_oid.as_deref()?.trim();
    if branch_oid.is_empty() {
        return None;
    }
    Some(format!(
        "head={branch_oid};files={}",
        test_mapping_cache_key(state)
    ))
}

pub(super) fn load_test_mapping_snapshot(
    repo_root: &str,
    files: &[String],
    cache_key: String,
    analysis_mode: TestMappingAnalysisMode,
) -> Result<TestMappingSnapshot, String> {
    let mut command = entrix_command(Path::new(repo_root));
    command.current_dir(repo_root);
    command.args(test_mapping_cli_args(files, analysis_mode));

    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "entrix graph test-mapping failed".to_string()
        };
        return Err(message);
    }

    let payload: TestMappingCliPayload =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    Ok(TestMappingSnapshot {
        cache_key,
        analysis_mode,
        by_file: payload
            .mappings
            .into_iter()
            .map(|entry| (entry.source_file.clone(), entry))
            .collect(),
        skipped_test_files: payload.skipped_test_files.into_iter().collect(),
        status_counts: payload.status_counts,
    })
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

fn test_mapping_cli_args(files: &[String], analysis_mode: TestMappingAnalysisMode) -> Vec<String> {
    let mut args = vec![
        "graph".to_string(),
        "test-mapping".to_string(),
        "--json".to_string(),
    ];
    if !analysis_mode.uses_graph() {
        args.push("--no-graph".to_string());
    }
    args.extend(files.iter().cloned());
    args
}

pub(super) fn is_test_like_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".snap")
        || lower.ends_with(".snapshot")
        || lower.contains("/__snapshots__/")
        || lower.contains("/snapshots/")
}

#[cfg(test)]
mod tests {
    use super::{test_mapping_cli_args, TestMappingAnalysisMode};

    #[test]
    fn fast_mode_uses_no_graph_flag() {
        let args = test_mapping_cli_args(
            &["src/lib.rs".to_string(), "tests/lib_test.rs".to_string()],
            TestMappingAnalysisMode::Fast,
        );

        assert_eq!(
            args,
            vec![
                "graph",
                "test-mapping",
                "--json",
                "--no-graph",
                "src/lib.rs",
                "tests/lib_test.rs",
            ]
        );
    }

    #[test]
    fn full_mode_runs_without_no_graph_flag() {
        let args = test_mapping_cli_args(&[], TestMappingAnalysisMode::Full);

        assert_eq!(args, vec!["graph", "test-mapping", "--json"]);
    }
}
