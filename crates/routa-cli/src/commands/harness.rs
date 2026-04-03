use clap::{Args, Subcommand, ValueEnum};
use routa_core::harness::detect_repo_signals;
use routa_core::harness_template;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug, Clone)]
pub enum HarnessAction {
    /// Detect build/test harness surfaces from docs/harness/*.yml
    Detect(HarnessDetectArgs),
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

pub fn run(action: HarnessAction) -> Result<(), String> {
    match action {
        HarnessAction::Detect(args) => run_detect(&args),
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

fn resolved_output_format(args: &HarnessDetectArgs) -> HarnessOutputFormat {
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
