"""CLI entry point — wires all modules together, feature parity with fitness.py."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from routa_fitness.evidence import load_dimensions, validate_weights
from routa_fitness.governance import GovernancePolicy, enforce, filter_dimensions
from routa_fitness.model import Tier
from routa_fitness.reporters.terminal import TerminalReporter
from routa_fitness.runners.graph import GraphRunner
from routa_fitness.runners.shell import ShellRunner
from routa_fitness.scoring import score_dimension, score_report


def _find_project_root() -> Path:
    """Walk up from CWD to find the project root (contains package.json or Cargo.toml)."""
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / "package.json").exists() or (parent / "Cargo.toml").exists():
            return parent
    return cwd


def _find_fitness_dir(project_root: Path) -> Path:
    """Locate the docs/fitness/ directory relative to project root."""
    fitness_dir = project_root / "docs" / "fitness"
    if not fitness_dir.is_dir():
        print(f"Error: fitness directory not found at {fitness_dir}")
        sys.exit(1)
    return fitness_dir


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


def cmd_run(args: argparse.Namespace) -> int:
    """Run fitness checks (main command)."""
    project_root = _find_project_root()
    fitness_dir = _find_fitness_dir(project_root)

    tier_filter = Tier(args.tier) if args.tier else None
    policy = GovernancePolicy(
        tier_filter=tier_filter,
        parallel=args.parallel,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )

    reporter = TerminalReporter(verbose=policy.verbose)
    reporter.print_header(
        dry_run=policy.dry_run,
        tier=args.tier,
        parallel=policy.parallel,
    )

    dimensions = load_dimensions(fitness_dir)
    dimensions = filter_dimensions(dimensions, policy)

    runner = ShellRunner(project_root)
    dimension_scores = []

    for dim in dimensions:
        print(f"\n## {dim.name.upper()} (weight: {dim.weight}%)")
        print(f"   Source: {dim.source_file}")

        results = runner.run_batch(
            dim.metrics, parallel=policy.parallel, dry_run=policy.dry_run
        )
        ds = score_dimension(results, dim.name, dim.weight)
        dimension_scores.append(ds)

        for result in ds.results:
            status = "\u2705 PASS" if result.passed else "\u274c FAIL"
            hard = " [HARD GATE]" if result.hard_gate else ""
            tier_label = f" [{result.tier.value}]" if tier_filter else ""
            print(f"   - {result.metric_name}: {status}{hard}{tier_label}")

            if not result.passed and (policy.verbose or result.hard_gate):
                if result.output:
                    lines = result.output.strip().split("\n")
                    for line in lines[:10]:
                        print(f"     > {line}")
                    if len(lines) > 10:
                        print(f"     > ... ({len(lines) - 10} more lines)")

        if ds.total > 0:
            print(f"   Score: {ds.score:.0f}%")

    report = score_report(dimension_scores, min_score=policy.min_score)
    reporter.print_footer(report)

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
    result = runner.review_context(
        args.files or None,
        base=args.base,
        max_depth=args.depth,
        build_mode=args.build_mode,
        max_targets=args.max_targets,
        include_source=not args.no_source,
        max_files=args.max_files,
        max_lines_per_file=args.max_lines_per_file,
    )
    if args.json:
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
    run_parser.set_defaults(func=cmd_run)

    validate_parser = subparsers.add_parser("validate", help="Check dimension weights sum to 100%")
    validate_parser.set_defaults(func=cmd_validate)

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
    graph_review_context.add_argument("files", nargs="*", help="Optional explicit changed files")
    graph_review_context.add_argument("--base", default="HEAD", help="Git diff base")
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
