use crate::cli_output::{
    print_graph_history, print_graph_impact, print_graph_query, print_graph_review_context,
    print_graph_test_radius, print_hook_long_file_summary, print_json, print_long_file_report,
    print_release_trigger_report, print_report_text, print_review_trigger_report,
};
use crate::cli_runtime::{
    build_runner_env, build_runtime_fitness_snapshot, collect_run_files, domains_from_files,
    emit_runtime_fitness_event, filter_dimensions_for_incremental, now_millis, runtime_mode,
    write_runtime_fitness_artifacts, RuntimeFitnessEventOptions, RuntimeFitnessSnapshotOptions,
};
use clap::{Args, CommandFactory, Parser, Subcommand};
use entrix::evidence::{load_dimensions, validate_weights};
use entrix::file_budgets::{evaluate_paths, is_tracked_source_file, load_config, resolve_paths};
use entrix::governance::{enforce, filter_dimensions, GovernancePolicy};
use entrix::long_file::{analyze_long_files, default_comment_review_commit_threshold};
use entrix::model::{ExecutionScope, FitnessReport, Tier};
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
use entrix::run_support::{run_metric_batch, RunMetricBatchOptions};
use entrix::runner::{OutputCallback, ProgressCallback, ShellRunner};
use entrix::sarif::SarifRunner;
use entrix::scoring::{score_dimension, score_report};
use entrix::server;
use entrix::terminal::{
    AsciiReporter, RichLiveProgressReporter, RichReporter, ShellOutputController, StreamMode,
    TerminalReporter,
};
use entrix::test_mapping;
use serde_json::json;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

mod cli_output;
#[cfg(test)]
mod cli_parity_tests;
mod cli_runtime;

#[derive(Parser, Debug)]
#[command(name = "entrix")]
#[command(about = "Evolutionary architecture fitness engine for change-aware verification")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
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
    #[arg(long, default_value = "failures", num_args = 0..=1, default_missing_value = "all")]
    stream: String,
    #[arg(long, default_value = "text", value_parser = ["text", "ascii", "rich"])]
    format: String,
    #[arg(long, default_value_t = 4)]
    progress_refresh: usize,
    #[arg(long, default_value_t = 80.0)]
    min_score: f64,
    #[arg(long)]
    scope: Option<String>,
    #[arg(long)]
    changed_only: bool,
    #[arg(long, num_args = 1..)]
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
    command: Option<AnalyzeCommand>,
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
    fail_on_block: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphArgs {
    #[command(subcommand)]
    command: Option<GraphCommand>,
}

#[derive(Args, Debug)]
struct HookArgs {
    #[command(subcommand)]
    command: Option<HookCommand>,
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
    Stats(GraphStatsArgs),
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
struct GraphStatsArgs {
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
        None => {
            let mut cmd = Cli::command();
            let _ = cmd.print_help();
            println!();
            0
        }
        Some(Command::Run(args)) => cmd_run(args),
        Some(Command::Validate(args)) => cmd_validate(args),
        Some(Command::Install(args)) | Some(Command::Init(args)) => cmd_install(args),
        Some(Command::Serve) => cmd_serve(),
        Some(Command::Analyze(args)) => match args.command {
            Some(AnalyzeCommand::LongFile(args)) => cmd_analyze_long_file(args),
            None => {
                print_subcommand_help("analyze");
                0
            }
        },
        Some(Command::ReleaseTrigger(args)) => cmd_release_trigger(args),
        Some(Command::ReviewTrigger(args)) => cmd_review_trigger(args),
        Some(Command::Hook(args)) => match args.command {
            Some(HookCommand::FileLength(args)) => cmd_hook_file_length(args),
            None => {
                print_subcommand_help("hook");
                0
            }
        },
        Some(Command::Graph(args)) => match args.command {
            Some(GraphCommand::Build(args)) => cmd_graph_build(args),
            Some(GraphCommand::AnalyzeFile(args)) => cmd_graph_analyze_file(args),
            Some(GraphCommand::Stats(args)) => cmd_graph_stats(args),
            Some(GraphCommand::Impact(args)) => cmd_graph_impact(args),
            Some(GraphCommand::TestRadius(args)) => cmd_graph_test_radius(args),
            Some(GraphCommand::Query(args)) => cmd_graph_query(args),
            Some(GraphCommand::History(args)) => cmd_graph_history(args),
            Some(GraphCommand::TestMapping(args)) => cmd_graph_test_mapping(args),
            Some(GraphCommand::ReviewContext(args)) => cmd_graph_review_context(args),
            None => {
                print_subcommand_help("graph");
                0
            }
        },
    };
    std::process::exit(exit_code);
}

fn print_subcommand_help(name: &str) {
    let mut cmd = Cli::command();
    if let Some(subcommand) = cmd.find_subcommand_mut(name) {
        let _ = subcommand
            .clone()
            .bin_name(format!("entrix {name}"))
            .print_help();
        println!();
    }
}

fn cmd_run(args: RunArgs) -> i32 {
    let repo_root = find_project_root();
    let fitness_dir = repo_root.join("docs/fitness");
    let all_dimensions = load_dimensions(&fitness_dir);
    let changed_files = collect_run_files(&repo_root, &args.files, args.changed_only, &args.base);
    let stream_mode = StreamMode::parse(&args.stream);
    let show_tier = args.tier.is_none() && args.tier_positional.is_none();

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
        execution_scope: args
            .scope
            .as_deref()
            .and_then(parse_scope_filter)
            .or(Some(ExecutionScope::Local)),
        dimension_filters: args.dimensions,
        metric_filters: args.metrics,
    };

    let mut dimensions = filter_dimensions(&all_dimensions, &policy);
    if !changed_files.is_empty() {
        let changed_domains = domains_from_files(&changed_files);
        dimensions =
            filter_dimensions_for_incremental(&dimensions, &changed_files, &changed_domains);
    }
    if args.changed_only && changed_files.is_empty() {
        println!("No changed files detected; skipping fitness run.");
        let empty_report = FitnessReport::default();
        let report_json = report_to_dict(&empty_report);
        if let Err(error) = write_report_output(args.output.as_deref(), &report_json) {
            eprintln!("Failed to write report: {error}");
            return 1;
        }
        if let Err(error) = emit_runtime_fitness_event(
            &repo_root,
            "skipped",
            args.tier.as_deref().or(args.tier_positional.as_deref()),
            None,
            RuntimeFitnessEventOptions {
                metric_count: 0,
                duration_ms: 0.0,
                artifact_path: None,
                write_mailbox_message: true,
            },
        ) {
            eprintln!("Failed to emit runtime fitness event: {error}");
            return 1;
        }
        return 0;
    }
    if dimensions.is_empty() {
        println!("No metrics matched the current run filters; skipping fitness run.");
        let empty_report = FitnessReport::default();
        let report_json = report_to_dict(&empty_report);
        if let Err(error) = write_report_output(args.output.as_deref(), &report_json) {
            eprintln!("Failed to write report: {error}");
            return 1;
        }
        if let Err(error) = emit_runtime_fitness_event(
            &repo_root,
            "skipped",
            args.tier.as_deref().or(args.tier_positional.as_deref()),
            None,
            RuntimeFitnessEventOptions {
                metric_count: 0,
                duration_ms: 0.0,
                artifact_path: None,
                write_mailbox_message: true,
            },
        ) {
            eprintln!("Failed to emit runtime fitness event: {error}");
            return 1;
        }
        return 0;
    }

    let runner_env = build_runner_env(&changed_files, &args.base);
    let reporter = (!args.json && args.format == "text")
        .then(|| Arc::new(TerminalReporter::new(args.verbose, stream_mode)));
    let live_reporter = (!args.json && args.format == "rich")
        .then(|| Arc::new(RichLiveProgressReporter::new(18, args.progress_refresh)));
    if let Some(reporter) = &reporter {
        reporter.print_header(
            policy.dry_run,
            args.tier.as_deref().or(args.tier_positional.as_deref()),
            policy.parallel,
        );
    }
    if let Some(live_reporter) = &live_reporter {
        let metrics = dimensions
            .iter()
            .flat_map(|dimension| dimension.metrics.iter().cloned())
            .collect::<Vec<_>>();
        live_reporter.setup(&metrics);
    }

    let output_controller = reporter
        .as_ref()
        .map(|reporter| Arc::new(ShellOutputController::new(Arc::clone(reporter))));

    let progress_callback: Option<ProgressCallback> = if let Some(live_reporter) = &live_reporter {
        let live_reporter = Arc::clone(live_reporter);
        Some(Box::new(
            move |event: &str,
                  metric: &entrix::model::Metric,
                  result: Option<&entrix::model::MetricResult>| {
                live_reporter.handle_progress(event, metric, result);
            },
        ) as ProgressCallback)
    } else {
        output_controller.as_ref().map(|controller| {
            let controller = Arc::clone(controller);
            Box::new(
                move |event: &str,
                      metric: &entrix::model::Metric,
                      result: Option<&entrix::model::MetricResult>| {
                    controller.handle_progress(event, metric, result);
                },
            ) as ProgressCallback
        })
    };
    let output_callback: Option<OutputCallback> =
        output_controller.as_ref().and_then(|controller| {
            if !controller.should_capture_output() {
                return None;
            }
            Some(Arc::new({
                let controller = Arc::clone(controller);
                move |metric: &entrix::model::Metric, source: &str, line: &str| {
                    controller.handle_output(metric, source, line);
                }
            }) as OutputCallback)
        });

    let mut shell_runner = ShellRunner::new(&repo_root).with_env_overrides(runner_env.clone());
    if let Some(callback) = output_callback {
        shell_runner = shell_runner.with_output_callback(callback);
    }
    let sarif_runner = SarifRunner::new(&repo_root).with_env_overrides(runner_env);
    let mut dimension_scores = Vec::new();
    let planned_metric_count = dimensions
        .iter()
        .map(|dimension| dimension.metrics.len())
        .sum::<usize>();

    if let Err(error) = emit_runtime_fitness_event(
        &repo_root,
        "running",
        args.tier.as_deref().or(args.tier_positional.as_deref()),
        None,
        RuntimeFitnessEventOptions {
            metric_count: planned_metric_count,
            duration_ms: 0.0,
            artifact_path: None,
            write_mailbox_message: false,
        },
    ) {
        eprintln!("Failed to emit runtime fitness event: {error}");
    }

    for dimension in &dimensions {
        let results = run_metric_batch(
            &repo_root,
            &dimension.metrics,
            &shell_runner,
            &sarif_runner,
            RunMetricBatchOptions {
                dry_run: policy.dry_run,
                parallel: policy.parallel,
                changed_files: &changed_files,
                base: &args.base,
                progress_callback: progress_callback.as_ref(),
            },
        );
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
        match args.format.as_str() {
            "ascii" => AsciiReporter::new(18).report(&report),
            "rich" => {
                if let Some(live_reporter) = &live_reporter {
                    live_reporter.force_render();
                }
                RichReporter::new(18).report(&report)
            }
            _ => {
                if let Some(reporter) = &reporter {
                    reporter.report_with_dimensions(&report, &dimensions, show_tier);
                } else {
                    print_report_text(&report, policy.verbose);
                }
            }
        }
    }

    if let Err(error) = write_report_output(args.output.as_deref(), &report_json) {
        eprintln!("Failed to write report: {error}");
        return 1;
    }

    let exit_code = enforce(&report, &policy);
    let observed_at_ms = now_millis();
    let duration_ms = report
        .dimensions
        .iter()
        .flat_map(|dimension| dimension.results.iter())
        .map(|result| result.duration_ms)
        .sum::<f64>();
    let mode_tier = args.tier.as_deref().or(args.tier_positional.as_deref());
    let artifact_placeholder = match write_runtime_fitness_artifacts(
        &repo_root,
        mode_tier,
        &json!({
            "mode": runtime_mode(mode_tier),
            "final_score": report.final_score,
            "hard_gate_blocked": report.hard_gate_blocked,
            "score_blocked": report.score_blocked,
            "duration_ms": duration_ms,
            "metric_count": report
                .dimensions
                .iter()
                .map(|dimension| dimension.results.len())
                .sum::<usize>(),
            "coverage_metric_available": false,
            "coverage_summary": {
                "generated_at_ms": serde_json::Value::Null,
                "typescript": {},
                "rust": {},
            },
            "dimensions": [],
            "slowest_metrics": [],
            "artifact_path": serde_json::Value::Null,
            "producer": "entrix",
            "generated_at_ms": observed_at_ms,
            "base_ref": if changed_files.is_empty() { serde_json::Value::Null } else { json!(args.base) },
            "changed_file_count": changed_files.len(),
            "changed_files_preview": changed_files.iter().take(8).cloned().collect::<Vec<_>>(),
            "failing_metrics": [],
        }),
        observed_at_ms,
    ) {
        Ok(path) => Some(path),
        Err(error) => {
            eprintln!("Failed to write runtime fitness artifact: {error}");
            None
        }
    };
    let artifact_path = build_runtime_fitness_snapshot(
        &repo_root,
        &report,
        RuntimeFitnessSnapshotOptions {
            tier: mode_tier,
            duration_ms,
            artifact_path: artifact_placeholder.as_deref(),
            observed_at_ms,
            producer: "entrix",
            base_ref: if changed_files.is_empty() {
                None
            } else {
                Some(args.base.as_str())
            },
            changed_files: &changed_files,
        },
    )
    .and_then(|snapshot| {
        write_runtime_fitness_artifacts(&repo_root, mode_tier, &snapshot, observed_at_ms)
            .map_err(|error| {
                eprintln!("Failed to write runtime fitness artifact: {error}");
                error
            })
            .ok()
    });
    if let Err(error) = emit_runtime_fitness_event(
        &repo_root,
        if exit_code == 0 { "passed" } else { "failed" },
        mode_tier,
        Some(&report),
        RuntimeFitnessEventOptions {
            metric_count: report
                .dimensions
                .iter()
                .map(|dimension| dimension.results.len())
                .sum(),
            duration_ms,
            artifact_path: artifact_path.as_deref(),
            write_mailbox_message: true,
        },
    ) {
        eprintln!("Failed to emit runtime fitness event: {error}");
        return 1;
    }

    exit_code
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
        println!("Total weight: {total_weight}");
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
    let repo_root = find_project_root();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("failed to start tokio runtime: {error}");
            return 1;
        }
    };

    match runtime.block_on(server::serve_stdio(&repo_root)) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("failed to run entrix MCP server: {error}");
            1
        }
    }
}

fn cmd_analyze_long_file(args: AnalyzeLongFileArgs) -> i32 {
    let repo_root = find_project_root();
    // Deduplicate files + paths while preserving insertion order (files first),
    // matching Python: dict.fromkeys((args.files or []) + (args.paths or []))
    let mut seen = std::collections::HashSet::new();
    let explicit_files: Vec<String> = args
        .files
        .iter()
        .chain(args.paths.iter())
        .filter(|f| seen.insert((*f).clone()))
        .cloned()
        .collect();
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

    if report.blocked && (args.fail_on_trigger || args.fail_on_block) {
        return 4;
    }
    if report.human_review_required && args.fail_on_trigger {
        return 3;
    }
    0
}

fn parse_tier(value: &str) -> Option<Tier> {
    Tier::from_str_opt(value.trim())
}

fn parse_scope_filter(value: &str) -> Option<ExecutionScope> {
    match value.trim() {
        "local" => Some(ExecutionScope::Local),
        "ci" => Some(ExecutionScope::Ci),
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
    let report = test_mapping::analyze_test_mappings(
        &repo_root,
        &changed_files,
        test_mapping::TestMappingAnalysisOptions {
            base: &args.base,
            build_mode: parse_build_mode(&args.build_mode),
            use_graph: !args.no_graph,
        },
    );

    if args.json {
        print_json(&report);
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
        if result.status == "unavailable" {
            println!("{}", result.summary);
            return 1;
        }
        print_graph_impact(&result);
    }
    status_exit_code(&result.status)
}

fn cmd_graph_build(args: GraphBuildArgs) -> i32 {
    let repo_root = find_project_root();
    let result = build_graph(&repo_root, parse_build_mode(&args.build_mode));
    if args.json {
        print_json(&result);
    } else {
        println!("{}", result.summary);
    }
    status_exit_code(&result.status)
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

fn cmd_graph_stats(args: GraphStatsArgs) -> i32 {
    let repo_root = find_project_root();
    let result = graph_stats(&repo_root);
    if args.json {
        print_json(&result);
    } else if result.status == "unavailable" {
        println!("Graph unavailable");
        return 1;
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&result).expect("serialize graph stats")
        );
    }
    status_exit_code(&result.status)
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
        if result.status == "unavailable" {
            println!("{}", result.summary);
            return 1;
        }
        print_graph_test_radius(&result);
    }
    status_exit_code(&result.status)
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
        if result.status == "unavailable" {
            println!("{}", result.summary);
            return 1;
        }
        print_graph_query(&result);
    }
    status_exit_code(&result.status)
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
        if result.status == "unavailable" {
            println!("{}", result.summary);
            return 1;
        }
        print_graph_history(&result);
    }
    status_exit_code(&result.status)
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
        if payload.status == "unavailable" {
            println!("{}", payload.summary);
            return 1;
        }
        print_graph_review_context(&payload);
    }

    status_exit_code(&payload.status)
}

fn parse_build_mode(value: &str) -> ReviewBuildMode {
    match value {
        "skip" => ReviewBuildMode::Skip,
        "full" => ReviewBuildMode::Full,
        _ => ReviewBuildMode::Auto,
    }
}

fn status_exit_code(status: &str) -> i32 {
    if status == "unavailable" {
        1
    } else {
        0
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

    if !violations.is_empty() {
        println!("Refactor the oversized file before commit.");
        // Deduplicate violation paths while preserving order
        let mut seen = BTreeSet::new();
        let violation_files: Vec<String> = violations
            .iter()
            .filter(|v| seen.insert(v.path.clone()))
            .map(|v| v.path.clone())
            .collect();
        let config_path_ref = Path::new(&args.config);
        let structure_result = analyze_long_files(
            &repo_root,
            Some(violation_files),
            Some(config_path_ref),
            &args.base,
            !args.strict_limit,
            default_comment_review_commit_threshold(),
        );
        if structure_result.status == "unavailable" {
            println!(
                "Structure summary unavailable: {}",
                structure_result
                    .summary
                    .as_deref()
                    .unwrap_or("long-file analysis unavailable")
            );
        } else {
            print_hook_long_file_summary(&structure_result);
        }
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
