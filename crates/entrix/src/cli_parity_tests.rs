use crate::{
    cmd_graph_test_mapping, parse_scope_filter, status_exit_code, AnalyzeArgs, AnalyzeCommand, Cli,
    Command, ExecutionScope, GraphArgs, GraphCommand, GraphStatsArgs, GraphTestMappingArgs,
    HookArgs, HookCommand, StreamMode,
};
use clap::{CommandFactory, Parser};
use std::fs;
use tempfile::tempdir;

#[test]
fn graph_stats_accepts_json_flag() {
    let cli = Cli::parse_from(["entrix", "graph", "stats", "--json"]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::Stats(GraphStatsArgs { json })),
        })) => assert!(json),
        _ => panic!("expected graph stats command"),
    }
}

#[test]
fn unavailable_status_maps_to_exit_code_one() {
    assert_eq!(status_exit_code("unavailable"), 1);
    assert_eq!(status_exit_code("ok"), 0);
}

#[test]
fn graph_parent_command_parses_without_subcommand() {
    let cli = Cli::parse_from(["entrix", "graph"]);
    match cli.command {
        Some(Command::Graph(GraphArgs { command: None })) => {}
        _ => panic!("expected graph command without subcommand"),
    }
}

#[test]
fn no_command_parses_without_subcommand() {
    let cli = Cli::parse_from(["entrix"]);
    assert!(cli.command.is_none());
}

#[test]
fn run_defaults() {
    let cli = Cli::parse_from(["entrix", "run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert!(args.tier.is_none());
            assert!(args.tier_positional.is_none());
            assert!(!args.parallel);
            assert!(!args.dry_run);
            assert!(!args.verbose);
            assert_eq!(args.stream, "failures");
            assert_eq!(args.format, "text");
            assert_eq!(args.progress_refresh, 4);
            assert_eq!(args.min_score, 80.0);
            assert!(args.scope.is_none());
            assert!(!args.changed_only);
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD");
            assert!(args.dimensions.is_empty());
            assert!(args.metrics.is_empty());
            assert!(!args.json);
            assert!(args.output.is_none());
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_all_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "run",
        "--tier",
        "fast",
        "--parallel",
        "--dry-run",
        "--verbose",
        "--stream",
        "all",
        "--format",
        "rich",
        "--progress-refresh",
        "8",
        "--min-score",
        "65.0",
        "--scope",
        "staging",
        "--output",
        "report.json",
        "--changed-only",
        "--files",
        "src/app/page.tsx",
        "crates/routa-server/src/lib.rs",
        "--base",
        "HEAD~2",
        "--dimension",
        "code_quality",
        "--dimension",
        "testability",
        "--metric",
        "eslint_pass",
        "--metric",
        "ts_typecheck_pass",
    ]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.tier.as_deref(), Some("fast"));
            assert!(args.parallel);
            assert!(args.dry_run);
            assert!(args.verbose);
            assert_eq!(args.stream, "all");
            assert_eq!(args.format, "rich");
            assert_eq!(args.progress_refresh, 8);
            assert_eq!(args.min_score, 65.0);
            assert_eq!(args.scope.as_deref(), Some("staging"));
            assert!(args.changed_only);
            assert_eq!(
                args.files,
                vec!["src/app/page.tsx", "crates/routa-server/src/lib.rs"]
            );
            assert_eq!(args.base, "HEAD~2");
            assert_eq!(args.dimensions, vec!["code_quality", "testability"]);
            assert_eq!(args.metrics, vec!["eslint_pass", "ts_typecheck_pass"]);
            assert!(!args.json);
            assert_eq!(args.output.as_deref(), Some("report.json"));
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_stream_without_value_defaults_to_all() {
    let cli = Cli::parse_from(["entrix", "run", "--stream", "--dry-run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.stream, "all");
            assert!(args.dry_run);
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_stream_with_explicit_value() {
    let cli = Cli::parse_from(["entrix", "run", "--stream", "off"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.stream, "off");
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_defaults_scope_to_local() {
    let cli = Cli::parse_from(["entrix", "run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert!(args.scope.is_none());
            let resolved = args
                .scope
                .as_deref()
                .and_then(parse_scope_filter)
                .or(Some(ExecutionScope::Local));
            assert_eq!(resolved, Some(ExecutionScope::Local));
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn validate_parses() {
    let cli = Cli::parse_from(["entrix", "validate", "--json"]);
    match cli.command {
        Some(Command::Validate(args)) => assert!(args.json),
        _ => panic!("expected validate command"),
    }
}

#[test]
fn install_and_init_flags_parse() {
    let install = Cli::parse_from(["entrix", "install", "--repo", "/tmp/demo", "--dry-run"]);
    match install.command {
        Some(Command::Install(args)) => {
            assert_eq!(args.repo.as_deref(), Some("/tmp/demo"));
            assert!(args.dry_run);
        }
        _ => panic!("expected install command"),
    }

    let init = Cli::parse_from(["entrix", "init", "--repo", "/tmp/demo"]);
    match init.command {
        Some(Command::Init(args)) => {
            assert_eq!(args.repo.as_deref(), Some("/tmp/demo"));
            assert!(!args.dry_run);
        }
        _ => panic!("expected init command"),
    }
}

#[test]
fn serve_parses() {
    let cli = Cli::parse_from(["entrix", "serve"]);
    match cli.command {
        Some(Command::Serve) => {}
        _ => panic!("expected serve command"),
    }
}

#[test]
fn review_trigger_defaults() {
    let cli = Cli::parse_from(["entrix", "review-trigger"]);
    match cli.command {
        Some(Command::ReviewTrigger(args)) => {
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD~1");
            assert!(args.config.is_none());
            assert!(!args.fail_on_trigger);
            assert!(!args.json);
        }
        _ => panic!("expected review-trigger command"),
    }
}

#[test]
fn review_trigger_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "review-trigger",
        "--base",
        "main",
        "--config",
        "docs/fitness/review-triggers.yaml",
        "--fail-on-trigger",
        "--json",
        "src/core/acp/foo.ts",
    ]);
    match cli.command {
        Some(Command::ReviewTrigger(args)) => {
            assert_eq!(args.base, "main");
            assert_eq!(
                args.config.as_deref(),
                Some("docs/fitness/review-triggers.yaml")
            );
            assert!(args.fail_on_trigger);
            assert!(args.json);
            assert_eq!(args.files, vec!["src/core/acp/foo.ts"]);
        }
        _ => panic!("expected review-trigger command"),
    }
}

#[test]
fn release_trigger_defaults() {
    let cli = Cli::parse_from(["entrix", "release-trigger", "--manifest", "manifest.json"]);
    match cli.command {
        Some(Command::ReleaseTrigger(args)) => {
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD~1");
            assert_eq!(args.manifest, "manifest.json");
            assert!(args.baseline_manifest.is_none());
            assert!(args.config.is_none());
            assert!(!args.fail_on_trigger);
            assert!(!args.fail_on_block);
            assert!(!args.json);
        }
        _ => panic!("expected release-trigger command"),
    }
}

#[test]
fn release_trigger_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "release-trigger",
        "--manifest",
        "dist/release/manifest.json",
        "--baseline-manifest",
        "dist/release/baseline.json",
        "--base",
        "main",
        "--config",
        "docs/fitness/release-triggers.yaml",
        "--fail-on-block",
        "--fail-on-trigger",
        "--json",
        "scripts/release/stage-routa-cli-npm.mjs",
    ]);
    match cli.command {
        Some(Command::ReleaseTrigger(args)) => {
            assert_eq!(args.manifest, "dist/release/manifest.json");
            assert_eq!(
                args.baseline_manifest.as_deref(),
                Some("dist/release/baseline.json")
            );
            assert_eq!(args.base, "main");
            assert_eq!(
                args.config.as_deref(),
                Some("docs/fitness/release-triggers.yaml")
            );
            assert!(args.fail_on_trigger);
            assert!(args.fail_on_block);
            assert!(args.json);
            assert_eq!(args.files, vec!["scripts/release/stage-routa-cli-npm.mjs"]);
        }
        _ => panic!("expected release-trigger command"),
    }
}

#[test]
fn hook_file_length_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "hook",
        "file-length",
        "--config",
        "budgets.json",
        "--staged-only",
        "--strict-limit",
    ]);
    match cli.command {
        Some(Command::Hook(HookArgs {
            command: Some(HookCommand::FileLength(args)),
        })) => {
            assert_eq!(args.config, "budgets.json");
            assert!(args.staged_only);
            assert!(args.strict_limit);
            assert!(!args.changed_only);
            assert!(!args.overrides_only);
        }
        _ => panic!("expected hook file-length command"),
    }
}

#[test]
fn graph_impact_defaults() {
    let cli = Cli::parse_from(["entrix", "graph", "impact"]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::Impact(args)),
        })) => {
            assert_eq!(args.base, "HEAD");
            assert_eq!(args.depth, 2);
            assert!(args.files.is_empty());
        }
        _ => panic!("expected graph impact command"),
    }
}

#[test]
fn graph_test_radius_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "graph",
        "test-radius",
        "--base",
        "HEAD~3",
        "--depth",
        "4",
        "--max-targets",
        "12",
        "src/a.ts",
    ]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::TestRadius(args)),
        })) => {
            assert_eq!(args.base, "HEAD~3");
            assert_eq!(args.depth, 4);
            assert_eq!(args.max_targets, 12);
            assert_eq!(args.files, vec!["src/a.ts"]);
        }
        _ => panic!("expected graph test-radius command"),
    }
}

#[test]
fn graph_query_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "graph",
        "query",
        "tests_for",
        "MyService.run",
        "--json",
    ]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::Query(args)),
        })) => {
            assert_eq!(args.pattern, "tests_for");
            assert_eq!(args.target, "MyService.run");
            assert!(args.json);
        }
        _ => panic!("expected graph query command"),
    }
}

#[test]
fn graph_test_mapping_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "graph",
        "test-mapping",
        "--base",
        "HEAD~2",
        "--build-mode",
        "skip",
        "--no-graph",
        "--fail-on-missing",
        "--json",
        "src/a.ts",
    ]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::TestMapping(args)),
        })) => {
            assert_eq!(args.base, "HEAD~2");
            assert_eq!(args.build_mode, "skip");
            assert!(args.no_graph);
            assert!(args.fail_on_missing);
            assert!(args.json);
            assert_eq!(args.files, vec!["src/a.ts"]);
        }
        _ => panic!("expected graph test-mapping command"),
    }
}

#[test]
fn graph_test_mapping_returns_non_zero_when_missing_and_fail_on_missing_enabled() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("src")).expect("create src");
    fs::write(repo_root.join("src/demo.ts"), "export function demo() {}\n").expect("write source");

    let previous = std::env::current_dir().expect("cwd");
    std::env::set_current_dir(repo_root).expect("chdir temp repo");

    let exit_code = cmd_graph_test_mapping(GraphTestMappingArgs {
        files: vec!["src/demo.ts".to_string()],
        base: "HEAD".to_string(),
        build_mode: "auto".to_string(),
        no_graph: true,
        fail_on_missing: true,
        json: true,
    });

    std::env::set_current_dir(previous).expect("restore cwd");
    assert_eq!(exit_code, 2);
}

#[test]
fn graph_test_mapping_allows_missing_when_flag_disabled() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("src")).expect("create src");
    fs::write(repo_root.join("src/demo.ts"), "export function demo() {}\n").expect("write source");

    let previous = std::env::current_dir().expect("cwd");
    std::env::set_current_dir(repo_root).expect("chdir temp repo");

    let exit_code = cmd_graph_test_mapping(GraphTestMappingArgs {
        files: vec!["src/demo.ts".to_string()],
        base: "HEAD".to_string(),
        build_mode: "auto".to_string(),
        no_graph: true,
        fail_on_missing: false,
        json: true,
    });

    std::env::set_current_dir(previous).expect("restore cwd");
    assert_eq!(exit_code, 0);
}

#[test]
fn graph_history_flags() {
    let cli = Cli::parse_from([
        "entrix", "graph", "history", "--count", "5", "--ref", "main",
    ]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::History(args)),
        })) => {
            assert_eq!(args.count, 5);
            assert_eq!(args.git_ref, "main");
        }
        _ => panic!("expected graph history command"),
    }
}

#[test]
fn graph_review_context_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "graph",
        "review-context",
        "--base",
        "HEAD~2",
        "--head",
        "HEAD",
        "--depth",
        "3",
        "--max-targets",
        "10",
        "--max-files",
        "4",
        "--max-lines-per-file",
        "80",
        "--output",
        "-",
        "--files",
        "src/b.ts",
        "--no-source",
        "src/a.ts",
    ]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::ReviewContext(args)),
        })) => {
            assert_eq!(args.base, "HEAD~2");
            assert_eq!(args.head, "HEAD");
            assert_eq!(args.depth, 3);
            assert_eq!(args.max_targets, 10);
            assert_eq!(args.max_files, 4);
            assert_eq!(args.max_lines_per_file, 80);
            assert_eq!(args.output.as_deref(), Some("-"));
            assert!(args.no_source);
            assert_eq!(args.files, vec!["src/b.ts"]);
            assert_eq!(args.files_positional, vec!["src/a.ts"]);
        }
        _ => panic!("expected graph review-context command"),
    }
}

#[test]
fn analyze_long_file_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "analyze",
        "long-file",
        "--files",
        "a.rs",
        "--base",
        "main",
        "--strict-limit",
        "--json",
    ]);
    match cli.command {
        Some(Command::Analyze(AnalyzeArgs {
            command: Some(AnalyzeCommand::LongFile(args)),
        })) => {
            assert_eq!(args.files, vec!["a.rs"]);
            assert_eq!(args.base, "main");
            assert!(args.strict_limit);
            assert!(args.json);
        }
        _ => panic!("expected analyze long-file command"),
    }
}

#[test]
fn analyze_long_file_positional_paths() {
    let cli = Cli::parse_from(["entrix", "analyze", "long-file", "src/a.ts", "src/b.py"]);
    match cli.command {
        Some(Command::Analyze(AnalyzeArgs {
            command: Some(AnalyzeCommand::LongFile(args)),
        })) => {
            assert_eq!(args.paths, vec!["src/a.ts", "src/b.py"]);
        }
        _ => panic!("expected analyze long-file command"),
    }
}

#[test]
fn analyze_long_file_dedup_merges_files_and_paths() {
    let files = ["src/b.py".to_string(), "src/a.ts".to_string()];
    let paths = ["src/a.ts".to_string(), "src/c.rs".to_string()];
    let mut seen = std::collections::HashSet::new();
    let merged: Vec<String> = files
        .iter()
        .chain(paths.iter())
        .filter(|f| seen.insert((*f).clone()))
        .cloned()
        .collect();
    assert_eq!(merged, vec!["src/b.py", "src/a.ts", "src/c.rs"]);
}

#[test]
fn stream_mode_parse_parity() {
    assert_eq!(StreamMode::parse("all"), StreamMode::All);
    assert_eq!(StreamMode::parse("off"), StreamMode::Off);
    assert_eq!(StreamMode::parse("failures"), StreamMode::Failures);
    assert_eq!(StreamMode::parse("unknown"), StreamMode::Failures);
}

#[test]
fn scope_filter_parse_parity() {
    assert_eq!(parse_scope_filter("local"), Some(ExecutionScope::Local));
    assert_eq!(parse_scope_filter("ci"), Some(ExecutionScope::Ci));
    assert_eq!(parse_scope_filter("staging"), Some(ExecutionScope::Staging));
    assert_eq!(
        parse_scope_filter("prod_observation"),
        Some(ExecutionScope::ProdObservation)
    );
    assert_eq!(parse_scope_filter("unknown"), None);
}

#[test]
fn help_formats_without_error() {
    let help_text = Cli::command().render_help().to_string();
    assert!(help_text.contains("entrix"));
    assert!(help_text.contains("validate"));
    assert!(help_text.contains("Evolutionary architecture fitness engine"));
}
