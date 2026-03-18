"""Tests for routa_fitness.cli."""

from routa_fitness.cli import build_parser


def test_parser_run_defaults():
    parser = build_parser()
    args = parser.parse_args(["run"])
    assert args.command == "run"
    assert args.tier is None
    assert args.parallel is False
    assert args.dry_run is False
    assert args.verbose is False


def test_parser_run_all_flags():
    parser = build_parser()
    args = parser.parse_args(["run", "--tier", "fast", "--parallel", "--dry-run", "--verbose"])
    assert args.tier == "fast"
    assert args.parallel is True
    assert args.dry_run is True
    assert args.verbose is True


def test_parser_validate():
    parser = build_parser()
    args = parser.parse_args(["validate"])
    assert args.command == "validate"


def test_parser_graph_impact_defaults():
    parser = build_parser()
    args = parser.parse_args(["graph", "impact"])
    assert args.command == "graph"
    assert args.graph_command == "impact"
    assert args.base == "HEAD"
    assert args.depth == 2
    assert args.files == []


def test_parser_graph_test_radius_flags():
    parser = build_parser()
    args = parser.parse_args(
        ["graph", "test-radius", "--base", "HEAD~3", "--depth", "4", "--max-targets", "12", "src/a.ts"]
    )
    assert args.command == "graph"
    assert args.graph_command == "test-radius"
    assert args.base == "HEAD~3"
    assert args.depth == 4
    assert args.max_targets == 12
    assert args.files == ["src/a.ts"]


def test_parser_graph_query():
    parser = build_parser()
    args = parser.parse_args(["graph", "query", "tests_for", "MyService.run", "--json"])
    assert args.command == "graph"
    assert args.graph_command == "query"
    assert args.pattern == "tests_for"
    assert args.target == "MyService.run"
    assert args.json is True


def test_parser_graph_history():
    parser = build_parser()
    args = parser.parse_args(["graph", "history", "--count", "5", "--ref", "main"])
    assert args.command == "graph"
    assert args.graph_command == "history"
    assert args.count == 5
    assert args.ref == "main"


def test_parser_graph_review_context():
    parser = build_parser()
    args = parser.parse_args(
        [
            "graph",
            "review-context",
            "--base",
            "HEAD~2",
            "--depth",
            "3",
            "--max-targets",
            "10",
            "--max-files",
            "4",
            "--max-lines-per-file",
            "80",
            "--no-source",
            "src/a.ts",
        ]
    )
    assert args.command == "graph"
    assert args.graph_command == "review-context"
    assert args.base == "HEAD~2"
    assert args.depth == 3
    assert args.max_targets == 10
    assert args.max_files == 4
    assert args.max_lines_per_file == 80
    assert args.no_source is True
    assert args.files == ["src/a.ts"]


def test_parser_no_command():
    parser = build_parser()
    args = parser.parse_args([])
    assert args.command is None
