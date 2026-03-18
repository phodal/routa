"""Built-in structural analyzer with lightweight source scanning.

This backend intentionally favors zero external dependencies over perfect
precision. It builds a small persistent graph from repository source files,
tracking:

- file nodes
- top-level symbols (functions, classes, interfaces, enums)
- relative import relationships
- containment relationships
- heuristic test-to-code links

The result is good enough for blast-radius and test-radius estimation when
`code-review-graph` is unavailable.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from routa_fitness.structure.impact import (
    classify_test_file,
    filter_code_files,
    git_changed_files,
)


_CACHE_VERSION = 1
_CACHE_DIR = ".routa-fitness"
_CACHE_FILE = "graph.json"
_SCAN_ROOTS = ("src", "apps", "crates")
_CODE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".py",
    ".go",
    ".java",
    ".kt",
    ".swift",
    ".php",
    ".c",
    ".cpp",
}
_IDENTIFIER_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
_TEST_CALL_RE = re.compile(r"""\b(?:test|it)\s*\(\s*['"]([^'"]+)['"]""")
_PY_TEST_DECORATOR_RE = re.compile(r"^\s*@pytest\.mark")

_LANGUAGE_BY_SUFFIX = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".rs": "rust",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
}

_DECLARATION_PATTERNS = {
    "typescript": [
        ("Class", re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Interface", re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Enum", re.compile(r"^\s*(?:export\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)")),
        (
            "Function",
            re.compile(
                r"^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>"
            ),
        ),
    ],
    "tsx": [
        ("Class", re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Interface", re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Enum", re.compile(r"^\s*(?:export\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)")),
        (
            "Function",
            re.compile(
                r"^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>"
            ),
        ),
    ],
    "javascript": [
        ("Class", re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)")),
        (
            "Function",
            re.compile(
                r"^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>"
            ),
        ),
    ],
    "python": [
        ("Class", re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)")),
    ],
    "rust": [
        ("Struct", re.compile(r"^\s*(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Enum", re.compile(r"^\s*(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Trait", re.compile(r"^\s*(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)")),
    ],
    "go": [
        ("Struct", re.compile(r"^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct\b")),
        ("Interface", re.compile(r"^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+interface\b")),
        ("Function", re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(")),
    ],
    "java": [
        ("Class", re.compile(r"^\s*(?:public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Interface", re.compile(r"^\s*(?:public\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Enum", re.compile(r"^\s*(?:public\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)")),
    ],
    "kotlin": [
        ("Class", re.compile(r"^\s*(?:data\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Interface", re.compile(r"^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Enum", re.compile(r"^\s*enum\s+class\s+([A-Za-z_][A-Za-z0-9_]*)")),
        ("Function", re.compile(r"^\s*fun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")),
    ],
}

_IMPORT_PATTERNS = {
    "typescript": [
        re.compile(r"""from\s+['"]([^'"]+)['"]"""),
        re.compile(r"""import\s+['"]([^'"]+)['"]"""),
    ],
    "tsx": [
        re.compile(r"""from\s+['"]([^'"]+)['"]"""),
        re.compile(r"""import\s+['"]([^'"]+)['"]"""),
    ],
    "javascript": [
        re.compile(r"""from\s+['"]([^'"]+)['"]"""),
        re.compile(r"""import\s+['"]([^'"]+)['"]"""),
    ],
    "python": [
        re.compile(r"^\s*from\s+(\.[A-Za-z0-9_\.]+)\s+import\b", re.MULTILINE),
    ],
}

_EXTENDS_PATTERNS = {
    "typescript": re.compile(r"\bextends\s+([A-Za-z_][A-Za-z0-9_]*)"),
    "tsx": re.compile(r"\bextends\s+([A-Za-z_][A-Za-z0-9_]*)"),
    "javascript": re.compile(r"\bextends\s+([A-Za-z_][A-Za-z0-9_]*)"),
    "python": re.compile(r"^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\(([^)]*)\)", re.MULTILINE),
    "java": re.compile(r"\bextends\s+([A-Za-z_][A-Za-z0-9_]*)"),
    "kotlin": re.compile(r":\s*([A-Za-z_][A-Za-z0-9_]*)"),
}

_KEYWORDS = {
    "return",
    "const",
    "class",
    "function",
    "export",
    "import",
    "from",
    "async",
    "await",
    "public",
    "private",
    "protected",
    "struct",
    "enum",
    "trait",
    "impl",
    "let",
    "var",
    "type",
    "interface",
    "package",
    "new",
    "this",
    "self",
    "super",
    "true",
    "false",
    "null",
    "None",
    "Some",
    "Ok",
    "Err",
}


class BuiltinGraphAdapter:
    """Zero-dependency structural analyzer backed by a JSON cache."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.cache_dir = repo_root / _CACHE_DIR
        self.cache_path = self.cache_dir / _CACHE_FILE
        self._data: dict[str, Any] | None = None
        self._graph: dict[str, Any] | None = None

    def build_or_update(self, *, full: bool = False, base: str = "HEAD~1") -> dict:
        """Build or incrementally update the lightweight graph cache."""
        existing = self._load_data()
        current_files = self._collect_source_files()
        current_set = set(current_files)
        stale_files = sorted(set(existing.get("files", {})) - current_set)

        if full or not existing.get("files"):
            files_to_parse = current_files
            build_type = "full"
            changed_files = current_files
        else:
            changed_files = filter_code_files(git_changed_files(self.repo_root, base), self.repo_root)
            files_to_parse = sorted(set(changed_files) | set(stale_files))
            build_type = "incremental"

        files_map = dict(existing.get("files", {}))
        for stale in stale_files:
            files_map.pop(stale, None)

        parsed = 0
        for rel_path in files_to_parse:
            abs_path = self.repo_root / rel_path
            if not abs_path.exists():
                files_map.pop(rel_path, None)
                continue
            files_map[rel_path] = self._parse_file(rel_path, abs_path.read_text(encoding="utf-8", errors="replace"))
            parsed += 1

        data = {
            "version": _CACHE_VERSION,
            "repo_root": str(self.repo_root),
            "files": files_map,
            "metadata": {
                "last_updated": self._timestamp(),
                "last_build_type": build_type,
            },
        }
        self._persist_data(data)
        graph = self._build_graph(data)
        self._graph = graph

        return {
            "status": "ok",
            "build_type": build_type,
            "summary": (
                f"{build_type.capitalize()} build: parsed {parsed} file(s), "
                f"{graph['stats']['total_nodes']} nodes, {graph['stats']['total_edges']} edges."
            ),
            "files_parsed": parsed if build_type == "full" else len(current_files),
            "files_updated": parsed,
            "changed_files": changed_files,
            "stale_files": stale_files,
            "total_nodes": graph["stats"]["total_nodes"],
            "total_edges": graph["stats"]["total_edges"],
            "languages": graph["stats"]["languages"],
        }

    def impact_radius(self, files: list[str], *, depth: int = 2) -> dict:
        """Compute blast radius using file dependency neighborhoods."""
        graph = self._ensure_graph()
        changed_files = [path for path in files if path in graph["file_nodes"]]
        if not changed_files:
            return {
                "status": "ok",
                "summary": "No changed files detected.",
                "changed_nodes": [],
                "impacted_nodes": [],
                "impacted_files": [],
                "edges": [],
            }

        visited = set(changed_files)
        queue = deque((path, 0) for path in changed_files)
        while queue:
            current, hops = queue.popleft()
            if hops >= depth:
                continue
            for neighbor in sorted(graph["file_neighbors"].get(current, set())):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, hops + 1))

        impacted_files = sorted(visited - set(changed_files))
        visible_files = set(changed_files) | set(impacted_files)
        visible_edges = [
            edge
            for edge in graph["edges"]
            if edge["source_file"] in visible_files and edge["target_file"] in visible_files
        ]

        return {
            "status": "ok",
            "summary": (
                f"Blast radius for {len(changed_files)} changed file(s): "
                f"{len(changed_files)} changed file node(s), "
                f"{len(impacted_files)} additional file(s)."
            ),
            "changed_nodes": self._nodes_for_files(graph, changed_files),
            "impacted_nodes": self._nodes_for_files(graph, impacted_files),
            "impacted_files": impacted_files,
            "edges": visible_edges,
        }

    def query(self, query_type: str, target: str) -> dict:
        """Run a structural query against the lightweight graph."""
        graph = self._ensure_graph()
        node = self._resolve_target(graph, target)

        if query_type == "file_summary":
            rel_path = self._resolve_file_target(graph, target)
            if not rel_path:
                return {"status": "not_found", "summary": f"No file found matching '{target}'."}
            results = [graph["file_nodes"][rel_path], *graph["symbols_by_file"].get(rel_path, [])]
            return self._query_result(query_type, target, results, [])

        if not node:
            return {"status": "not_found", "summary": f"No node found matching '{target}'."}

        if query_type == "tests_for":
            test_nodes, edges = self._tests_for(graph, node)
            return self._query_result(query_type, target, test_nodes, edges)
        if query_type == "callers_of":
            results, edges = self._callers_of(graph, node)
            return self._query_result(query_type, target, results, edges)
        if query_type == "callees_of":
            results, edges = self._callees_of(graph, node)
            return self._query_result(query_type, target, results, edges)
        if query_type == "imports_of":
            results, edges = self._imports_of(graph, node)
            return self._query_result(query_type, target, results, edges)
        if query_type == "importers_of":
            results, edges = self._importers_of(graph, node)
            return self._query_result(query_type, target, results, edges)
        if query_type == "children_of":
            results, edges = self._children_of(graph, node)
            return self._query_result(query_type, target, results, edges)
        if query_type == "inheritors_of":
            results, edges = self._inheritors_of(graph, node)
            return self._query_result(query_type, target, results, edges)

        return {"status": "error", "summary": f"Unknown query type '{query_type}'."}

    def stats(self) -> dict:
        """Return aggregate graph statistics."""
        graph = self._ensure_graph()
        return {
            "status": "ok",
            "nodes": graph["stats"]["total_nodes"],
            "edges": graph["stats"]["total_edges"],
            "files": graph["stats"]["files_count"],
            "languages": graph["stats"]["languages"],
            "last_updated": graph["stats"]["last_updated"],
            "backend": "builtin",
        }

    def _load_data(self) -> dict[str, Any]:
        if self._data is not None:
            return self._data
        if self.cache_path.exists():
            self._data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if self._data.get("version") != _CACHE_VERSION:
                self._data = {"version": _CACHE_VERSION, "files": {}, "metadata": {}}
        else:
            self._data = {"version": _CACHE_VERSION, "files": {}, "metadata": {}}
        return self._data

    def _persist_data(self, data: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        self._data = data

    def _ensure_graph(self) -> dict[str, Any]:
        if self._graph is not None:
            return self._graph
        self._graph = self._build_graph(self._load_data())
        return self._graph

    def _collect_source_files(self) -> list[str]:
        files: list[str] = []
        for root_name in _SCAN_ROOTS:
            root = self.repo_root / root_name
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                if path.suffix.lower() not in _CODE_EXTENSIONS:
                    continue
                files.append(path.relative_to(self.repo_root).as_posix())
        return sorted(files)

    def _parse_file(self, rel_path: str, source: str) -> dict[str, Any]:
        language = _LANGUAGE_BY_SUFFIX.get(Path(rel_path).suffix.lower(), "unknown")
        is_test_file = classify_test_file(rel_path)
        lines = source.splitlines()
        imports = self._resolve_imports(rel_path, source, language)
        symbols = self._extract_symbols(rel_path, lines, language, is_test_file)

        return {
            "language": language,
            "is_test_file": is_test_file,
            "imports": imports,
            "symbols": symbols,
            "references": self._extract_identifiers(source),
            "source_basename": self._normalized_source_basename(rel_path),
        }

    def _extract_symbols(
        self, rel_path: str, lines: list[str], language: str, is_test_file: bool
    ) -> list[dict[str, Any]]:
        patterns = _DECLARATION_PATTERNS.get(language, [])
        symbols: list[dict[str, Any]] = []

        pending_test_attr = False
        for index, line in enumerate(lines):
            if language == "rust" and line.strip().startswith("#[test]"):
                pending_test_attr = True
                continue
            if language == "python" and _PY_TEST_DECORATOR_RE.match(line):
                pending_test_attr = True
                continue

            for kind, pattern in patterns:
                match = pattern.search(line)
                if not match:
                    continue
                name = match.group(1)
                line_end = self._find_block_end(lines, index, language)
                body = "\n".join(lines[index:line_end])
                is_test = is_test_file or pending_test_attr or self._looks_like_test_name(name)
                symbol = {
                    "qualified_name": f"{rel_path}:{name}",
                    "name": name,
                    "kind": kind,
                    "file_path": rel_path,
                    "line_start": index + 1,
                    "line_end": line_end,
                    "language": language,
                    "is_test": is_test,
                    "references": self._extract_identifiers(body),
                    "extends": self._extract_extends(language, line),
                }
                symbols.append(symbol)
                pending_test_attr = False
                break
            else:
                pending_test_attr = False

            if is_test_file:
                test_match = _TEST_CALL_RE.search(line)
                if not test_match:
                    continue
                label = test_match.group(1).strip()
                symbols.append(
                    {
                        "qualified_name": f"{rel_path}:test:{index + 1}",
                        "name": label,
                        "kind": "Test",
                        "file_path": rel_path,
                        "line_start": index + 1,
                        "line_end": index + 1,
                        "language": language,
                        "is_test": True,
                        "references": self._extract_identifiers(label),
                        "extends": "",
                    }
                )

        return symbols

    def _find_block_end(self, lines: list[str], start: int, language: str) -> int:
        if language == "python":
            start_indent = self._indent(lines[start])
            for idx in range(start + 1, len(lines)):
                text = lines[idx]
                if not text.strip():
                    continue
                if self._indent(text) <= start_indent and not text.lstrip().startswith(("#", "@")):
                    return idx
            return len(lines)

        brace_depth = 0
        opened = False
        for idx in range(start, len(lines)):
            text = lines[idx]
            brace_depth += text.count("{")
            if text.count("{") > 0:
                opened = True
            brace_depth -= text.count("}")
            if opened and brace_depth <= 0:
                return idx + 1
        return min(len(lines), start + 1)

    def _resolve_imports(self, rel_path: str, source: str, language: str) -> list[str]:
        patterns = _IMPORT_PATTERNS.get(language, [])
        imports: set[str] = set()
        for pattern in patterns:
            for match in pattern.findall(source):
                import_path = match if isinstance(match, str) else match[0]
                resolved = self._resolve_import_path(rel_path, import_path)
                if resolved:
                    imports.add(resolved)
        return sorted(imports)

    def _resolve_import_path(self, rel_path: str, import_path: str) -> str | None:
        if not import_path.startswith("."):
            return None
        base_dir = (self.repo_root / rel_path).parent
        leading_dots = len(import_path) - len(import_path.lstrip("."))
        relative_part = import_path.lstrip(".").replace(".", "/")
        anchor = base_dir
        for _ in range(max(leading_dots - 1, 0)):
            anchor = anchor.parent
        candidate = (anchor / relative_part).resolve() if relative_part else anchor.resolve()
        suffix = Path(rel_path).suffix.lower()
        extensions = [suffix] if suffix else []
        extensions.extend([".ts", ".tsx", ".js", ".jsx", ".py", ".rs"])

        candidates = [candidate]
        if candidate.suffix:
            candidates = [candidate]
        else:
            candidates.extend(candidate.with_suffix(ext) for ext in extensions)
            candidates.extend(candidate / f"index{ext}" for ext in extensions)

        for path in candidates:
            try:
                relative = path.relative_to(self.repo_root).as_posix()
            except ValueError:
                continue
            if path.exists() and path.is_file():
                return relative
        return None

    def _build_graph(self, data: dict[str, Any]) -> dict[str, Any]:
        file_records = data.get("files", {})
        file_nodes: dict[str, dict[str, Any]] = {}
        symbols_by_file: dict[str, list[dict[str, Any]]] = {}
        nodes_by_qn: dict[str, dict[str, Any]] = {}
        symbols_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
        edges: list[dict[str, Any]] = []
        file_neighbors: dict[str, set[str]] = defaultdict(set)
        tests_for_target: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for rel_path, record in file_records.items():
            file_node = {
                "qualified_name": rel_path,
                "name": Path(rel_path).name,
                "kind": "File",
                "file_path": rel_path,
                "language": record.get("language", "unknown"),
                "is_test": record.get("is_test_file", False),
            }
            file_nodes[rel_path] = file_node
            nodes_by_qn[rel_path] = file_node

            symbols = []
            for symbol in record.get("symbols", []):
                normalized = dict(symbol)
                symbols.append(normalized)
                nodes_by_qn[normalized["qualified_name"]] = normalized
                symbols_by_name[normalized["name"]].append(normalized)
                edges.append(
                    self._edge(
                        "CONTAINS",
                        source=file_node["qualified_name"],
                        target=normalized["qualified_name"],
                        source_file=rel_path,
                        target_file=rel_path,
                    )
                )
            symbols_by_file[rel_path] = symbols

        for rel_path, record in file_records.items():
            for target_file in record.get("imports", []):
                if target_file not in file_nodes:
                    continue
                edges.append(
                    self._edge(
                        "IMPORTS_FROM",
                        source=rel_path,
                        target=target_file,
                        source_file=rel_path,
                        target_file=target_file,
                    )
                )
                file_neighbors[rel_path].add(target_file)
                file_neighbors[target_file].add(rel_path)

        for rel_path, symbols in symbols_by_file.items():
            for symbol in symbols:
                parent = symbol.get("extends")
                if not parent:
                    continue
                for candidate in symbols_by_name.get(parent, []):
                    if candidate["qualified_name"] == symbol["qualified_name"]:
                        continue
                    edges.append(
                        self._edge(
                            "INHERITS",
                            source=symbol["qualified_name"],
                            target=candidate["qualified_name"],
                            source_file=rel_path,
                            target_file=candidate["file_path"],
                        )
                    )
                    file_neighbors[rel_path].add(candidate["file_path"])
                    file_neighbors[candidate["file_path"]].add(rel_path)

        for rel_path, symbols in symbols_by_file.items():
            record = file_records[rel_path]
            if not record.get("is_test_file") and not any(node.get("is_test") for node in symbols):
                continue
            linked_targets = self._target_nodes_for_test_file(rel_path, record, file_records, symbols_by_name, symbols_by_file)
            test_nodes = [node for node in symbols if node.get("is_test")] or [file_nodes[rel_path]]
            for target in linked_targets:
                for test_node in test_nodes:
                    edge = self._edge(
                        "TESTED_BY",
                        source=test_node["qualified_name"],
                        target=target["qualified_name"],
                        source_file=rel_path,
                        target_file=target["file_path"],
                    )
                    edges.append(edge)
                    tests_for_target[target["qualified_name"]].append(test_node)
                    file_neighbors[rel_path].add(target["file_path"])
                    file_neighbors[target["file_path"]].add(rel_path)

        graph = {
            "file_nodes": file_nodes,
            "symbols_by_file": symbols_by_file,
            "nodes_by_qn": nodes_by_qn,
            "symbols_by_name": symbols_by_name,
            "edges": edges,
            "file_neighbors": file_neighbors,
            "tests_for_target": tests_for_target,
            "stats": {
                "total_nodes": len(file_nodes) + sum(len(symbols) for symbols in symbols_by_file.values()),
                "total_edges": len(edges),
                "files_count": len(file_nodes),
                "languages": sorted({record.get("language", "unknown") for record in file_records.values()}),
                "last_updated": data.get("metadata", {}).get("last_updated", ""),
            },
        }
        return graph

    def _target_nodes_for_test_file(
        self,
        rel_path: str,
        record: dict[str, Any],
        file_records: dict[str, Any],
        symbols_by_name: dict[str, list[dict[str, Any]]],
        symbols_by_file: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        targets: dict[str, dict[str, Any]] = {}

        for imported in record.get("imports", []):
            for symbol in symbols_by_file.get(imported, []):
                if not symbol.get("is_test"):
                    targets[symbol["qualified_name"]] = symbol

        basename = record.get("source_basename", "")
        if basename:
            for source_path, source_record in file_records.items():
                if source_path == rel_path or source_record.get("is_test_file"):
                    continue
                if source_record.get("source_basename") == basename:
                    for symbol in symbols_by_file.get(source_path, []):
                        targets[symbol["qualified_name"]] = symbol

        for test_node in symbols_by_file.get(rel_path, []):
            if not test_node.get("is_test"):
                continue
            normalized = self._normalize_test_name(test_node["name"])
            for symbol_name, candidates in symbols_by_name.items():
                if self._normalized_symbol_name(symbol_name) and self._normalized_symbol_name(symbol_name) in normalized:
                    for candidate in candidates:
                        if not candidate.get("is_test"):
                            targets[candidate["qualified_name"]] = candidate

        return sorted(targets.values(), key=lambda item: item["qualified_name"])

    def _tests_for(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        targets = []
        if node["kind"] == "File":
            for symbol in graph["symbols_by_file"].get(node["file_path"], []):
                targets.append(symbol["qualified_name"])
        else:
            targets.append(node["qualified_name"])

        results: dict[str, dict[str, Any]] = {}
        result_edges: list[dict[str, Any]] = []
        for edge in graph["edges"]:
            if edge["kind"] != "TESTED_BY" or edge["target_qualified"] not in targets:
                continue
            test_node = graph["nodes_by_qn"].get(edge["source_qualified"])
            if test_node:
                results[test_node["qualified_name"]] = test_node
                result_edges.append(edge)
        return sorted(results.values(), key=lambda item: item["qualified_name"]), result_edges

    def _callers_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        symbol_name = node["name"]
        results = {}
        edges = []
        for file_path, symbols in graph["symbols_by_file"].items():
            for symbol in symbols:
                if symbol["qualified_name"] == node["qualified_name"]:
                    continue
                if symbol_name in symbol.get("references", []):
                    results[symbol["qualified_name"]] = symbol
                    edges.append(
                        self._edge(
                            "CALLS",
                            source=symbol["qualified_name"],
                            target=node["qualified_name"],
                            source_file=file_path,
                            target_file=node["file_path"],
                        )
                    )
        return sorted(results.values(), key=lambda item: item["qualified_name"]), edges

    def _callees_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        references = set(node.get("references", []))
        results = {}
        edges = []
        for name in references:
            for candidate in graph["symbols_by_name"].get(name, []):
                if candidate["qualified_name"] == node["qualified_name"]:
                    continue
                results[candidate["qualified_name"]] = candidate
                edges.append(
                    self._edge(
                        "CALLS",
                        source=node["qualified_name"],
                        target=candidate["qualified_name"],
                        source_file=node["file_path"],
                        target_file=candidate["file_path"],
                    )
                )
        return sorted(results.values(), key=lambda item: item["qualified_name"]), edges

    def _imports_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        results = []
        edges = []
        for edge in graph["edges"]:
            if edge["kind"] == "IMPORTS_FROM" and edge["source_qualified"] == file_path:
                target = graph["file_nodes"].get(edge["target_qualified"])
                if target:
                    results.append(target)
                    edges.append(edge)
        return results, edges

    def _importers_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        results = []
        edges = []
        for edge in graph["edges"]:
            if edge["kind"] == "IMPORTS_FROM" and edge["target_qualified"] == file_path:
                source = graph["file_nodes"].get(edge["source_qualified"])
                if source:
                    results.append(source)
                    edges.append(edge)
        return results, edges

    def _children_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        results = list(graph["symbols_by_file"].get(file_path, []))
        edges = [
            edge
            for edge in graph["edges"]
            if edge["kind"] == "CONTAINS" and edge["source_qualified"] == file_path
        ]
        return results, edges

    def _inheritors_of(self, graph: dict[str, Any], node: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        results = []
        edges = []
        for edge in graph["edges"]:
            if edge["kind"] == "INHERITS" and edge["target_qualified"] == node["qualified_name"]:
                child = graph["nodes_by_qn"].get(edge["source_qualified"])
                if child:
                    results.append(child)
                    edges.append(edge)
        return results, edges

    def _nodes_for_files(self, graph: dict[str, Any], files: list[str]) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for file_path in files:
            nodes.extend(graph["symbols_by_file"].get(file_path, []))
        return nodes

    def _resolve_target(self, graph: dict[str, Any], target: str) -> dict[str, Any] | None:
        if target in graph["nodes_by_qn"]:
            return graph["nodes_by_qn"][target]
        rel_file = self._resolve_file_target(graph, target)
        if rel_file:
            return graph["file_nodes"][rel_file]
        candidates = graph["symbols_by_name"].get(target, [])
        if len(candidates) == 1:
            return candidates[0]
        return None

    def _resolve_file_target(self, graph: dict[str, Any], target: str) -> str | None:
        if target in graph["file_nodes"]:
            return target
        normalized = target.removeprefix(str(self.repo_root)).lstrip("/")
        if normalized in graph["file_nodes"]:
            return normalized
        return None

    def _query_result(
        self,
        query_type: str,
        target: str,
        results: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "status": "ok",
            "pattern": query_type,
            "target": target,
            "summary": f"Found {len(results)} result(s) for {query_type}('{target}')",
            "results": results,
            "edges": edges,
        }

    def _edge(
        self,
        kind: str,
        *,
        source: str,
        target: str,
        source_file: str,
        target_file: str,
    ) -> dict[str, Any]:
        return {
            "kind": kind,
            "source_qualified": source,
            "target_qualified": target,
            "file_path": source_file,
            "source_file": source_file,
            "target_file": target_file,
        }

    def _extract_identifiers(self, source: str) -> list[str]:
        identifiers = {token for token in _IDENTIFIER_RE.findall(source) if token not in _KEYWORDS}
        return sorted(identifiers)

    def _extract_extends(self, language: str, line: str) -> str:
        pattern = _EXTENDS_PATTERNS.get(language)
        if not pattern:
            return ""
        match = pattern.search(line)
        if not match:
            return ""
        text = match.group(1).split(",")[0].strip()
        return text.split(".")[-1]

    def _looks_like_test_name(self, name: str) -> bool:
        lowered = name.lower()
        return lowered.startswith("test") or lowered.endswith("test")

    def _normalize_test_name(self, name: str) -> str:
        lowered = name.lower()
        lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
        lowered = lowered.replace("test", " ")
        return " ".join(part for part in lowered.split() if part)

    def _normalized_symbol_name(self, name: str) -> str:
        lowered = re.sub(r"[^a-z0-9]+", " ", name.lower())
        return " ".join(part for part in lowered.split() if part)

    def _normalized_source_basename(self, rel_path: str) -> str:
        name = Path(rel_path).name
        name = re.sub(r"(\.test|\.spec|_test|_spec)(?=\.)", "", name)
        for suffix in Path(rel_path).suffixes:
            if name.endswith(suffix):
                name = name[: -len(suffix)]
        return name

    def _indent(self, line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
