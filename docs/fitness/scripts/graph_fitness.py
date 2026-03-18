#!/usr/bin/env python3
"""
Graph-backed fitness probe for Routa.

This is a spike helper that adapts code-review-graph output into plain text
metrics that docs/fitness/scripts/fitness.py can consume with regex patterns.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
GRAPH_DB = ".code-review-graph/graph.db"
CODE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".java", ".kt", ".swift", ".php", ".c", ".cpp"}


def load_code_review_graph() -> tuple[object, object]:
    source = os.environ.get("ROUTA_CODE_REVIEW_GRAPH_SOURCE")
    if source:
        sys.path.insert(0, source)

    from code_review_graph.tools import build_or_update_graph, get_impact_radius

    return build_or_update_graph, get_impact_radius


def emit_skipped(reason: str) -> int:
    print(f"graph_probe_status: skipped reason={reason}")
    print("graph_changed_files: 0")
    print("graph_impacted_files: 0")
    print("graph_impacted_test_files: 0")
    print("graph_wide_blast_radius: skipped")
    return 0


def git_changed_files(base: str) -> list[str]:
    diff_cmd = ["git", "diff", "--name-only", "--diff-filter=ACMR", base, "--", "src", "apps", "crates"]
    result = subprocess.run(diff_cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    files = [line.strip() for line in result.stdout.splitlines() if line.strip()]

    unstaged_cmd = ["git", "diff", "--name-only", "--diff-filter=ACMR", "--", "src", "apps", "crates"]
    unstaged = subprocess.run(unstaged_cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    files.extend(line.strip() for line in unstaged.stdout.splitlines() if line.strip())

    untracked_cmd = ["git", "ls-files", "--others", "--exclude-standard", "src", "apps", "crates"]
    untracked = subprocess.run(untracked_cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    files.extend(line.strip() for line in untracked.stdout.splitlines() if line.strip())

    deduped: list[str] = []
    seen: set[str] = set()
    for file_path in files:
      if file_path in seen:
          continue
      seen.add(file_path)
      deduped.append(file_path)
    return deduped


def filter_code_files(files: list[str]) -> list[str]:
    kept: list[str] = []
    for rel in files:
        if Path(rel).suffix.lower() not in CODE_EXTENSIONS:
            continue
        if (REPO_ROOT / rel).exists():
            kept.append(rel)
    return kept


def classify_test_file(file_path: str) -> bool:
    lowered = file_path.lower()
    return (
        "/tests/" in lowered
        or "/__tests__/" in lowered
        or ".test." in lowered
        or ".spec." in lowered
        or lowered.endswith("_test.rs")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe change impact via code-review-graph")
    parser.add_argument("--base", default="HEAD", help="Git diff base to inspect")
    parser.add_argument("--max-depth", type=int, default=2, help="Graph traversal depth")
    parser.add_argument("--max-impacted-files", type=int, default=200, help="Warn threshold for impacted files")
    parser.add_argument("--build-mode", choices=["auto", "full"], default="auto")
    parser.add_argument(
        "--require-graph",
        action="store_true",
        help="Fail instead of skipping when code-review-graph is unavailable",
    )
    args = parser.parse_args()

    try:
        build_or_update_graph, get_impact_radius = load_code_review_graph()
    except Exception as exc:
        if args.require_graph:
            print(f"graph_probe_status: blocked import_error={type(exc).__name__}")
            print("graph_changed_files: 0")
            print("graph_impacted_files: 0")
            print("graph_impacted_test_files: 0")
            print("graph_wide_blast_radius: unknown")
            return 1
        return emit_skipped(f"import_error={type(exc).__name__}")

    changed_files = filter_code_files(git_changed_files(args.base))
    if not changed_files:
        print("graph_probe_status: ok")
        print("graph_changed_files: 0")
        print("graph_impacted_files: 0")
        print("graph_impacted_test_files: 0")
        print("graph_wide_blast_radius: no")
        return 0

    build_kwargs = {
        "repo_root": str(REPO_ROOT),
        "base": args.base,
        "full_rebuild": args.build_mode == "full" or not (REPO_ROOT / GRAPH_DB).exists(),
    }
    try:
        build_result = build_or_update_graph(**build_kwargs)
        impact = get_impact_radius(
            changed_files=changed_files,
            max_depth=args.max_depth,
            repo_root=str(REPO_ROOT),
            base=args.base,
        )
    except Exception as exc:
        if args.require_graph:
            print(f"graph_probe_status: blocked runtime_error={type(exc).__name__}")
            print(f"graph_changed_files: {len(changed_files)}")
            print("graph_impacted_files: 0")
            print("graph_impacted_test_files: 0")
            print("graph_wide_blast_radius: unknown")
            return 1
        return emit_skipped(f"runtime_error={type(exc).__name__}")

    impacted_files = impact.get("impacted_files", [])
    impacted_test_files = [path for path in impacted_files if classify_test_file(path)]
    wide_blast_radius = "yes" if len(impacted_files) > args.max_impacted_files else "no"

    print(f"graph_probe_status: {impact.get('status', 'unknown')}")
    print(f"graph_build_type: {build_result.get('build_type', 'unknown')}")
    print(f"graph_changed_files: {len(changed_files)}")
    print(f"graph_impacted_files: {len(impacted_files)}")
    print(f"graph_impacted_test_files: {len(impacted_test_files)}")
    print(f"graph_wide_blast_radius: {wide_blast_radius}")

    if impacted_files:
        sample = ",".join(Path(path).name for path in impacted_files[:5])
        print(f"graph_impacted_sample: {sample}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
