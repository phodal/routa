//! Shared Rust-side feature-tree execution helpers.
//!
//! Both the Axum API and the Rust CLI shell out to the same TypeScript
//! generator. Keeping that process orchestration here preserves one
//! workspace-root resolution strategy and one error-normalization path.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value as JsonValue;

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

pub fn feature_tree_script_path() -> Result<PathBuf, String> {
    let script = workspace_root().join("scripts/docs/feature-tree-generator.ts");
    if script.exists() {
        Ok(script)
    } else {
        Err(format!(
            "Feature tree generator script not found at {}",
            script.display()
        ))
    }
}

pub fn run_feature_tree_script(args: &[String], working_dir: &Path) -> Result<Output, String> {
    let script = feature_tree_script_path()?;
    let mut command_args = vec!["--import".to_string(), "tsx".to_string()];
    command_args.push(script.to_string_lossy().to_string());
    command_args.extend(args.iter().cloned());

    Command::new("node")
        .args(&command_args)
        .current_dir(working_dir)
        .output()
        .map_err(|e| format!("Failed to run feature tree generator: {e}"))
}

pub fn ensure_feature_tree_success(output: &Output, context: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit code {}", output.status.code().unwrap_or(-1))
    };

    Err(format!("{context}: {details}"))
}

pub fn parse_feature_tree_json(output: &Output, context: &str) -> Result<JsonValue, String> {
    ensure_feature_tree_success(output, context)?;
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("{context}: failed to parse JSON output: {e}"))
}

fn feature_tree_args(mode: &str, repo_root: &Path) -> Vec<String> {
    vec![
        "--mode".to_string(),
        mode.to_string(),
        "--repo-root".to_string(),
        repo_root.to_string_lossy().to_string(),
    ]
}

pub fn preflight_feature_tree_json(repo_root: &Path) -> Result<JsonValue, String> {
    let args = feature_tree_args("preflight", repo_root);
    let output = run_feature_tree_script(&args, &workspace_root())?;
    parse_feature_tree_json(&output, "Feature tree preflight failed")
}

pub fn generate_feature_tree_json(repo_root: &Path, dry_run: bool) -> Result<JsonValue, String> {
    let mut args = feature_tree_args("generate", repo_root);
    args.push(if dry_run {
        "--dry-run".to_string()
    } else {
        "--write".to_string()
    });

    let output = run_feature_tree_script(&args, &workspace_root())?;
    parse_feature_tree_json(&output, "Feature tree generation failed")
}

pub fn commit_feature_tree_json(
    repo_root: &Path,
    scan_root: Option<&Path>,
    metadata: Option<&JsonValue>,
) -> Result<JsonValue, String> {
    let mut args = feature_tree_args("commit", repo_root);

    if let Some(scan_root) = scan_root {
        args.push("--scan-root".to_string());
        args.push(scan_root.to_string_lossy().to_string());
    }

    let metadata_dir = if let Some(metadata) = metadata {
        let dir = tempfile::tempdir()
            .map_err(|e| format!("Failed to create feature tree metadata tempdir: {e}"))?;
        let metadata_path = dir.path().join("metadata.json");
        let metadata_json = serde_json::to_vec(metadata)
            .map_err(|e| format!("Failed to serialize feature tree metadata: {e}"))?;
        std::fs::write(&metadata_path, metadata_json)
            .map_err(|e| format!("Failed to write feature tree metadata: {e}"))?;
        args.push("--metadata-file".to_string());
        args.push(metadata_path.to_string_lossy().to_string());
        Some(dir)
    } else {
        None
    };

    let output = run_feature_tree_script(&args, &workspace_root())?;
    let result = parse_feature_tree_json(&output, "Feature tree commit failed");
    drop(metadata_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::{feature_tree_script_path, workspace_root};

    #[test]
    fn resolves_workspace_root_to_repo_root() {
        let root = workspace_root();
        assert!(root.join("Cargo.toml").exists());
        assert!(root.join("scripts/docs/feature-tree-generator.ts").exists());
    }

    #[test]
    fn resolves_feature_tree_script_from_workspace_root() {
        let script = feature_tree_script_path().expect("script path should resolve");
        assert!(script.ends_with("scripts/docs/feature-tree-generator.ts"));
    }
}
