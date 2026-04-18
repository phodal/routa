mod engineering;

use clap::{Args, Subcommand, ValueEnum};
use routa_core::harness::detect_repo_signals;
use routa_core::harness_template;
use serde_json::json;
use std::path::{Path, PathBuf};

use self::engineering::{
    evaluate_harness_engineering, format_harness_engineering_report,
    persist_harness_engineering_report, HarnessEngineeringOptions, DEFAULT_REPORT_RELATIVE_PATH,
};

#[derive(Subcommand, Debug, Clone)]
pub enum HarnessAction {
    /// Detect build/test harness surfaces from docs/harness/*.yml
    Detect(HarnessDetectArgs),
    /// Evaluate harness engineering readiness and emit dry-run evolution guidance
    Evolve(HarnessEvolveArgs),
    /// Manage harness templates
    Template {
        #[command(subcommand)]
        action: TemplateAction,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum TemplateAction {
    /// List available harness templates
    List(TemplateCommonArgs),
    /// Validate a specific template against the workspace
    Validate(TemplateValidateArgs),
    /// Run drift checks across all templates
    Doctor(TemplateCommonArgs),
}

#[derive(Args, Debug, Clone)]
pub struct TemplateCommonArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Output format.
    #[arg(long, value_enum, default_value_t = HarnessOutputFormat::Json)]
    pub format: HarnessOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct TemplateValidateArgs {
    /// Template id to validate.
    pub template_id: String,

    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Output format.
    #[arg(long, value_enum, default_value_t = HarnessOutputFormat::Json)]
    pub format: HarnessOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct HarnessDetectArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Which harness surface to print.
    #[arg(long, value_enum, default_value_t = HarnessSurfaceSelector::All)]
    pub surface: HarnessSurfaceSelector,

    /// Output format.
    #[arg(long, value_enum, default_value_t = HarnessOutputFormat::Json)]
    pub format: HarnessOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct HarnessEvolveArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Explicit no-op flag kept for dry-run-first evolution workflows.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,

    /// Bootstrap mode: synthesize initial harness surfaces for weak repositories.
    #[arg(long, default_value_t = false)]
    pub bootstrap: bool,

    /// Apply low-risk patches automatically (requires confirmation for medium/high risk).
    #[arg(long, default_value_t = false)]
    pub apply: bool,

    /// Skip confirmation prompts for medium/high-risk patches (dangerous, use with caution).
    #[arg(long, default_value_t = false)]
    pub force: bool,

    /// Generate playbooks from evolution history (trace learning mode).
    #[arg(long, default_value_t = false)]
    pub learn: bool,

    /// Run a single dry-run fitness speed experiment via harness-autoresearch.sh (experimental).
    #[arg(long, default_value_t = false)]
    pub speed_profile: bool,

    /// Use AI specialist for contextual recommendations (experimental).
    #[arg(long, default_value_t = false)]
    pub ai: bool,

    /// Workspace ID used when invoking the AI specialist.
    #[arg(long, default_value = "default")]
    pub workspace_id: String,

    /// ACP provider override for the AI specialist.
    #[arg(long)]
    pub provider: Option<String>,

    /// Timeout in milliseconds for AI specialist provider initialization.
    #[arg(long)]
    pub provider_timeout_ms: Option<u64>,

    /// Extra retries for AI specialist provider session initialization.
    #[arg(long, default_value_t = 0)]
    pub provider_retries: u8,

    /// Override the persisted report path.
    #[arg(long)]
    pub output: Option<String>,

    /// Do not persist the structured report snapshot.
    #[arg(long, default_value_t = false)]
    pub no_save: bool,

    /// Output format.
    #[arg(long, value_enum, default_value_t = HarnessOutputFormat::Json)]
    pub format: HarnessOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum HarnessSurfaceSelector {
    All,
    Build,
    Test,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum HarnessOutputFormat {
    Text,
    Json,
}

pub async fn run(db_path: &str, action: HarnessAction) -> Result<(), String> {
    match action {
        HarnessAction::Detect(args) => run_detect(&args),
        HarnessAction::Evolve(args) => run_evolve(db_path, &args).await,
        HarnessAction::Template { action } => run_template(action),
    }
}

fn run_template(action: TemplateAction) -> Result<(), String> {
    match action {
        TemplateAction::List(args) => run_template_list(&args),
        TemplateAction::Validate(args) => run_template_validate(&args),
        TemplateAction::Doctor(args) => run_template_doctor(&args),
    }
}

fn run_template_list(args: &TemplateCommonArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let report = harness_template::list_templates(&repo_root)?;
    let format = resolve_common_format(args);

    match format {
        HarnessOutputFormat::Json => {
            let value = serde_json::to_value(&report)
                .map_err(|e| format!("failed to serialize template list: {e}"))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|e| format!("failed to serialize template list: {e}"))?
            );
        }
        HarnessOutputFormat::Text => {
            println!("repo: {}", report.repo_root);
            println!("templates: {}", report.templates.len());
            for t in &report.templates {
                println!();
                println!("  {} ({})", t.id, t.app_type);
                println!("    name: {}", t.name);
                if let Some(version) = &t.version {
                    println!("    version: {version}");
                }
                if let Some(desc) = &t.description {
                    println!("    description: {desc}");
                }
                println!("    runtimes: {}", t.runtimes.join(", "));
                println!("    config: {}", t.config_path);
            }
            if !report.warnings.is_empty() {
                println!();
                println!("warnings:");
                for w in &report.warnings {
                    println!("  - {w}");
                }
            }
        }
    }

    Ok(())
}

fn run_template_validate(args: &TemplateValidateArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let report = harness_template::validate_template(&repo_root, &args.template_id)?;
    let format = if args.json {
        HarnessOutputFormat::Json
    } else {
        args.format
    };

    match format {
        HarnessOutputFormat::Json => {
            let value = serde_json::to_value(&report)
                .map_err(|e| format!("failed to serialize validation report: {e}"))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|e| format!("failed to serialize validation report: {e}"))?
            );
        }
        HarnessOutputFormat::Text => {
            print_validation_report(&report);
        }
    }

    Ok(())
}

fn run_template_doctor(args: &TemplateCommonArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let report = harness_template::doctor(&repo_root)?;
    let format = resolve_common_format(args);

    match format {
        HarnessOutputFormat::Json => {
            let value = serde_json::to_value(&report)
                .map_err(|e| format!("failed to serialize doctor report: {e}"))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|e| format!("failed to serialize doctor report: {e}"))?
            );
        }
        HarnessOutputFormat::Text => {
            println!("repo: {}", report.repo_root);
            println!("templates checked: {}", report.template_reports.len());
            for r in &report.template_reports {
                println!();
                print_validation_report(r);
            }
            if !report.warnings.is_empty() {
                println!();
                println!("warnings:");
                for w in &report.warnings {
                    println!("  - {w}");
                }
            }
        }
    }

    Ok(())
}

fn resolve_common_format(args: &TemplateCommonArgs) -> HarnessOutputFormat {
    if args.json {
        HarnessOutputFormat::Json
    } else {
        args.format
    }
}

fn print_validation_report(report: &harness_template::TemplateValidationReport) {
    println!("template: {} ({})", report.template_id, report.app_type);
    println!("  name: {}", report.template_name);
    if let Some(version) = &report.template_version {
        println!("  version: {version}");
    }
    println!("  drift: {:?}", report.overall_drift);

    if !report.guides.is_empty() {
        println!("  guides:");
        for g in &report.guides {
            let status = if g.present { "OK" } else { "MISSING" };
            let req = if g.required {
                "required"
            } else {
                "recommended"
            };
            println!("    [{status}] {} ({req})", g.path);
        }
    }

    if !report.boundaries.is_empty() {
        println!("  boundaries:");
        for boundary in &report.boundaries {
            let status = if boundary.present { "OK" } else { "MISSING" };
            println!("    [{status}] {} ({})", boundary.path, boundary.role);
        }
    }

    if !report.sensor_files.is_empty() {
        println!("  sensors:");
        for s in &report.sensor_files {
            let status = if s.present { "OK" } else { "MISSING" };
            println!("    [{status}] {} ({})", s.path, s.role);
        }
    }

    if let Some(automation_ref) = &report.automation_ref {
        let status = if automation_ref.present {
            "OK"
        } else {
            "MISSING"
        };
        println!("  automations:");
        println!("    [{status}] {}", automation_ref.path);
    }

    if !report.lifecycle_tiers.is_empty() {
        println!("  lifecycle:");
        for t in &report.lifecycle_tiers {
            println!(
                "    {} — {} gates{}",
                t.tier,
                t.gate_count,
                t.column_gate
                    .as_ref()
                    .map(|c| format!(" → {c}"))
                    .unwrap_or_default()
            );
        }
    }

    if let Some(drift_policy) = &report.drift_policy {
        let strategy = drift_policy.strategy.as_deref().unwrap_or("unspecified");
        let notify_on = if drift_policy.notify_on.is_empty() {
            "none".to_string()
        } else {
            drift_policy.notify_on.join(", ")
        };
        println!("  drift policy:");
        println!("    strategy: {strategy}");
        println!("    notify_on: {notify_on}");
    }

    if !report.drift_findings.is_empty() {
        println!("  drift findings:");
        for f in &report.drift_findings {
            println!("    [{:?}] {}: {}", f.level, f.kind, f.message);
        }
    }

    if !report.warnings.is_empty() {
        println!("  warnings:");
        for warning in &report.warnings {
            println!("    - {warning}");
        }
    }
}

fn run_detect(args: &HarnessDetectArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let report = detect_repo_signals(&repo_root)?;

    match resolved_output_format(args) {
        HarnessOutputFormat::Json => {
            let value = match args.surface {
                HarnessSurfaceSelector::All => serde_json::to_value(&report)
                    .map_err(|error| format!("failed to serialize harness report: {error}"))?,
                HarnessSurfaceSelector::Build => json!({
                    "generatedAt": report.generated_at,
                    "repoRoot": report.repo_root,
                    "packageManager": report.package_manager,
                    "lockfiles": report.lockfiles,
                    "surface": report.build,
                    "warnings": report.warnings,
                }),
                HarnessSurfaceSelector::Test => json!({
                    "generatedAt": report.generated_at,
                    "repoRoot": report.repo_root,
                    "packageManager": report.package_manager,
                    "lockfiles": report.lockfiles,
                    "surface": report.test,
                    "warnings": report.warnings,
                }),
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|error| format!("failed to serialize harness report: {error}"))?
            );
        }
        HarnessOutputFormat::Text => print_text_report(&report, args.surface),
    }

    Ok(())
}

async fn run_evolve(db_path: &str, args: &HarnessEvolveArgs) -> Result<(), String> {
    let repo_root = resolve_any_repo_root(args.repo_root.as_deref())?;
    let output_format = resolved_evolve_output_format(args);
    let apply = args.apply && !args.dry_run;
    let output_path = resolve_requested_path(
        args.output
            .as_deref()
            .unwrap_or(DEFAULT_REPORT_RELATIVE_PATH),
        &repo_root,
    );
    let state = if args.ai {
        Some(crate::commands::init_state(db_path).await)
    } else {
        None
    };

    let report = evaluate_harness_engineering(
        &repo_root,
        &HarnessEngineeringOptions {
            output_path: output_path.clone(),
            dry_run: args.dry_run || !apply,
            bootstrap: args.bootstrap,
            apply,
            force: args.force,
            json_output: matches!(output_format, HarnessOutputFormat::Json),
            use_ai_specialist: args.ai,
            ai_workspace_id: args.workspace_id.clone(),
            ai_provider: args.provider.clone(),
            ai_provider_timeout_ms: args.provider_timeout_ms,
            ai_provider_retries: args.provider_retries,
            learn: args.learn,
            speed_profile: args.speed_profile,
        },
        state.as_ref(),
    )
    .await?;

    if !args.no_save {
        persist_harness_engineering_report(&report, &output_path)?;
    }

    match output_format {
        HarnessOutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).map_err(|error| {
                    format!("failed to serialize harness engineering report: {error}")
                })?
            );
        }
        HarnessOutputFormat::Text => println!("{}", format_harness_engineering_report(&report)),
    }

    Ok(())
}

fn resolved_output_format(args: &HarnessDetectArgs) -> HarnessOutputFormat {
    if args.json {
        HarnessOutputFormat::Json
    } else {
        args.format
    }
}

fn resolved_evolve_output_format(args: &HarnessEvolveArgs) -> HarnessOutputFormat {
    if args.json {
        HarnessOutputFormat::Json
    } else {
        args.format
    }
}

fn print_text_report(
    report: &routa_core::harness::HarnessRepoSignalsReport,
    surface: HarnessSurfaceSelector,
) {
    println!("repo: {}", report.repo_root);
    if let Some(package_manager) = &report.package_manager {
        println!("packageManager: {package_manager}");
    }
    if !report.lockfiles.is_empty() {
        println!("lockfiles: {}", report.lockfiles.join(", "));
    }

    match surface {
        HarnessSurfaceSelector::All => {
            print_surface("build", &report.build);
            print_surface("test", &report.test);
        }
        HarnessSurfaceSelector::Build => print_surface("build", &report.build),
        HarnessSurfaceSelector::Test => print_surface("test", &report.test),
    }

    if !report.warnings.is_empty() {
        println!("warnings:");
        for warning in &report.warnings {
            println!("  - {warning}");
        }
    }
}

fn print_surface(name: &str, surface: &routa_core::harness::HarnessSurfaceSignals) {
    println!();
    println!("{name}: {}", surface.title);
    println!("  summary: {}", surface.summary);
    println!("  config: {}", surface.config_path);
    for row in &surface.overview_rows {
        println!("  {}: {}", row.label, row.items.join(", "));
    }
    for group in &surface.entrypoint_groups {
        let primary = group
            .scripts
            .first()
            .map(|script| script.name.as_str())
            .unwrap_or("—");
        println!("  {} -> {}", group.label, primary);
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

fn resolve_any_repo_root(requested: Option<&str>) -> Result<PathBuf, String> {
    let cwd =
        std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?;

    let repo_root = match requested {
        Some(path) => resolve_requested_path(path, &cwd),
        None => discover_git_toplevel(&cwd).unwrap_or(cwd),
    };

    if !repo_root.exists() || !repo_root.is_dir() {
        return Err(format!(
            "repository root does not exist or is not a directory: {}",
            repo_root.display()
        ));
    }

    Ok(repo_root)
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
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

fn validate_repo_root(repo_root: PathBuf) -> Result<PathBuf, String> {
    if !repo_root.exists() || !repo_root.is_dir() {
        return Err(format!(
            "repository root does not exist or is not a directory: {}",
            repo_root.display()
        ));
    }
    if !repo_root
        .join("docs/fitness/harness-fluency.model.yaml")
        .exists()
        || !repo_root.join("crates/routa-cli").exists()
    {
        return Err(format!(
            "repository root is not a Routa workspace: {}",
            repo_root.display()
        ));
    }
    Ok(repo_root)
}
