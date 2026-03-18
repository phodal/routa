"""Tests for routa_fitness.runners.graph."""

from pathlib import Path

import routa_fitness.runners.graph as graph_module
from routa_fitness.runners.graph import GraphRunner


class FakeAdapter:
    def __init__(self) -> None:
        self.build_calls = []
        self.impact_calls = []
        self.query_calls = []

    def build_or_update(self, *, full: bool = False, base: str = "HEAD~1") -> dict:
        self.build_calls.append({"full": full, "base": base})
        return {"status": "ok", "build_type": "full" if full else "incremental"}

    def impact_radius(self, files: list[str], *, depth: int = 2) -> dict:
        self.impact_calls.append({"files": files, "depth": depth})
        return {
            "status": "ok",
            "summary": "impact ok",
            "changed_nodes": [
                {
                    "qualified_name": "src.service.run",
                    "name": "run",
                    "kind": "Function",
                    "file_path": "src/service.ts",
                },
                {
                    "qualified_name": "src.service.Service",
                    "name": "Service",
                    "kind": "Class",
                    "file_path": "src/service.ts",
                },
                {
                    "qualified_name": "tests.service.test_run",
                    "name": "test_run",
                    "kind": "Function",
                    "file_path": "src/service.test.ts",
                    "is_test": True,
                },
            ],
            "impacted_nodes": [],
            "impacted_files": ["src/service.test.ts", "src/other.ts"],
            "edges": [],
        }

    def query(self, query_type: str, target: str) -> dict:
        self.query_calls.append({"query_type": query_type, "target": target})
        if target == "src.service.run":
            return {
                "status": "ok",
                "results": [
                    {
                        "qualified_name": "tests.service.test_run",
                        "name": "test_run",
                        "kind": "Function",
                        "file_path": "src/service.test.ts",
                        "is_test": True,
                    }
                ],
            }
        return {"status": "ok", "results": []}

    def stats(self) -> dict:
        return {"status": "ok", "nodes": 10, "edges": 12}


def test_analyze_impact_structured(monkeypatch, tmp_path: Path):
    adapter = FakeAdapter()
    project_root = tmp_path
    (project_root / "src").mkdir()
    (project_root / "src" / "service.ts").write_text("export function run() {}\n", encoding="utf-8")
    (project_root / "src" / "service.test.ts").write_text("test('run', () => {})\n", encoding="utf-8")
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)

    runner = GraphRunner(project_root)
    result = runner.analyze_impact(["src/service.ts"], build_mode="full")

    assert result["status"] == "ok"
    assert result["changed_files"] == ["src/service.ts"]
    assert result["impacted_test_files"] == ["src/service.test.ts"]
    assert result["wide_blast_radius"] is False
    assert adapter.build_calls == [{"full": True, "base": "HEAD"}]


def test_analyze_test_radius_queries_targets(monkeypatch, tmp_path: Path):
    adapter = FakeAdapter()
    project_root = tmp_path
    (project_root / "src").mkdir()
    (project_root / "src" / "service.ts").write_text("export function run() {}\n", encoding="utf-8")
    (project_root / "src" / "service.test.ts").write_text("test('run', () => {})\n", encoding="utf-8")
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)

    runner = GraphRunner(project_root)
    result = runner.analyze_test_radius(["src/service.ts"], build_mode="skip")

    assert result["status"] == "ok"
    assert result["test_files"] == ["src/service.test.ts"]
    assert result["untested_targets"] == [
        {
            "qualified_name": "src.service.Service",
            "kind": "Class",
            "file_path": "src/service.ts",
        }
    ]
    assert adapter.query_calls == [
        {"query_type": "tests_for", "target": "src.service.run"},
        {"query_type": "tests_for", "target": "src.service.Service"},
    ]


def test_analyze_history_estimates_recent_commits(monkeypatch, tmp_path: Path):
    adapter = FakeAdapter()
    project_root = tmp_path
    (project_root / "src").mkdir()
    (project_root / "src" / "service.ts").write_text("export function run() {}\n", encoding="utf-8")
    (project_root / "src" / "service.test.ts").write_text("test('run', () => {})\n", encoding="utf-8")
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)
    monkeypatch.setattr(
        graph_module,
        "git_recent_commits",
        lambda *_args, **_kwargs: [
            {
                "commit": "abcdef123456",
                "short_commit": "abcdef12",
                "subject": "feat: demo",
                "committed_at": "2026-03-18T00:00:00Z",
            }
        ],
    )
    monkeypatch.setattr(
        graph_module,
        "git_commit_changed_files",
        lambda *_args, **_kwargs: ["src/service.ts"],
    )

    runner = GraphRunner(project_root)
    result = runner.analyze_history(count=1)

    assert result["status"] == "ok"
    assert result["analysis_mode"] == "retrospective_current_graph"
    assert len(result["commits"]) == 1
    assert result["commits"][0]["test_file_count"] == 1


def test_build_graph_auto_uses_builtin_cache(monkeypatch, tmp_path: Path):
    adapter = FakeAdapter()
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)
    cache_dir = tmp_path / ".routa-fitness"
    cache_dir.mkdir()
    (cache_dir / "index.json").write_text("{}", encoding="utf-8")

    runner = GraphRunner(tmp_path)
    result = runner.build_graph(build_mode="auto")

    assert result["status"] == "ok"
    assert adapter.build_calls == [{"full": False, "base": "HEAD"}]


def test_analyze_test_radius_propagates_local_changed_node_coverage(
    monkeypatch,
    tmp_path: Path,
):
    class PropagatingAdapter(FakeAdapter):
        def impact_radius(self, files: list[str], *, depth: int = 2) -> dict:
            self.impact_calls.append({"files": files, "depth": depth})
            return {
                "status": "ok",
                "summary": "impact ok",
                "changed_nodes": [
                    {
                        "qualified_name": "src.service.parent",
                        "name": "parent",
                        "kind": "Function",
                        "file_path": "src/service.ts",
                    },
                    {
                        "qualified_name": "src.service.child",
                        "name": "child",
                        "kind": "Function",
                        "file_path": "src/service.ts",
                    },
                ],
                "impacted_nodes": [],
                "impacted_files": ["src/service.test.ts"],
                "edges": [
                    {
                        "kind": "CALLS",
                        "source_qualified": "src.service.parent",
                        "target_qualified": "src.service.child",
                        "source_file": "src/service.ts",
                        "target_file": "src/service.ts",
                    }
                ],
            }

        def query(self, query_type: str, target: str) -> dict:
            self.query_calls.append({"query_type": query_type, "target": target})
            if target == "src.service.child":
                return {
                    "status": "ok",
                    "results": [
                        {
                            "qualified_name": "tests.service.test_child",
                            "name": "test_child",
                            "kind": "Function",
                            "file_path": "src/service.test.ts",
                            "is_test": True,
                        }
                    ],
                }
            return {"status": "ok", "results": []}

    adapter = PropagatingAdapter()
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "service.ts").write_text("export function parent() {}\n", encoding="utf-8")

    runner = GraphRunner(tmp_path)
    result = runner.analyze_test_radius(["src/service.ts"], build_mode="skip")

    parent = next(item for item in result["target_nodes"] if item["qualified_name"] == "src.service.parent")
    child = next(item for item in result["target_nodes"] if item["qualified_name"] == "src.service.child")

    assert child["tests_count"] == 1
    assert parent["tests_count"] == 0
    assert parent["inherited_tests_count"] == 1
    assert result["untested_targets"] == []


def test_select_query_targets_skips_nested_local_helpers(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: FakeAdapter())
    runner = GraphRunner(tmp_path)

    targets = runner._select_query_targets(
        [
            {
                "qualified_name": "src/service.ts:run",
                "name": "run",
                "kind": "Function",
                "file_path": "src/service.ts",
            },
            {
                "qualified_name": "src/service.ts:run.helper",
                "name": "helper",
                "kind": "Function",
                "file_path": "src/service.ts",
                "parent_name": "run",
            },
            {
                "qualified_name": "src/service.ts:Service",
                "name": "Service",
                "kind": "Class",
                "file_path": "src/service.ts",
            },
            {
                "qualified_name": "src/service.ts:Service.run",
                "name": "run",
                "kind": "Function",
                "file_path": "src/service.ts",
                "parent_name": "Service",
            },
        ],
        max_targets=10,
    )

    assert [item["qualified_name"] for item in targets] == [
        "src/service.ts:run",
        "src/service.ts:Service",
        "src/service.ts:Service.run",
    ]


def test_review_context_includes_guidance_and_source(monkeypatch, tmp_path: Path):
    adapter = FakeAdapter()
    project_root = tmp_path
    (project_root / "src").mkdir()
    (project_root / "src" / "service.ts").write_text(
        "export function run() {\n  return 1;\n}\n",
        encoding="utf-8",
    )
    (project_root / "src" / "service.test.ts").write_text(
        "test('run', () => {})\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(graph_module, "try_create_adapter", lambda _: adapter)

    runner = GraphRunner(project_root)
    result = runner.review_context(["src/service.ts"], build_mode="skip")

    assert result["status"] == "ok"
    assert "Review guidance:" in result["summary"]
    assert result["context"]["changed_files"] == ["src/service.ts"]
    assert result["context"]["tests"]["test_files"] == ["src/service.test.ts"]
    assert result["context"]["source_snippets"][0]["file_path"] == "src/service.ts"
    assert "lack direct or inherited tests" in result["context"]["review_guidance"]
