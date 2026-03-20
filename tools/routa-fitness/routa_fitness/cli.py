"""CLI entry point — wires all modules together, feature parity with fitness.py."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from routa_fitness.engine import collect_changed_files, matches_changed_files, run_fitness_report
from routa_fitness.governance import GovernancePolicy, enforce
from routa_fitness.loaders import load_dimensions, validate_weights
from routa_fitness.model import ExecutionScope, Metric, ResultState, Tier
from routa_fitness.presets import get_project_preset
from routa_fitness.reporting import report_to_dict, write_report_output
from routa_fitness.review_trigger import (
    collect_changed_files as collect_review_changed_files,
    collect_diff_stats,
    evaluate_review_triggers,
    load_review_triggers,
)
from routa_fitness.reporters.terminal import TerminalReporter
from routa_fitness.runners.graph import GraphRunner


def _find_project_root() -> Path:
    """Walk up from CWD to find the project root (contains package.json or Cargo.toml)."""
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / "package.json").exists() or (parent / "Cargo.toml").exists():
            return parent
    return cwd


def _find_fitness_dir(project_root: Path) -> Path:
    """Locate the docs/fitness/ directory relative to project root."""
    fitness_dir = get_project_preset().fitness_dir(project_root)
    if not fitness_dir.is_dir():
        print(f"Error: fitness directory not found at {fitness_dir}")
        sys.exit(1)
    return fitness_dir


def _find_review_trigger_config(project_root: Path) -> Path:
    """Locate the default review-trigger config."""
    config_path = get_project_preset().review_trigger_config(project_root)
    if not config_path.is_file():
        print(f"Error: review-trigger config not found at {config_path}")
        sys.exit(1)
    return config_path


def _print_json(data: dict) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def _print_graph_impact(result: dict) -> None:
    print(result.get("summary", "No summary available."))
    print(f"Changed files: {len(result.get('changed_files', []))}")
    print(f"Impacted files: {len(result.get('impacted_files', []))}")
    print(f"Impacted test files: {len(result.get('impacted_test_files', []))}")
    print(f"Wide blast radius: {'yes' if result.get('wide_blast_radius') else 'no'}")
    if result.get("skipped_files"):
        print(f"Skipped files: {', '.join(result['skipped_files'][:10])}")


def _print_graph_test_radius(result: dict) -> None:
    print(result.get("summary", "No summary available."))
    print(f"Changed files: {len(result.get('changed_files', []))}")
    print(f"Queryable targets: {len(result.get('target_nodes', []))}")
    print(f"Unique test files: {len(result.get('test_files', []))}")
    print(f"Untested targets: {len(result.get('untested_targets', []))}")
    if result.get("test_files"):
        print("Test files:")
        for file_path in result["test_files"][:20]:
            print(f"  - {file_path}")
    if result.get("untested_targets"):
        print("Untested targets:")
        for target in result["untested_targets"][:20]:
            print(f"  - {target['qualified_name']}")


def _print_graph_query(result: dict) -> None:
    print(result.get("summary", "No summary available."))
    for item in result.get("results", [])[:20]:
        label = item.get("qualified_name") or item.get("name") or item.get("file_path") or str(item)
        print(f"  - {label}")


def _print_graph_history(result: dict) -> None:
    print(result.get("summary", "No summary available."))
    for commit in result.get("commits", []):
        print(
            f"{commit['short_commit']} {commit['subject']} | "
            f"files={commit['changed_file_count']} "
            f"targets={commit['target_count']} "
            f"tests={commit['test_file_count']} "
            f"untested={commit['untested_target_count']}"
        )


def _print_graph_review_context(result: dict) -> None:
    print(result.get("summary", "No summary available."))
    context = result.get("context", {})
    tests = context.get("tests", {})
    print(f"Changed files: {len(context.get('changed_files', []))}")
    print(f"Impacted files: {len(context.get('impacted_files', []))}")
    print(f"Queryable targets: {len(context.get('targets', []))}")
    print(f"Test files: {len(tests.get('test_files', []))}")
    print("Review guidance:")
    for line in str(context.get("review_guidance", "")).splitlines():
        print(f"  {line}")
    snippets = context.get("source_snippets", [])
    if snippets:
        print("Source snippets:")
        for snippet in snippets[:10]:
            suffix = " (truncated)" if snippet.get("truncated") else ""
            print(f"  - {snippet['file_path']}{suffix}")


def _print_review_trigger_report(report: dict) -> None:
    print("REVIEW TRIGGER REPORT")
    print(f"Base: {report['base']}")
    stats = report.get("diff_stats", {})
    print(
        "Diff stats: "
        f"files={stats.get('file_count', 0)} "
        f"added={stats.get('added_lines', 0)} "
        f"deleted={stats.get('deleted_lines', 0)}"
    )
    if report.get("human_review_required"):
        print("Human review required: yes")
        for trigger in report.get("triggers", []):
            print(f"- {trigger['name']} [{trigger['severity']}]")
            for reason in trigger.get("reasons", []):
                print(f"  reason: {reason}")
    else:
        print("Human review required: no")


def _domains_from_files(files: list[str]) -> set[str]:
    return get_project_preset().domains_from_files(files)


def _metric_domains(metric: Metric) -> set[str]:
    return get_project_preset().metric_domains(metric)


def _collect_run_files(args: argparse.Namespace, project_root: Path) -> list[str]:
    explicit_files = args.files or []
    if explicit_files:
        return explicit_files
    if args.changed_only:
        return collect_changed_files(project_root, args.base)
    return []


def cmd_run(args: argparse.Namespace) -> int:
    """Run fitness checks (main command)."""
    project_root = _find_project_root()
    _find_fitness_dir(project_root)
    preset = get_project_preset()

    tier_filter = Tier(args.tier) if args.tier else None
    execution_scope = ExecutionScope(args.scope) if args.scope else None
    policy = GovernancePolicy(
        tier_filter=tier_filter,
        parallel=args.parallel,
        dry_run=args.dry_run,
        verbose=args.verbose,
        execution_scope=execution_scope,
    )

    reporter = TerminalReporter(verbose=policy.verbose)
    reporter.print_header(
        dry_run=policy.dry_run,
        tier=args.tier,
        parallel=policy.parallel,
    )

    changed_files = _collect_run_files(args, project_root)
    if args.changed_only or changed_files:
        if args.changed_only and not changed_files:
            print("No changed files detected; skipping fitness run.")
            write_report_output(
                args.output,
                {
                    "final_score": 0.0,
                    "hard_gate_blocked": False,
                    "score_blocked": False,
                    "dimensions": [],
                },
            )
            return 0

        changed_domains = preset.domains_from_files(changed_files)
        print(
            f"\nIncremental mode: base={args.base}, changed_files={len(changed_files)}, domains={','.join(sorted(changed_domains)) or 'none'}"
        )
    report, dimensions = run_fitness_report(
        project_root,
        policy,
        preset,
        changed_files=changed_files or None,
        base=args.base,
    )

    if not dimensions:
        print("No metrics matched the current run filters; skipping fitness run.")
        write_report_output(
            args.output,
            {
                "final_score": 0.0,
                "hard_gate_blocked": False,
                "score_blocked": False,
                "dimensions": [],
            },
        )
        return 0

    for dim, ds in zip(dimensions, report.dimensions):
        print(f"\n## {dim.name.upper()} (weight: {dim.weight}%)")
        print(f"   Source: {dim.source_file}")

        for result in ds.results:
            state_labels = {
                ResultState.PASS: "\u2705 PASS",
                ResultState.FAIL: "\u274c FAIL",
                ResultState.UNKNOWN: "\u2753 UNKNOWN",
                ResultState.SKIPPED: "\u23ed\ufe0f SKIPPED",
                ResultState.WAIVED: "\u26a0\ufe0f WAIVED",
            }
            status = state_labels.get(result.state, "\u2753 UNKNOWN")
            hard = " [HARD GATE]" if result.hard_gate else ""
            tier_label = f" [{result.tier.value}]" if tier_filter else ""
            print(f"   - {result.metric_name}: {status}{hard}{tier_label}")

            if result.state == ResultState.FAIL and (policy.verbose or result.hard_gate):
                if result.output:
                    lines = result.output.strip().split("\n")
                    for line in lines[:10]:
                        print(f"     > {line}")
                    if len(lines) > 10:
                        print(f"     > ... ({len(lines) - 10} more lines)")

        if ds.total > 0:
            print(f"   Score: {ds.score:.0f}%")

    reporter.print_footer(report)
    write_report_output(args.output, report_to_dict(report))

    return enforce(report, policy)


def cmd_validate(args: argparse.Namespace) -> int:
    """Validate that dimension weights sum to 100%."""
    project_root = _find_project_root()
    fitness_dir = _find_fitness_dir(project_root)

    dimensions = load_dimensions(fitness_dir)
    valid, total = validate_weights(dimensions)

    for dim in dimensions:
        print(f"  {dim.name}: {dim.weight}%  ({dim.source_file})")

    print(f"\nTotal: {total}%")
    if valid:
        print("\u2705 Weights sum to 100%")
        return 0

    print(f"\u274c Weights sum to {total}%, expected 100%")
    return 1


def cmd_review_trigger(args: argparse.Namespace) -> int:
    """Evaluate review-trigger rules for the current diff."""
    project_root = _find_project_root()
    config_path = Path(args.config).resolve() if args.config else _find_review_trigger_config(project_root)

    rules = load_review_triggers(config_path)
    changed_files = args.files or collect_review_changed_files(project_root, args.base)
    diff_stats = collect_diff_stats(project_root, args.base)
    report = evaluate_review_triggers(rules, changed_files, diff_stats, base=args.base)

    if args.json:
        _print_json(report.to_dict())
    else:
        _print_review_trigger_report(report.to_dict())

    if report.human_review_required and args.fail_on_trigger:
        return 3
    return 0


def cmd_graph_build(args: argparse.Namespace) -> int:
    """Build or update the backing code graph."""
    runner = GraphRunner(_find_project_root())
    result = runner.build_graph(base=args.base, build_mode=args.build_mode)
    if args.json:
        _print_json(result)
    else:
        print(result.get("summary", result.get("reason", "No summary available.")))
    return 0 if result.get("status") not in {"unavailable"} else 1


def cmd_graph_stats(args: argparse.Namespace) -> int:
    """Show graph statistics."""
    runner = GraphRunner(_find_project_root())
    result = runner.stats()
    if args.json:
        _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result.get("status") != "unavailable" else 1


def cmd_graph_impact(args: argparse.Namespace) -> int:
    """Show blast radius for changed files or an explicit file list."""
    runner = GraphRunner(_find_project_root())
    result = runner.analyze_impact(
        args.files or None,
        base=args.base,
        max_depth=args.depth,
        build_mode=args.build_mode,
    )
    if args.json:
        _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        _print_graph_impact(result)
    return 0 if result.get("status") != "unavailable" else 1


def cmd_graph_test_radius(args: argparse.Namespace) -> int:
    """Show tests in the radius of the current diff or explicit files."""
    runner = GraphRunner(_find_project_root())
    result = runner.analyze_test_radius(
        args.files or None,
        base=args.base,
        max_depth=args.depth,
        build_mode=args.build_mode,
        max_targets=args.max_targets,
    )
    if args.json:
        _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        _print_graph_test_radius(result)
    return 0 if result.get("status") != "unavailable" else 1


def cmd_graph_query(args: argparse.Namespace) -> int:
    """Run a graph query such as callers_of or tests_for."""
    runner = GraphRunner(_find_project_root())
    result = runner.query(
        args.pattern,
        args.target,
        base=args.base,
        build_mode=args.build_mode,
    )
    if args.json:
        _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        _print_graph_query(result)
    return 0 if result.get("status") != "unavailable" else 1


def cmd_graph_history(args: argparse.Namespace) -> int:
    """Estimate test radius for recent commits using the current graph."""
    runner = GraphRunner(_find_project_root())
    result = runner.analyze_history(
        count=args.count,
        ref=args.ref,
        max_depth=args.depth,
        build_mode=args.build_mode,
        max_targets=args.max_targets,
    )
    if args.json:
        _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        _print_graph_history(result)
    return 0 if result.get("status") != "unavailable" else 1


def cmd_graph_review_context(args: argparse.Namespace) -> int:
    """Build an AI-friendly review context for the current diff or files."""
    runner = GraphRunner(_find_project_root())
    file_args = (args.files_positional or []) + (args.files or [])
    result = runner.review_context(
        file_args or None,
        base=args.base,
        max_depth=args.depth,
        build_mode=args.build_mode,
        max_targets=args.max_targets,
        include_source=not args.no_source,
        max_files=args.max_files,
        max_lines_per_file=args.max_lines_per_file,
    )
    if args.json:
        if args.output and args.output != "-":
            Path(args.output).write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        else:
            _print_json(result)
    else:
        if result.get("status") == "unavailable":
            print(result.get("reason", "Graph unavailable"))
            return 1
        _print_graph_review_context(result)
    return 0 if result.get("status") != "unavailable" else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="routa-fitness",
        description="Evolutionary architecture fitness engine for Routa",
    )
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run fitness checks")
    run_parser.add_argument(
        "--tier", choices=["fast", "normal", "deep"], help="Run only metrics up to this tier"
    )
    run_parser.add_argument("--parallel", action="store_true", help="Run metrics in parallel")
    run_parser.add_argument("--dry-run", action="store_true", help="Show what would run")
    run_parser.add_argument("--verbose", action="store_true", help="Show output on failure")
    run_parser.add_argument(
        "--scope",
        choices=["local", "ci", "staging", "prod_observation"],
        help="Run only metrics for the given execution scope",
    )
    run_parser.add_argument(
        "--output",
        help="Write JSON report to a file path, or '-' for stdout",
    )
    run_parser.add_argument(
        "--changed-only",
        action="store_true",
        help="Run only metrics relevant to changed files",
    )
    run_parser.add_argument(
        "--files",
        nargs="*",
        default=[],
        help="Explicit changed files used for incremental metric selection",
    )
    run_parser.add_argument(
        "--base",
        default="HEAD",
        help="Git base reference used by --changed-only",
    )
    run_parser.set_defaults(func=cmd_run)

    validate_parser = subparsers.add_parser("validate", help="Check dimension weights sum to 100%%")
    validate_parser.set_defaults(func=cmd_validate)

    review_trigger_parser = subparsers.add_parser(
        "review-trigger",
        help="Detect risky changes that should trigger human review",
    )
    review_trigger_parser.add_argument("files", nargs="*", help="Optional explicit changed files")
    review_trigger_parser.add_argument("--base", default="HEAD~1", help="Git diff base")
    review_trigger_parser.add_argument("--config", help="Optional review-trigger YAML config path")
    review_trigger_parser.add_argument(
        "--fail-on-trigger",
        action="store_true",
        help="Return non-zero when human review is required",
    )
    review_trigger_parser.add_argument("--json", action="store_true", help="Emit JSON output")
    review_trigger_parser.set_defaults(func=cmd_review_trigger)

    graph_parser = subparsers.add_parser("graph", help="Graph-backed impact and test-radius analysis")
    graph_subparsers = graph_parser.add_subparsers(dest="graph_command")

    graph_build = graph_subparsers.add_parser("build", help="Build or update the code graph")
    graph_build.add_argument("--base", default="HEAD", help="Git diff base for incremental update")
    graph_build.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_build.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_build.set_defaults(func=cmd_graph_build)

    graph_stats = graph_subparsers.add_parser("stats", help="Show graph statistics")
    graph_stats.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_stats.set_defaults(func=cmd_graph_stats)

    graph_impact = graph_subparsers.add_parser("impact", help="Analyze blast radius")
    graph_impact.add_argument("files", nargs="*", help="Optional explicit changed files")
    graph_impact.add_argument("--base", default="HEAD", help="Git diff base")
    graph_impact.add_argument("--depth", type=int, default=2, help="Traversal depth")
    graph_impact.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_impact.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_impact.set_defaults(func=cmd_graph_impact)

    graph_test_radius = graph_subparsers.add_parser(
        "test-radius",
        help="Estimate tests affected by changed files or commits",
    )
    graph_test_radius.add_argument("files", nargs="*", help="Optional explicit changed files")
    graph_test_radius.add_argument("--base", default="HEAD", help="Git diff base")
    graph_test_radius.add_argument("--depth", type=int, default=2, help="Traversal depth")
    graph_test_radius.add_argument("--max-targets", type=int, default=25, help="Max nodes to query")
    graph_test_radius.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_test_radius.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_test_radius.set_defaults(func=cmd_graph_test_radius)

    graph_query = graph_subparsers.add_parser("query", help="Run a graph query")
    graph_query.add_argument(
        "pattern",
        choices=[
            "callers_of",
            "callees_of",
            "imports_of",
            "importers_of",
            "children_of",
            "tests_for",
            "inheritors_of",
            "file_summary",
        ],
        help="Query pattern",
    )
    graph_query.add_argument("target", help="Qualified name or file path")
    graph_query.add_argument("--base", default="HEAD", help="Git diff base")
    graph_query.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_query.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_query.set_defaults(func=cmd_graph_query)

    graph_history = graph_subparsers.add_parser(
        "history",
        help="Estimate test radius for recent commits using the current graph",
    )
    graph_history.add_argument("--count", type=int, default=10, help="Number of commits to inspect")
    graph_history.add_argument("--ref", default="HEAD", help="Revision to walk from")
    graph_history.add_argument("--depth", type=int, default=2, help="Traversal depth")
    graph_history.add_argument("--max-targets", type=int, default=25, help="Max nodes to query")
    graph_history.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_history.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_history.set_defaults(func=cmd_graph_history)

    graph_review_context = graph_subparsers.add_parser(
        "review-context",
        help="Build an AI-friendly review context from the current graph",
    )
    graph_review_context.add_argument("files_positional", nargs="*", help="Optional explicit changed files")
    graph_review_context.add_argument("--files", nargs="*", default=[], help="Explicit changed files")
    graph_review_context.add_argument("--base", default="HEAD", help="Git diff base")
    graph_review_context.add_argument("--head", default="HEAD", help="Compatibility flag; currently unused")
    graph_review_context.add_argument("--depth", type=int, default=2, help="Traversal depth")
    graph_review_context.add_argument("--max-targets", type=int, default=25, help="Max nodes to query")
    graph_review_context.add_argument("--max-files", type=int, default=12, help="Max source files to include")
    graph_review_context.add_argument(
        "--max-lines-per-file",
        type=int,
        default=120,
        help="Max source lines to include per file",
    )
    graph_review_context.add_argument(
        "--no-source",
        action="store_true",
        help="Do not include source snippets in the output",
    )
    graph_review_context.add_argument(
        "--build-mode",
        choices=["auto", "full", "skip"],
        default="auto",
        help="Graph build mode",
    )
    graph_review_context.add_argument("--json", action="store_true", help="Emit JSON output")
    graph_review_context.add_argument("--output", help="Write JSON output to a file path or '-' for stdout")
    graph_review_context.set_defaults(func=cmd_graph_review_context)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "graph" and not getattr(args, "graph_command", None):
        parser.parse_args(["graph", "--help"])
        return

    exit_code = args.func(args)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
