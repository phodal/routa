//! `routa fitness` — repository fitness and fluency assessment entrypoints.

mod arch_dsl;
mod fluency;

use clap::{Args, Subcommand, ValueEnum};
use std::path::{Path, PathBuf};

use self::arch_dsl::{run as run_arch_dsl, ArchDslArgs};
use self::fluency::format_text_report;
pub use self::fluency::{
    evaluate_harness_fluency, CriterionStatus, EvaluateOptions, FluencyMode, HarnessFluencyReport,
    LevelChange, ReportFraming,
};

const DEFAULT_MODEL_RELATIVE_PATH: &str = "docs/fitness/harness-fluency.model.yaml";
const AGENT_ORCHESTRATOR_MODEL_RELATIVE_PATH: &str =
    "docs/fitness/harness-fluency.profile.agent_orchestrator.yaml";
const DEFAULT_SNAPSHOT_RELATIVE_PATH: &str = "docs/fitness/reports/harness-fluency-latest.json";

#[derive(Subcommand, Debug, Clone)]
pub enum FitnessAction {
    /// Validate the architecture-rule DSL and execute supported rule engines
    ArchDsl(ArchDslArgs),
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

    /// Execution mode. `hybrid` and `ai` currently prepare evidence packs for adjudication.
    #[arg(long, value_enum, default_value_t = FluencyRunMode::Deterministic)]
    pub mode: FluencyRunMode,

    /// Output format.
    #[arg(long, value_enum, default_value_t = FluencyOutputFormat::Text)]
    pub format: FluencyOutputFormat,

    /// Report framing vocabulary.
    #[arg(long, value_enum, default_value_t = FluencyFraming::Fluency)]
    pub framing: FluencyFraming,

    /// Shortcut for `--format json` kept for legacy harness-fluency compatibility.
    #[arg(long, default_value_t = false)]
    pub json: bool,

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

    fn bundled_model_relative_path(self) -> &'static str {
        match self {
            Self::Generic => DEFAULT_MODEL_RELATIVE_PATH,
            Self::AgentOrchestrator => AGENT_ORCHESTRATOR_MODEL_RELATIVE_PATH,
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum FluencyOutputFormat {
    Text,
    Json,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum FluencyRunMode {
    Deterministic,
    Hybrid,
    Ai,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum FluencyFraming {
    Fluency,
    Harnessability,
}

impl FluencyRunMode {
    fn into_fluency_mode(self) -> FluencyMode {
        match self {
            Self::Deterministic => FluencyMode::Deterministic,
            Self::Hybrid => FluencyMode::Hybrid,
            Self::Ai => FluencyMode::Ai,
        }
    }
}

impl FluencyFraming {
    fn into_report_framing(self) -> ReportFraming {
        match self {
            Self::Fluency => ReportFraming::Fluency,
            Self::Harnessability => ReportFraming::Harnessability,
        }
    }
}

pub fn run(action: FitnessAction) -> Result<(), String> {
    match action {
        FitnessAction::ArchDsl(args) => run_arch_dsl(&args),
        FitnessAction::Fluency(args) => run_fluency(&args),
    }
}

fn run_fluency(args: &FluencyArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let workspace_root = resolve_workspace_root()?;
    let model_path = resolve_model_path(args, &repo_root, &workspace_root)?;
    let snapshot_path = resolve_snapshot_path(args, &repo_root);

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root,
        model_path,
        profile: args.profile.as_cli_value().to_string(),
        mode: args.mode.into_fluency_mode(),
        framing: args.framing.into_report_framing(),
        snapshot_path,
        compare_last: args.compare_last,
        save: !args.no_save,
    })?;

    match resolved_output_format(args) {
        FluencyOutputFormat::Text => println!("{}", format_text_report(&report)),
        FluencyOutputFormat::Json => println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("failed to serialize fluency report: {error}"))?
        ),
    }

    Ok(())
}

fn resolved_output_format(args: &FluencyArgs) -> FluencyOutputFormat {
    if args.json {
        FluencyOutputFormat::Json
    } else {
        args.format
    }
}

fn resolve_model_path(
    args: &FluencyArgs,
    repo_root: &Path,
    workspace_root: &Path,
) -> Result<PathBuf, String> {
    if let Some(path) = &args.model {
        return Ok(resolve_requested_path(
            path,
            &std::env::current_dir().map_err(|error| {
                format!("failed to determine cwd for model resolution: {error}")
            })?,
        ));
    }

    let repo_candidate = repo_root.join(args.profile.bundled_model_relative_path());
    if repo_candidate.exists() {
        return Ok(repo_candidate);
    }

    let bundled = workspace_root.join(args.profile.bundled_model_relative_path());
    if bundled.exists() {
        return Ok(bundled);
    }

    Err(format!(
        "harness fluency model is missing for profile {}",
        args.profile.as_cli_value()
    ))
}

fn resolve_snapshot_path(args: &FluencyArgs, repo_root: &Path) -> PathBuf {
    match &args.snapshot_path {
        Some(path) => resolve_requested_path(
            path,
            &std::env::current_dir().unwrap_or_else(|_| repo_root.to_path_buf()),
        ),
        None => repo_root.join(profile_snapshot_filename(args.profile)),
    }
}

fn profile_snapshot_filename(profile: FluencyProfile) -> &'static str {
    match profile {
        FluencyProfile::Generic => DEFAULT_SNAPSHOT_RELATIVE_PATH,
        FluencyProfile::AgentOrchestrator => {
            "docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json"
        }
    }
}

fn resolve_repo_root(requested: Option<&str>) -> Result<PathBuf, String> {
    let cwd =
        std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?;

    let repo_root = match requested {
        Some(path) => resolve_requested_path(path, &cwd),
        None => discover_git_toplevel(&cwd).unwrap_or(cwd),
    };

    validate_repo_root(repo_root)
}

fn resolve_requested_path(requested: &str, cwd: &Path) -> PathBuf {
    let requested = Path::new(requested);
    if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        cwd.join(requested)
    }
}

fn discover_git_toplevel(cwd: &Path) -> Option<PathBuf> {
    let output = std::process::Command::new("git")
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

fn resolve_workspace_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "failed to resolve workspace root from manifest directory {}",
                manifest_dir.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{
        discover_git_toplevel, profile_snapshot_filename, resolve_requested_path,
        resolve_workspace_root, resolved_output_format, validate_repo_root, FitnessAction,
        FluencyArgs, FluencyFraming, FluencyMode, FluencyOutputFormat, FluencyProfile,
        FluencyRunMode, ReportFraming,
    };
    use clap::Parser;
    use std::fs::File;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn resolves_relative_repo_root_against_cwd() {
        let resolved = resolve_requested_path("../repo", Path::new("/tmp/workspace"));
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
    fn resolve_workspace_root_contains_bundled_fluency_model() {
        let workspace_root = resolve_workspace_root().expect("workspace root");
        assert!(workspace_root
            .join("docs/fitness/harness-fluency.model.yaml")
            .exists());
    }

    #[test]
    fn profile_snapshot_paths_are_stable() {
        assert_eq!(
            profile_snapshot_filename(FluencyProfile::Generic),
            "docs/fitness/reports/harness-fluency-latest.json"
        );
        assert_eq!(
            profile_snapshot_filename(FluencyProfile::AgentOrchestrator),
            "docs/fitness/reports/harness-fluency-agent-orchestrator-latest.json"
        );
    }

    #[test]
    fn json_shortcut_overrides_text_default() {
        let args = FluencyArgs {
            repo_root: None,
            model: None,
            snapshot_path: None,
            profile: FluencyProfile::Generic,
            mode: FluencyRunMode::Deterministic,
            format: FluencyOutputFormat::Text,
            framing: FluencyFraming::Fluency,
            json: true,
            compare_last: false,
            no_save: false,
        };

        assert_eq!(resolved_output_format(&args), FluencyOutputFormat::Json);
    }

    #[test]
    fn fluency_run_mode_maps_to_internal_mode() {
        assert_eq!(
            FluencyRunMode::Deterministic.into_fluency_mode(),
            FluencyMode::Deterministic
        );
        assert_eq!(
            FluencyRunMode::Hybrid.into_fluency_mode(),
            FluencyMode::Hybrid
        );
        assert_eq!(FluencyRunMode::Ai.into_fluency_mode(), FluencyMode::Ai);
    }

    #[test]
    fn fluency_framing_maps_to_report_framing() {
        assert_eq!(
            FluencyFraming::Fluency.into_report_framing(),
            ReportFraming::Fluency
        );
        assert_eq!(
            FluencyFraming::Harnessability.into_report_framing(),
            ReportFraming::Harnessability
        );
    }

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        action: FitnessAction,
    }

    #[test]
    fn parses_harnessability_framing_arg() {
        let cli = TestCli::parse_from(["routa", "fluency", "--framing", "harnessability"]);
        match cli.action {
            FitnessAction::Fluency(args) => {
                assert_eq!(args.framing, FluencyFraming::Harnessability);
            }
            FitnessAction::ArchDsl(_) => panic!("expected fluency subcommand"),
        }
    }
}
