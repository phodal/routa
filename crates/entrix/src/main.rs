use clap::{Args, Parser, Subcommand};
use entrix::evidence::{load_dimensions, validate_weights};
use entrix::file_budgets::{evaluate_paths, is_tracked_source_file, load_config, resolve_paths};
use entrix::governance::{enforce, filter_dimensions, GovernancePolicy};
use entrix::long_file::{analyze_long_files, default_comment_review_commit_threshold};
use entrix::model::{EvidenceType, ExecutionScope, Tier};
use entrix::release_trigger::{
    evaluate_release_triggers, load_release_manifest, load_release_triggers,
};
use entrix::reporting::{report_to_dict, write_report_output};
use entrix::review_context::{
    analyze_file, analyze_history, analyze_impact, analyze_test_radius, build_graph,
    build_review_context, graph_stats, query_current_graph, ImpactOptions, ReviewBuildMode,
    ReviewContextOptions, TestRadiusOptions,
};
use entrix::review_trigger::{
    collect_changed_files, collect_diff_stats, evaluate_review_triggers, load_review_triggers,
};
use entrix::runner::ShellRunner;
use entrix::sarif::SarifRunner;
use entrix::scoring::{score_dimension, score_report};
use entrix::test_mapping;
use serde_json::json;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(name = "entrix")]
#[command(about = "Rust Entrix CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Run(RunArgs),
    Validate(ValidateArgs),
    Install(InstallArgs),
    Init(InstallArgs),
    Serve,
    Analyze(AnalyzeArgs),
    #[command(name = "release-trigger")]
    ReleaseTrigger(ReleaseTriggerArgs),
    #[command(name = "review-trigger")]
    ReviewTrigger(ReviewTriggerArgs),
    Hook(HookArgs),
    Graph(GraphArgs),
}

#[derive(Args, Debug)]
struct RunArgs {
    #[arg(value_name = "tier")]
    tier_positional: Option<String>,
    #[arg(long)]
    tier: Option<String>,
    #[arg(long)]
    parallel: bool,
    #[arg(long)]
    dry_run: bool,
    #[arg(long)]
    verbose: bool,
    #[arg(long, default_value = "failures")]
    stream: String,
    #[arg(long, default_value = "text")]
    format: String,
    #[arg(long, default_value_t = 4)]
    progress_refresh: usize,
    #[arg(long, default_value_t = 80.0)]
    min_score: f64,
    #[arg(long)]
    scope: Option<String>,
    #[arg(long)]
    changed_only: bool,
    #[arg(long)]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long = "dimension")]
    dimensions: Vec<String>,
    #[arg(long = "metric")]
    metrics: Vec<String>,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    output: Option<String>,
}

#[derive(Args, Debug)]
struct ValidateArgs {
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct InstallArgs {
    #[arg(long)]
    repo: Option<String>,
    #[arg(long)]
    dry_run: bool,
}

#[derive(Args, Debug)]
struct AnalyzeArgs {
    #[command(subcommand)]
    command: AnalyzeCommand,
}

#[derive(Subcommand, Debug)]
enum AnalyzeCommand {
    #[command(name = "long-file")]
    LongFile(AnalyzeLongFileArgs),
}

#[derive(Args, Debug)]
struct AnalyzeLongFileArgs {
    #[arg()]
    paths: Vec<String>,
    #[arg(long)]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long)]
    config: Option<String>,
    #[arg(long)]
    strict_limit: bool,
    #[arg(long, default_value_t = 60)]
    min_lines: usize,
    #[arg(long, default_value_t = default_comment_review_commit_threshold())]
    comment_review_commit_threshold: usize,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct ReviewTriggerArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD~1")]
    base: String,
    #[arg(long)]
    config: Option<String>,
    #[arg(long)]
    fail_on_trigger: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct ReleaseTriggerArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long)]
    manifest: String,
    #[arg(long)]
    baseline_manifest: Option<String>,
    #[arg(long, default_value = "HEAD~1")]
    base: String,
    #[arg(long)]
    config: Option<String>,
    #[arg(long)]
    fail_on_trigger: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphArgs {
    #[command(subcommand)]
    command: GraphCommand,
}

#[derive(Args, Debug)]
struct HookArgs {
    #[command(subcommand)]
    command: HookCommand,
}

#[derive(Subcommand, Debug)]
enum HookCommand {
    #[command(name = "file-length")]
    FileLength(HookFileLengthArgs),
}

#[derive(Args, Debug)]
struct HookFileLengthArgs {
    #[arg(long)]
    config: String,
    #[arg(long)]
    staged_only: bool,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long)]
    strict_limit: bool,
    #[arg(long)]
    changed_only: bool,
    #[arg(long)]
    overrides_only: bool,
    #[arg()]
    files: Vec<String>,
}

#[derive(Subcommand, Debug)]
enum GraphCommand {
    #[command(name = "build")]
    Build(GraphBuildArgs),
    #[command(name = "analyze-file")]
    AnalyzeFile(GraphAnalyzeFileArgs),
    #[command(name = "stats")]
    Stats,
    #[command(name = "impact")]
    Impact(GraphImpactArgs),
    #[command(name = "test-radius")]
    TestRadius(GraphTestRadiusArgs),
    #[command(name = "query")]
    Query(GraphQueryArgs),
    #[command(name = "history")]
    History(GraphHistoryArgs),
    #[command(name = "test-mapping")]
    TestMapping(GraphTestMappingArgs),
    #[command(name = "review-context")]
    ReviewContext(GraphReviewContextArgs),
}

#[derive(Args, Debug)]
struct GraphBuildArgs {
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphAnalyzeFileArgs {
    #[arg()]
    file: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphImpactArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value_t = 2)]
    depth: usize,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphTestRadiusArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value_t = 2)]
    depth: usize,
    #[arg(long, default_value_t = 25)]
    max_targets: usize,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphQueryArgs {
    #[arg()]
    pattern: String,
    #[arg()]
    target: String,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphHistoryArgs {
    #[arg(long, default_value_t = 10)]
    count: usize,
    #[arg(long = "ref", default_value = "HEAD")]
    git_ref: String,
    #[arg(long, default_value_t = 2)]
    depth: usize,
    #[arg(long, default_value_t = 25)]
    max_targets: usize,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphTestMappingArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    no_graph: bool,
    #[arg(long)]
    fail_on_missing: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphReviewContextArgs {
    #[arg()]
    files_positional: Vec<String>,
    #[arg(long)]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value = "HEAD")]
    head: String,
    #[arg(long, default_value_t = 2)]
    depth: usize,
    #[arg(long, default_value_t = 25)]
    max_targets: usize,
    #[arg(long, default_value_t = 12)]
    max_files: usize,
    #[arg(long, default_value_t = 120)]
    max_lines_per_file: usize,
    #[arg(long)]
    no_source: bool,
    #[arg(long, default_value = "auto")]
    build_mode: String,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    output: Option<String>,
}

fn main() {
    let cli = Cli::parse();
    let exit_code = match cli.command {
        Command::Run(args) => cmd_run(args),
        Command::Validate(args) => cmd_validate(args),
        Command::Install(args) | Command::Init(args) => cmd_install(args),
        Command::Serve => cmd_serve(),
        Command::Analyze(args) => match args.command {
            AnalyzeCommand::LongFile(args) => cmd_analyze_long_file(args),
        },
        Command::ReleaseTrigger(args) => cmd_release_trigger(args),
        Command::ReviewTrigger(args) => cmd_review_trigger(args),
        Command::Hook(args) => match args.command {
            HookCommand::FileLength(args) => cmd_hook_file_length(args),
        },
        Command::Graph(args) => match args.command {
            GraphCommand::Build(args) => cmd_graph_build(args),
            GraphCommand::AnalyzeFile(args) => cmd_graph_analyze_file(args),
            GraphCommand::Stats => cmd_graph_stats(),
            GraphCommand::Impact(args) => cmd_graph_impact(args),
            GraphCommand::TestRadius(args) => cmd_graph_test_radius(args),
            GraphCommand::Query(args) => cmd_graph_query(args),
            GraphCommand::History(args) => cmd_graph_history(args),
            GraphCommand::TestMapping(args) => cmd_graph_test_mapping(args),
            GraphCommand::ReviewContext(args) => cmd_graph_review_context(args),
        },
    };
    std::process::exit(exit_code);
}

fn cmd_run(args: RunArgs) -> i32 {
    let repo_root = find_project_root();
    let _ = (
        args.stream.as_str(),
        args.format.as_str(),
        args.progress_refresh,
    );
    let fitness_dir = repo_root.join("docs/fitness");
    let all_dimensions = load_dimensions(&fitness_dir);
    let changed_files = collect_run_files(&repo_root, &args);

    let policy = GovernancePolicy {
        tier_filter: args
            .tier
            .as_deref()
            .or(args.tier_positional.as_deref())
            .and_then(parse_tier),
        parallel: args.parallel,
        dry_run: args.dry_run,
        verbose: args.verbose,
        min_score: args.min_score,
        fail_on_hard_gate: true,
        execution_scope: args.scope.as_deref().and_then(parse_scope_filter),
        dimension_filters: args.dimensions,
        metric_filters: args.metrics,
    };

    let mut dimensions = filter_dimensions(&all_dimensions, &policy);
    if !changed_files.is_empty() {
        let changed_domains = domains_from_files(&changed_files);
        dimensions =
            filter_dimensions_for_incremental(&dimensions, &changed_files, &changed_domains);
    }
    if dimensions.is_empty() {
        eprintln!("No matching fitness dimensions or metrics found.");
        return 1;
    }

    let runner_env = build_runner_env(&changed_files, &args.base);
    let shell_runner = ShellRunner::new(&repo_root).with_env_overrides(runner_env.clone());
    let sarif_runner = SarifRunner::new(&repo_root).with_env_overrides(runner_env);
    let mut dimension_scores = Vec::new();

    for dimension in &dimensions {
        let results = dimension
            .metrics
            .iter()
            .map(|metric| match metric.evidence_type {
                EvidenceType::Sarif => sarif_runner.run(metric, policy.dry_run),
                _ => shell_runner.run(metric, policy.dry_run),
            })
            .collect::<Vec<_>>();
        let scored = score_dimension(&results, &dimension.name, dimension.weight);
        dimension_scores.push(scored);
    }

    let report = score_report(&dimension_scores, policy.min_score);
    let report_json = report_to_dict(&report);

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report_json).expect("serialize report")
        );
    } else {
        print_report_text(&report, policy.verbose);
    }

    if let Err(error) = write_report_output(args.output.as_deref(), &report_json) {
        eprintln!("Failed to write report: {error}");
        return 1;
    }

    enforce(&report, &policy)
}

fn collect_run_files(repo_root: &Path, args: &RunArgs) -> Vec<String> {
    if !args.files.is_empty() {
        return args.files.clone();
    }
    if !args.changed_only {
        return Vec::new();
    }

    let commands = [
        vec!["diff", "--name-only", "--diff-filter=ACMR", &args.base],
        vec!["diff", "--name-only", "--diff-filter=ACMR", "--cached"],
    ];
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();

    for command_args in commands {
        let output = std::process::Command::new("git")
            .args(command_args)
            .current_dir(repo_root)
            .output();
        let Ok(output) = output else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let path = line.trim();
            if path.is_empty() || should_ignore_changed_file(path) || !seen.insert(path.to_string())
            {
                continue;
            }
            files.push(path.to_string());
        }
    }

    files
}

fn should_ignore_changed_file(file_path: &str) -> bool {
    file_path.starts_with("tmp/")
        || file_path.starts_with("docs/")
        || file_path.starts_with(".entrix/")
        || file_path.starts_with(".code-review-graph/")
        || file_path.starts_with("node_modules/")
}

fn domains_from_files(files: &[String]) -> BTreeSet<String> {
    let config_files = BTreeSet::from([
        "package.json",
        "package-lock.json",
        "Cargo.toml",
        "Cargo.lock",
        "api-contract.yaml",
        "eslint.config.mjs",
        "tsconfig.json",
        "pyproject.toml",
        "docs/fitness/file_budgets.json",
    ]);

    let mut domains = BTreeSet::new();
    for file_path in files {
        let lowered = file_path.to_lowercase();
        let path = Path::new(file_path);
        let suffix = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();

        if suffix == "rs" || lowered.starts_with("crates/") {
            domains.insert("rust".to_string());
        }
        if matches!(suffix, "ts" | "tsx" | "js" | "jsx" | "css" | "scss")
            || lowered.starts_with("src/")
            || lowered.starts_with("apps/")
        {
            domains.insert("web".to_string());
        }
        if suffix == "py" {
            domains.insert("python".to_string());
        }
        if config_files.contains(file_path.as_str()) || config_files.contains(name) {
            domains.insert("config".to_string());
        }
    }
    domains
}

fn metric_domains(metric: &entrix::model::Metric) -> BTreeSet<String> {
    if !metric.scope.is_empty() {
        return metric.scope.iter().cloned().collect();
    }

    let command = metric.command.to_lowercase();
    let mut domains = BTreeSet::new();

    if command.contains("cargo ") || command.contains("clippy") || command.contains("rust") {
        domains.insert("rust".to_string());
    }
    if [
        "npm ",
        "npx ",
        "eslint",
        "vitest",
        "playwright",
        "jscpd",
        "dependency-cruiser",
        "ast-grep",
        " semgrep",
        "semgrep ",
    ]
    .iter()
    .any(|token| command.contains(token))
    {
        domains.insert("web".to_string());
    }
    if command.contains("python") || command.contains("pytest") || command.contains("entrix") {
        domains.insert("python".to_string());
    }
    if command.contains("audit") {
        domains.insert("config".to_string());
    }

    if domains.is_empty() {
        domains.insert("global".to_string());
    }
    domains
}

fn matches_changed_files(
    metric: &entrix::model::Metric,
    changed_files: &[String],
    domains: &BTreeSet<String>,
) -> bool {
    if !metric.run_when_changed.is_empty() {
        return changed_files.iter().any(|changed_file| {
            metric.run_when_changed.iter().any(|pattern| {
                glob::Pattern::new(pattern)
                    .map(|p| p.matches(changed_file))
                    .unwrap_or(false)
            })
        });
    }
    if domains.is_empty() {
        return false;
    }
    if domains.contains("config") {
        return true;
    }
    let metric_domains = metric_domains(metric);
    metric_domains.contains("global") || !metric_domains.is_disjoint(domains)
}

fn filter_dimensions_for_incremental(
    dimensions: &[entrix::model::Dimension],
    changed_files: &[String],
    domains: &BTreeSet<String>,
) -> Vec<entrix::model::Dimension> {
    if changed_files.is_empty() {
        return Vec::new();
    }
    if domains.contains("config") {
        return dimensions.to_vec();
    }

    dimensions
        .iter()
        .filter_map(|dimension| {
            let metrics = dimension
                .metrics
                .iter()
                .filter(|metric| matches_changed_files(metric, changed_files, domains))
                .cloned()
                .collect::<Vec<_>>();
            if metrics.is_empty() {
                return None;
            }
            Some(entrix::model::Dimension {
                name: dimension.name.clone(),
                weight: dimension.weight,
                threshold_pass: dimension.threshold_pass,
                threshold_warn: dimension.threshold_warn,
                metrics,
                source_file: dimension.source_file.clone(),
            })
        })
        .collect()
}

fn build_runner_env(
    changed_files: &[String],
    base: &str,
) -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    if !changed_files.is_empty() {
        env.insert("ROUTA_FITNESS_CHANGED_ONLY".to_string(), "1".to_string());
        env.insert("ROUTA_FITNESS_CHANGED_BASE".to_string(), base.to_string());
        env.insert(
            "ROUTA_FITNESS_CHANGED_FILES".to_string(),
            changed_files.join("\n"),
        );
    }
    env
}

fn cmd_validate(args: ValidateArgs) -> i32 {
    let repo_root = find_project_root();
    let fitness_dir = repo_root.join("docs/fitness");
    let dimensions = load_dimensions(&fitness_dir);
    let (weights_valid, total_weight) = validate_weights(&dimensions);

    let payload = json!({
        "valid": weights_valid,
        "total_weight": total_weight,
        "dimension_count": dimensions.len(),
        "dimensions": dimensions.iter().map(|dimension| {
            json!({
                "name": dimension.name,
                "weight": dimension.weight,
                "metrics": dimension.metrics.len(),
                "source_file": dimension.source_file,
            })
        }).collect::<Vec<_>>(),
    });

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&payload).expect("serialize validation report")
        );
    } else {
        println!(
            "Entrix validation: {}",
            if weights_valid { "PASS" } else { "FAIL" }
        );
        println!("Dimensions: {}", dimensions.len());
        println!("Total weight: {}", total_weight);
    }

    if weights_valid {
        0
    } else {
        1
    }
}

fn cmd_install(args: InstallArgs) -> i32 {
    let target = args
        .repo
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));
    let mcp_path = target.join(".mcp.json");
    let config = json!({
        "mcpServers": {
            "entrix": {
                "command": "uvx",
                "args": ["entrix", "serve"]
            }
        }
    });
    let config_text = format!(
        "{}\n",
        serde_json::to_string_pretty(&config).expect("serialize mcp config")
    );

    if args.dry_run {
        print!("{config_text}");
        return 0;
    }

    if let Err(error) = std::fs::write(&mcp_path, config_text) {
        eprintln!("failed to write {}: {error}", mcp_path.display());
        return 1;
    }
    println!("Wrote Claude MCP config to {}", mcp_path.display());
    println!("Run `entrix --help` to verify the command is available.");
    println!("Restart Claude Code after changing MCP settings.");
    0
}

fn cmd_serve() -> i32 {
    eprintln!("Rust entrix MCP server is not implemented yet. Use the Python entrix `serve` command for now.");
    1
}

fn cmd_analyze_long_file(args: AnalyzeLongFileArgs) -> i32 {
    let repo_root = find_project_root();
    let explicit_files = args
        .files
        .iter()
        .chain(args.paths.iter())
        .cloned()
        .collect::<Vec<_>>();
    let config_path = args.config.as_deref().map(Path::new);
    let report = analyze_long_files(
        &repo_root,
        if explicit_files.is_empty() {
            None
        } else {
            Some(explicit_files)
        },
        config_path,
        &args.base,
        !args.strict_limit,
        args.comment_review_commit_threshold,
    );

    if report.status == "unavailable" {
        eprintln!(
            "{}",
            report
                .summary
                .as_deref()
                .unwrap_or("Long-file analysis unavailable")
        );
        return 1;
    }

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("serialize long-file analysis")
        );
    } else {
        print_long_file_report(&report, args.min_lines);
    }

    0
}

fn cmd_release_trigger(args: ReleaseTriggerArgs) -> i32 {
    let repo_root = find_project_root();
    let config_path = args
        .config
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("docs/fitness/release-triggers.yaml"));
    let rules = match load_release_triggers(&config_path) {
        Ok(rules) => rules,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };

    let manifest_path = PathBuf::from(&args.manifest);
    let (manifest_label, artifacts) = match load_release_manifest(&manifest_path) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };

    let (baseline_manifest_label, baseline_artifacts) = match args.baseline_manifest.as_deref() {
        Some(path) => match load_release_manifest(Path::new(path)) {
            Ok(result) => (Some(result.0), result.1),
            Err(error) => {
                eprintln!("{error}");
                return 1;
            }
        },
        None => (None, Vec::new()),
    };

    let changed_files = if args.files.is_empty() {
        collect_git_diff_files(&repo_root, &args.base)
    } else {
        args.files.clone()
    };

    let report = evaluate_release_triggers(
        &rules,
        &artifacts,
        &manifest_label,
        &changed_files,
        &baseline_artifacts,
        baseline_manifest_label.as_deref(),
    );

    if args.json {
        print_json(&report);
    } else {
        print_release_trigger_report(&report);
    }

    if args.fail_on_trigger {
        if report.blocked {
            return 4;
        }
        if report.human_review_required {
            return 3;
        }
    }
    0
}

fn print_report_text(report: &entrix::model::FitnessReport, verbose: bool) {
    let status = if report.hard_gate_blocked || report.score_blocked {
        "FAIL"
    } else {
        "PASS"
    };

    println!("Entrix fitness: {status}");
    println!("Final score: {:.1}%", report.final_score);
    println!("Hard gate blocked: {}", report.hard_gate_blocked);
    println!("Score blocked: {}", report.score_blocked);

    for dimension in &report.dimensions {
        println!(
            "- {}: {:.1}% ({}/{})",
            dimension.dimension, dimension.score, dimension.passed, dimension.total
        );

        if verbose {
            for result in &dimension.results {
                println!(
                    "  {} [{}] {} ({:.0}ms)",
                    if result.passed { "PASS" } else { "FAIL" },
                    result.tier.as_str(),
                    result.metric_name,
                    result.duration_ms
                );
            }
        }
    }
}

fn print_long_file_report(report: &entrix::long_file::LongFileAnalysisReport, min_lines: usize) {
    if report.files.is_empty() {
        println!("No oversized or explicit files matched for long-file analysis.");
        return;
    }

    for file in &report.files {
        if file.line_count < min_lines {
            continue;
        }
        println!(
            "{} [{}] {} lines (budget {}, commits {})",
            file.file_path, file.language, file.line_count, file.budget_limit, file.commit_count
        );
        if !file.budget_reason.is_empty() {
            println!("  budget reason: {}", file.budget_reason);
        }
        for class in &file.classes {
            println!(
                "  class {} [{}-{}] methods={}",
                class.qualified_name, class.start_line, class.end_line, class.method_count
            );
        }
        for function in &file.functions {
            println!(
                "  {} {} [{}-{}] comments={} commits={}",
                function.kind,
                function.qualified_name,
                function.start_line,
                function.end_line,
                function.comment_count,
                function.commit_count
            );
        }
        for warning in &file.warnings {
            println!("  warning {}: {}", warning.code, warning.summary);
        }
    }
}

fn print_release_trigger_report(report: &entrix::release_trigger::ReleaseTriggerReport) {
    println!("Release trigger report");
    println!("- blocked: {}", if report.blocked { "yes" } else { "no" });
    println!(
        "- human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("- manifest: {}", report.manifest_path);
    if let Some(path) = &report.baseline_manifest_path {
        println!("- baseline manifest: {path}");
    }
    println!("- artifacts: {}", report.artifacts.len());
    println!("- changed files: {}", report.changed_files.len());
    if report.triggers.is_empty() {
        println!("- triggers: none");
        return;
    }
    println!("- triggers:");
    for trigger in &report.triggers {
        println!(
            "  - {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("    - {reason}");
        }
    }
}

fn parse_tier(value: &str) -> Option<Tier> {
    Tier::from_str_opt(value.trim())
}

fn parse_scope_filter(value: &str) -> Option<ExecutionScope> {
    match value.trim() {
        // Python Entrix examples and current workflows use `--scope ci` as a
        // compatibility flag without expecting local-default metrics to drop out.
        // Keep strict filtering only for non-default runtime scopes.
        "staging" => Some(ExecutionScope::Staging),
        "prod_observation" => Some(ExecutionScope::ProdObservation),
        _ => None,
    }
}

fn cmd_review_trigger(args: ReviewTriggerArgs) -> i32 {
    let repo_root = find_project_root();
    let config_path = args
        .config
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("docs/fitness/review-triggers.yaml"));
    let rules = match load_review_triggers(&config_path) {
        Ok(rules) => rules,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let changed_files = if args.files.is_empty() {
        collect_changed_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let diff_stats = collect_diff_stats(&repo_root, &args.base);
    let report = evaluate_review_triggers(
        &rules,
        &changed_files,
        &diff_stats,
        &args.base,
        Some(&repo_root),
    );

    if args.json {
        print_json(&report);
    } else {
        print_review_trigger_report(&report);
    }

    if report.human_review_required && args.fail_on_trigger {
        return 3;
    }
    0
}

fn cmd_graph_test_mapping(args: GraphTestMappingArgs) -> i32 {
    let repo_root = find_project_root();
    let changed_files = if args.files.is_empty() {
        collect_git_diff_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let report = test_mapping::analyze_changed_files(&repo_root, &changed_files);
    let graph_payload = if args.no_graph {
        json!({
            "available": false,
            "status": "disabled",
            "reason": "graph enrichment disabled by --no-graph"
        })
    } else {
        let radius = analyze_test_radius(
            &repo_root,
            &changed_files,
            TestRadiusOptions {
                base: &args.base,
                build_mode: parse_build_mode(&args.build_mode),
                max_depth: 2,
                max_targets: 25,
                max_impacted_files: 200,
            },
        );
        json!({
            "available": true,
            "status": radius.status,
            "test_files": radius.test_files,
            "untested_targets": radius.untested_targets,
            "query_failures": radius.query_failures,
            "wide_blast_radius": radius.wide_blast_radius,
        })
    };

    if args.json {
        let payload = json!({
            "changed_files": report.changed_files,
            "skipped_test_files": report.skipped_test_files,
            "mappings": report.mappings,
            "status_counts": report.status_counts,
            "resolver_counts": report.resolver_counts,
            "graph": graph_payload
        });
        print_json(&payload);
    } else {
        println!(
            "test mappings: {} source files, {} skipped test files",
            report.mappings.len(),
            report.skipped_test_files.len()
        );
    }

    if args.fail_on_missing && report.status_counts.get("missing").copied().unwrap_or(0) > 0 {
        return 2;
    }
    0
}

fn cmd_graph_impact(args: GraphImpactArgs) -> i32 {
    let repo_root = find_project_root();
    let files = if args.files.is_empty() {
        collect_git_diff_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let result = analyze_impact(
        &repo_root,
        &files,
        ImpactOptions {
            base: &args.base,
            build_mode: parse_build_mode(&args.build_mode),
            max_depth: args.depth,
            max_impacted_files: 200,
        },
    );

    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    0
}

fn cmd_graph_build(args: GraphBuildArgs) -> i32 {
    let repo_root = find_project_root();
    let result = build_graph(&repo_root, parse_build_mode(&args.build_mode));
    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    0
}

fn cmd_graph_analyze_file(args: GraphAnalyzeFileArgs) -> i32 {
    let repo_root = find_project_root();
    let result = analyze_file(&repo_root, &args.file);
    if args.json {
        print_json(&result);
    } else if let Some(summary) = result.summary.as_deref() {
        println!("{summary}");
    } else {
        println!(
            "{} ({})",
            result.file_path.as_deref().unwrap_or(&args.file),
            result.language.as_deref().unwrap_or("unknown")
        );
    }
    0
}

fn cmd_graph_stats() -> i32 {
    let repo_root = find_project_root();
    let result = graph_stats(&repo_root);
    print_json(&result);
    0
}

fn cmd_graph_test_radius(args: GraphTestRadiusArgs) -> i32 {
    let repo_root = find_project_root();
    let files = if args.files.is_empty() {
        collect_git_diff_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let result = analyze_test_radius(
        &repo_root,
        &files,
        TestRadiusOptions {
            base: &args.base,
            build_mode: parse_build_mode(&args.build_mode),
            max_depth: args.depth,
            max_targets: args.max_targets,
            max_impacted_files: 200,
        },
    );

    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    0
}

fn cmd_graph_query(args: GraphQueryArgs) -> i32 {
    let repo_root = find_project_root();
    let result = query_current_graph(
        &repo_root,
        &args.target,
        &args.pattern,
        parse_build_mode(&args.build_mode),
    );

    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    0
}

fn cmd_graph_history(args: GraphHistoryArgs) -> i32 {
    let repo_root = find_project_root();
    let result = analyze_history(
        &repo_root,
        args.count,
        &args.git_ref,
        parse_build_mode(&args.build_mode),
        args.depth,
        args.max_targets,
    );
    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    0
}

fn cmd_graph_review_context(args: GraphReviewContextArgs) -> i32 {
    let repo_root = find_project_root();
    let mut files = args.files_positional;
    files.extend(args.files);
    if files.is_empty() {
        files = collect_git_diff_files(&repo_root, &args.base);
    }
    let payload = build_review_context(
        &repo_root,
        &files,
        ReviewContextOptions {
            base: &args.base,
            include_source: !args.no_source,
            max_files: args.max_files,
            max_lines_per_file: args.max_lines_per_file,
            build_mode: parse_build_mode(&args.build_mode),
            max_depth: args.depth,
            max_targets: args.max_targets,
        },
    );

    if args.json {
        if let Some(output_path) = args.output {
            if output_path != "-" {
                if let Err(error) = std::fs::write(
                    &output_path,
                    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
                        + "\n",
                ) {
                    eprintln!("failed to write {output_path}: {error}");
                    return 1;
                }
                return 0;
            }
        }
        print_json(&payload);
    } else {
        println!("{}", payload.summary);
    }

    0
}

fn parse_build_mode(value: &str) -> ReviewBuildMode {
    match value {
        "skip" => ReviewBuildMode::Skip,
        "full" => ReviewBuildMode::Full,
        _ => ReviewBuildMode::Auto,
    }
}

fn cmd_hook_file_length(args: HookFileLengthArgs) -> i32 {
    let repo_root = find_project_root();
    let config = match load_config(Path::new(&args.config)) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let relative_paths = match resolve_paths(
        &repo_root,
        &config,
        &args.files,
        args.changed_only,
        args.staged_only,
        &args.base,
        args.overrides_only,
    ) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let violations = evaluate_paths(&repo_root, &relative_paths, &config, !args.strict_limit);
    let checked_count = relative_paths
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|path| is_tracked_source_file(path, &config))
        .count();

    println!("file_budget_checked: {checked_count}");
    println!("file_budget_violations: {}", violations.len());
    for violation in &violations {
        let reason = if violation.reason.is_empty() {
            String::new()
        } else {
            format!(" | {}", violation.reason)
        };
        println!(
            "current file length {} exceeds limit {}: {}{}",
            violation.line_count, violation.max_lines, violation.path, reason
        );
    }

    if violations.is_empty() {
        0
    } else {
        1
    }
}

fn find_project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in std::iter::once(cwd.as_path()).chain(cwd.ancestors().skip(1)) {
        if candidate.join("Cargo.toml").exists() || candidate.join("package.json").exists() {
            return candidate.to_path_buf();
        }
    }
    cwd
}

fn collect_git_diff_files(repo_root: &Path, base: &str) -> Vec<String> {
    let output = std::process::Command::new("git")
        .args(["diff", "--name-only", "--diff-filter=ACMR", base])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("failed to serialize json output: {error}");
        }
    }
}

fn print_review_trigger_report(report: &entrix::review_trigger::ReviewTriggerReport) {
    println!(
        "human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("base: {}", report.base);
    println!("changed files: {}", report.changed_files.len());
    println!("triggers: {}", report.triggers.len());
    for trigger in &report.triggers {
        println!(
            "- {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("  - {reason}");
        }
    }
}
