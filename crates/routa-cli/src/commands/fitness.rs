//! `routa fitness` — repository fitness and fluency assessment entrypoints.

mod fluency;

use clap::{Args, Subcommand, ValueEnum};
use std::path::{Path, PathBuf};

use self::fluency::{evaluate_harness_fluency, format_text_report, EvaluateOptions, FluencyMode};
use routa_entrix::dashboard::{
    build_dashboard, compare_dashboards, dashboard_to_html, FitnessDashboard,
};
use routa_entrix::evidence::load_dimensions;
use routa_entrix::governance::{filter_dimensions, filter_metrics, GovernancePolicy};
use routa_entrix::runner::ShellRunner;
use routa_entrix::scoring::{score_dimension, score_report};

const DEFAULT_MODEL_RELATIVE_PATH: &str = "docs/fitness/harness-fluency.model.yaml";
const AGENT_ORCHESTRATOR_MODEL_RELATIVE_PATH: &str =
    "docs/fitness/harness-fluency.profile.agent_orchestrator.yaml";
const DEFAULT_SNAPSHOT_RELATIVE_PATH: &str = "docs/fitness/reports/harness-fluency-latest.json";
const DASHBOARD_SNAPSHOT_RELATIVE_PATH: &str = "docs/fitness/reports/dashboard-latest.json";

#[derive(Subcommand, Debug, Clone)]
pub enum FitnessAction {
    /// Evaluate the Harness Fluency maturity model
    Fluency(FluencyArgs),
    /// Generate a fitness function dashboard
    Dashboard(DashboardArgs),
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

#[derive(Args, Debug, Clone)]
pub struct DashboardArgs {
    /// Repository root to evaluate. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Output format.
    #[arg(long, value_enum, default_value_t = DashboardOutputFormat::Json)]
    pub format: DashboardOutputFormat,

    /// Output file path. Omit or use `-` for stdout.
    #[arg(long, short)]
    pub output: Option<String>,

    /// Compare against the last saved dashboard snapshot.
    #[arg(long, default_value_t = false)]
    pub compare_last: bool,

    /// Do not persist the current dashboard snapshot.
    #[arg(long, default_value_t = false)]
    pub no_save: bool,

    /// Dry run: load dimensions but do not execute metrics.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum DashboardOutputFormat {
    Json,
    Html,
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

impl FluencyRunMode {
    fn into_fluency_mode(self) -> FluencyMode {
        match self {
            Self::Deterministic => FluencyMode::Deterministic,
            Self::Hybrid => FluencyMode::Hybrid,
            Self::Ai => FluencyMode::Ai,
        }
    }
}

pub fn run(action: FitnessAction) -> Result<(), String> {
    match action {
        FitnessAction::Fluency(args) => run_fluency(&args),
        FitnessAction::Dashboard(args) => run_dashboard(&args),
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

fn run_dashboard(args: &DashboardArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let fitness_dir = repo_root.join("docs/fitness");

    if !fitness_dir.is_dir() {
        return Err(format!(
            "fitness directory not found: {}",
            fitness_dir.display()
        ));
    }

    let dimensions = load_dimensions(&fitness_dir);
    if dimensions.is_empty() {
        return Err("no fitness dimensions found in docs/fitness/".to_string());
    }

    let policy = GovernancePolicy {
        dry_run: args.dry_run,
        ..GovernancePolicy::default()
    };

    let filtered_dims = filter_dimensions(&dimensions, &policy);
    let runner = ShellRunner::new(&repo_root);

    let dimension_scores: Vec<_> = filtered_dims
        .iter()
        .map(|dim| {
            let metrics = filter_metrics(&dim.metrics, &policy);
            if metrics.is_empty() || args.dry_run {
                score_dimension(&[], &dim.name, dim.weight)
            } else {
                let results = runner.run_batch(&metrics, policy.parallel, false, None);
                score_dimension(&results, &dim.name, dim.weight)
            }
        })
        .collect();

    let report = score_report(&dimension_scores, policy.min_score);
    let mut dashboard = build_dashboard(&dimensions, &report, &repo_root.to_string_lossy());

    // Compare with previous snapshot
    let snapshot_path = repo_root.join(DASHBOARD_SNAPSHOT_RELATIVE_PATH);
    if args.compare_last {
        if let Ok(raw) = std::fs::read_to_string(&snapshot_path) {
            if let Ok(previous) = serde_json::from_str::<FitnessDashboard>(&raw) {
                dashboard.comparison = Some(compare_dashboards(&dashboard, &previous));
            }
        }
    }

    // Save current snapshot
    if !args.no_save {
        if let Some(parent) = snapshot_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json_str = serde_json::to_string_pretty(&dashboard)
            .map_err(|e| format!("failed to serialize dashboard: {e}"))?;
        std::fs::write(&snapshot_path, format!("{json_str}\n"))
            .map_err(|e| format!("failed to write dashboard snapshot: {e}"))?;
    }

    // Produce output
    let output_str = match args.format {
        DashboardOutputFormat::Json => serde_json::to_string_pretty(&dashboard)
            .map_err(|e| format!("failed to serialize dashboard: {e}"))?,
        DashboardOutputFormat::Html => dashboard_to_html(&dashboard),
    };

    match &args.output {
        Some(path) if path != "-" => {
            std::fs::write(path, &output_str)
                .map_err(|e| format!("failed to write dashboard output: {e}"))?;
            eprintln!("Dashboard written to {path}");
        }
        _ => println!("{output_str}"),
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
        resolve_workspace_root, resolved_output_format, validate_repo_root, FluencyArgs,
        FluencyMode, FluencyOutputFormat, FluencyProfile, FluencyRunMode,
    };
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
        assert_eq!(FluencyRunMode::Hybrid.into_fluency_mode(), FluencyMode::Hybrid);
        assert_eq!(FluencyRunMode::Ai.into_fluency_mode(), FluencyMode::Ai);
    }
}
