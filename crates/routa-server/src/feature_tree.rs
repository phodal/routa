//! Shared Rust-side feature-tree execution helpers.
//!
//! Both the Axum API and the Rust CLI shell out to the same TypeScript
//! generator. Keeping that process orchestration here preserves one
//! workspace-root resolution strategy and one error-normalization path.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value as JsonValue;

const FEATURE_TREE_TS_RELATIVE_PATH: &str = "scripts/docs/feature-tree-generator.ts";
const BUNDLED_FEATURE_TREE_RELATIVE_PATH: &str = "bundled/feature-tree/feature-tree-generator.mjs";

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn bundled_feature_tree_script_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(BUNDLED_FEATURE_TREE_RELATIVE_PATH)
}

fn feature_tree_script_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(raw) = env::var("ROUTA_FEATURE_TREE_GENERATOR_PATH") {
        let override_path = PathBuf::from(raw.trim());
        if !override_path.as_os_str().is_empty() {
            candidates.push(override_path);
        }
    }

    if let Ok(raw) = env::var("ROUTA_FEATURE_TREE_RESOURCE_DIR") {
        let resource_dir = PathBuf::from(raw.trim());
        if !resource_dir.as_os_str().is_empty() {
            candidates.push(bundled_feature_tree_script_path(&resource_dir));
        }
    }

    candidates.push(workspace_root().join(FEATURE_TREE_TS_RELATIVE_PATH));
    candidates
}

pub fn feature_tree_script_path() -> Result<PathBuf, String> {
    let candidates = feature_tree_script_candidates();
    for script in &candidates {
        if script.is_file() {
            return Ok(script.to_path_buf());
        }
    }

    Err(format!(
        "Feature tree generator script not found. Checked: {}",
        candidates
            .iter()
            .map(|candidate| candidate.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn feature_tree_command_args(script: &Path, args: &[String]) -> Vec<String> {
    let mut command_args = Vec::new();
    if script.extension().and_then(|ext| ext.to_str()) == Some("ts") {
        command_args.push("--import".to_string());
        command_args.push("tsx".to_string());
        command_args.push(script.to_string_lossy().to_string());
        command_args.extend(args.iter().cloned());
        return command_args;
    }

    let script_literal = serde_json::to_string(&script.to_string_lossy().to_string())
        .expect("feature tree script path should serialize as a JSON string");
    command_args.push("--input-type".to_string());
    command_args.push("module".to_string());
    command_args.push("--eval".to_string());
    command_args.push(format!(
        "const {{ pathToFileURL }} = await import('node:url'); const mod = await import(pathToFileURL({script_literal}).href); await mod.main(process.argv.slice(1));"
    ));
    command_args.push("--".to_string());
    command_args.extend(args.iter().cloned());
    command_args
}

fn feature_tree_execution_dir(script: &Path, requested_dir: &Path) -> PathBuf {
    if script.extension().and_then(|ext| ext.to_str()) == Some("ts") {
        return workspace_root();
    }

    requested_dir.to_path_buf()
}

pub fn run_feature_tree_script(args: &[String], working_dir: &Path) -> Result<Output, String> {
    let script = feature_tree_script_path()?;
    let command_args = feature_tree_command_args(&script, args);
    let execution_dir = feature_tree_execution_dir(&script, working_dir);

    Command::new("node")
        .args(&command_args)
        .current_dir(execution_dir)
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
    let output = run_feature_tree_script(&args, repo_root)?;
    parse_feature_tree_json(&output, "Feature tree preflight failed")
}

pub fn generate_feature_tree_json(repo_root: &Path, dry_run: bool) -> Result<JsonValue, String> {
    let mut args = feature_tree_args("generate", repo_root);
    args.push(if dry_run {
        "--dry-run".to_string()
    } else {
        "--write".to_string()
    });

    let output = run_feature_tree_script(&args, repo_root)?;
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

    let output = run_feature_tree_script(&args, repo_root)?;
    let result = parse_feature_tree_json(&output, "Feature tree commit failed");
    drop(metadata_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_feature_tree_script_path, ensure_feature_tree_success, feature_tree_command_args,
        feature_tree_execution_dir, feature_tree_script_path, run_feature_tree_script,
        workspace_root,
    };
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn resolves_workspace_root_to_repo_root() {
        let root = workspace_root();
        assert!(root.join("Cargo.toml").exists());
        assert!(root.join(super::FEATURE_TREE_TS_RELATIVE_PATH).exists());
    }

    #[test]
    fn resolves_feature_tree_script_from_workspace_root() {
        let script = feature_tree_script_path().expect("script path should resolve");
        assert!(script.ends_with(super::FEATURE_TREE_TS_RELATIVE_PATH));
    }

    #[test]
    fn ignores_directory_override_when_resolving_script_path() {
        let temp_dir = tempdir().expect("tempdir");
        unsafe {
            std::env::set_var("ROUTA_FEATURE_TREE_GENERATOR_PATH", temp_dir.path());
        }

        let script = feature_tree_script_path().expect("workspace fallback should resolve");
        assert!(script.ends_with(super::FEATURE_TREE_TS_RELATIVE_PATH));

        unsafe {
            std::env::remove_var("ROUTA_FEATURE_TREE_GENERATOR_PATH");
        }
    }

    #[test]
    fn resolves_bundled_feature_tree_script_under_resource_dir() {
        let script = bundled_feature_tree_script_path(Path::new("/tmp/routa-resources"));
        assert!(script.ends_with(super::BUNDLED_FEATURE_TREE_RELATIVE_PATH));
    }

    #[test]
    fn uses_tsx_only_for_typescript_generators() {
        let ts_args = feature_tree_command_args(
            Path::new("/tmp/feature-tree-generator.ts"),
            &["--mode".to_string(), "generate".to_string()],
        );
        assert_eq!(ts_args[0], "--import");
        assert_eq!(ts_args[1], "tsx");
        assert_eq!(ts_args[2], "/tmp/feature-tree-generator.ts");

        let js_args = feature_tree_command_args(
            Path::new("/tmp/feature-tree-generator.mjs"),
            &["--mode".to_string(), "generate".to_string()],
        );
        assert_eq!(js_args[0], "--input-type");
        assert_eq!(js_args[1], "module");
        assert_eq!(js_args[2], "--eval");
        assert_eq!(js_args[4], "--");
        assert_eq!(js_args[5], "--mode");
    }

    #[test]
    fn feature_tree_typescript_generators_run_from_workspace_root() {
        let execution_dir = feature_tree_execution_dir(
            Path::new("/tmp/workspace/scripts/docs/feature-tree-generator.ts"),
            Path::new("/tmp/target-repo"),
        );
        assert_eq!(execution_dir, workspace_root());
    }

    #[test]
    fn feature_tree_bundled_generators_run_from_requested_directory() {
        let bundled_execution_dir = feature_tree_execution_dir(
            Path::new("/tmp/resources/bundled/feature-tree/feature-tree-generator.mjs"),
            Path::new("/tmp/target-repo"),
        );
        assert_eq!(bundled_execution_dir, Path::new("/tmp/target-repo"));
    }

    #[test]
    fn relative_scan_root_resolves_from_requested_directory() {
        let repo_root = workspace_root();
        let args = vec![
            "--mode".to_string(),
            "generate".to_string(),
            "--repo-root".to_string(),
            repo_root.to_string_lossy().to_string(),
            "--scan-root".to_string(),
            "src".to_string(),
            "--dry-run".to_string(),
        ];

        let output = run_feature_tree_script(&args, &repo_root).expect("script should run");
        ensure_feature_tree_success(&output, "relative scan root should resolve from repo root")
            .expect("feature tree generation should succeed");
    }
}
