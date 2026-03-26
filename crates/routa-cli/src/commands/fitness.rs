//! `routa fitness` — repository fitness and fluency assessment entrypoints.

use clap::{Args, Subcommand, ValueEnum};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

const FITNESS_FLUENCY_CLI_RELATIVE_PATH: &str = "tools/harness-fluency/src/cli.ts";

#[derive(Subcommand, Debug, Clone)]
pub enum FitnessAction {
    /// Evaluate the Harness Fluency maturity model
    Fluency(FluencyArgs),
}

#[derive(Args, Debug, Clone)]
pub struct FluencyArgs {
    /// Repository root to evaluate. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Override the fluency model YAML path.
    #[arg(long)]
    pub model: Option<String>,

    /// Override the persisted snapshot path.
    #[arg(long)]
    pub snapshot_path: Option<String>,

    /// Built-in model profile.
    #[arg(long, value_enum, default_value_t = FluencyProfile::Generic)]
    pub profile: FluencyProfile,

    /// Output format.
    #[arg(long, value_enum, default_value_t = FluencyOutputFormat::Text)]
    pub format: FluencyOutputFormat,

    /// Compare against the last saved snapshot.
    #[arg(long, default_value_t = false)]
    pub compare_last: bool,

    /// Do not persist the current snapshot.
    #[arg(long, default_value_t = false)]
    pub no_save: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum FluencyProfile {
    Generic,
    #[value(alias = "agent_orchestrator", alias = "orchestrator")]
    AgentOrchestrator,
}

impl FluencyProfile {
    fn as_cli_value(self) -> &'static str {
        match self {
            Self::Generic => "generic",
            Self::AgentOrchestrator => "agent_orchestrator",
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum FluencyOutputFormat {
    Text,
    Json,
}

impl FluencyOutputFormat {
    fn as_cli_value(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Json => "json",
        }
    }
}

pub fn run(action: FitnessAction) -> Result<(), String> {
    match action {
        FitnessAction::Fluency(args) => run_fluency(&args),
    }
}

fn run_fluency(args: &FluencyArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let tool_root = resolve_tool_root()?;
    let cli_path = tool_root.join(FITNESS_FLUENCY_CLI_RELATIVE_PATH);
    let forwarded_args = build_forwarded_args(args, &repo_root);

    let status = Command::new("node")
        .arg("--import")
        .arg("tsx")
        .arg(&cli_path)
        .args(forwarded_args)
        .current_dir(&tool_root)
        .env("PATH", routa_core::shell_env::full_path())
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => format!(
                "failed to launch harness fluency CLI at {}: {error}. Ensure Node.js is installed and `tsx` is available to `node --import`.",
                cli_path.display()
            ),
            _ => format!(
                "failed to launch harness fluency CLI at {}: {error}",
                cli_path.display()
            ),
        })?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "`node --import tsx {}` exited with {}",
            cli_path.display(),
            format_exit_status(status)
        ))
    }
}

fn build_forwarded_args(args: &FluencyArgs, repo_root: &Path) -> Vec<OsString> {
    let mut forwarded = vec![
        OsString::from("--repo-root"),
        repo_root.as_os_str().to_os_string(),
        OsString::from("--profile"),
        OsString::from(args.profile.as_cli_value()),
    ];

    if args.format != FluencyOutputFormat::Text {
        forwarded.push(OsString::from("--format"));
        forwarded.push(OsString::from(args.format.as_cli_value()));
    }

    if let Some(model) = &args.model {
        forwarded.push(OsString::from("--model"));
        forwarded.push(OsString::from(model));
    }

    if let Some(snapshot_path) = &args.snapshot_path {
        forwarded.push(OsString::from("--snapshot-path"));
        forwarded.push(OsString::from(snapshot_path));
    }

    if args.compare_last {
        forwarded.push(OsString::from("--compare-last"));
    }

    if args.no_save {
        forwarded.push(OsString::from("--no-save"));
    }

    forwarded
}

fn resolve_repo_root(requested: Option<&str>) -> Result<PathBuf, String> {
    let cwd =
        std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?;

    let repo_root = match requested {
        Some(path) => resolve_requested_repo_root(Path::new(path), &cwd),
        None => discover_git_toplevel(&cwd).unwrap_or(cwd),
    };

    validate_repo_root(repo_root)
}

fn resolve_requested_repo_root(requested: &Path, cwd: &Path) -> PathBuf {
    if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        cwd.join(requested)
    }
}

fn discover_git_toplevel(cwd: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return None;
    }

    Some(PathBuf::from(raw))
}

fn validate_repo_root(repo_root: PathBuf) -> Result<PathBuf, String> {
    if !repo_root.exists() {
        return Err(format!("repo root does not exist: {}", repo_root.display()));
    }

    if !repo_root.is_dir() {
        return Err(format!(
            "repo root is not a directory: {}",
            repo_root.display()
        ));
    }

    Ok(repo_root)
}

fn resolve_tool_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "failed to resolve workspace root from manifest directory {}",
                manifest_dir.display()
            )
        })?;

    let cli_path = workspace_root.join(FITNESS_FLUENCY_CLI_RELATIVE_PATH);
    if !cli_path.exists() {
        return Err(format!(
            "harness fluency CLI is missing at {}",
            cli_path.display()
        ));
    }

    Ok(workspace_root)
}

fn format_exit_status(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("exit code {code}"),
        None => "termination by signal".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_forwarded_args, discover_git_toplevel, resolve_requested_repo_root,
        resolve_tool_root, validate_repo_root, FluencyArgs, FluencyOutputFormat, FluencyProfile,
    };
    use std::fs::File;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn builds_forwarded_args_for_non_default_options() {
        let args = FluencyArgs {
            repo_root: Some("/tmp/repo".to_string()),
            model: Some("docs/custom.yaml".to_string()),
            snapshot_path: Some("reports/custom.json".to_string()),
            profile: FluencyProfile::AgentOrchestrator,
            format: FluencyOutputFormat::Json,
            compare_last: true,
            no_save: true,
        };

        let forwarded = build_forwarded_args(&args, Path::new("/tmp/repo"));
        let forwarded = forwarded
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            forwarded,
            vec![
                "--repo-root",
                "/tmp/repo",
                "--profile",
                "agent_orchestrator",
                "--format",
                "json",
                "--model",
                "docs/custom.yaml",
                "--snapshot-path",
                "reports/custom.json",
                "--compare-last",
                "--no-save",
            ]
        );
    }

    #[test]
    fn resolves_relative_repo_root_against_cwd() {
        let resolved =
            resolve_requested_repo_root(Path::new("../repo"), Path::new("/tmp/workspace"));
        assert_eq!(resolved, Path::new("/tmp/workspace").join("../repo"));
    }

    #[test]
    fn validate_repo_root_rejects_regular_files() {
        let temp_dir = tempdir().expect("temp dir");
        let file_path = temp_dir.path().join("repo.txt");
        File::create(&file_path).expect("file");

        let error = validate_repo_root(file_path).expect_err("expected validation failure");
        assert!(error.contains("not a directory"));
    }

    #[test]
    fn discover_git_toplevel_finds_workspace_root() {
        let top = discover_git_toplevel(Path::new(env!("CARGO_MANIFEST_DIR"))).expect("git root");
        assert!(top.join("AGENTS.md").exists());
    }

    #[test]
    fn resolve_tool_root_finds_harness_fluency_cli() {
        let tool_root = resolve_tool_root().expect("tool root");
        assert!(tool_root.join("tools/harness-fluency/src/cli.ts").exists());
    }
}
