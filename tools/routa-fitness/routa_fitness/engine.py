"""Shared execution engine for fitness runs."""

from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path

from routa_fitness.governance import GovernancePolicy, filter_dimensions
from routa_fitness.loaders import load_dimensions
from routa_fitness.model import Dimension, FitnessReport, Metric
from routa_fitness.presets.base import ProjectPreset
from routa_fitness.runners.shell import ShellRunner
from routa_fitness.scoring import score_dimension, score_report


def collect_changed_files(project_root: Path, base: str) -> list[str]:
    """Collect changed files from git for incremental fitness runs."""
    from routa_fitness.presets import get_project_preset

    preset = get_project_preset()
    files: list[str] = []

    commands = [
        ["git", "diff", "--name-only", "--diff-filter=ACMR", base],
        ["git", "diff", "--name-only", "--diff-filter=ACMR"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]

    for command in commands:
        result = subprocess.run(
            command,
            cwd=project_root,
            capture_output=True,
            text=True,
            check=False,
        )
        files.extend(line.strip() for line in result.stdout.splitlines() if line.strip())

    seen: set[str] = set()
    deduped: list[str] = []
    for file_path in files:
        if preset.should_ignore_changed_file(file_path):
            continue
        if file_path not in seen:
            seen.add(file_path)
            deduped.append(file_path)
    return deduped


def matches_changed_files(
    metric: Metric,
    changed_files: list[str],
    domains: set[str],
    preset: ProjectPreset,
) -> bool:
    """Check whether a metric should run for a changed file set."""
    if metric.run_when_changed:
        return any(
            fnmatch.fnmatch(changed_file, pattern)
            for changed_file in changed_files
            for pattern in metric.run_when_changed
        )
    if not domains:
        return False
    if "config" in domains:
        return True
    metric_domains = preset.metric_domains(metric)
    return "global" in metric_domains or bool(metric_domains.intersection(domains))


def filter_dimensions_for_incremental(
    dimensions: list[Dimension],
    changed_files: list[str],
    domains: set[str],
    preset: ProjectPreset,
) -> list[Dimension]:
    """Return only dimensions with metrics relevant to the changed file set."""
    if not changed_files:
        return []
    if "config" in domains:
        return dimensions

    filtered_dimensions: list[Dimension] = []
    for dimension in dimensions:
        filtered_metrics = []
        for metric in dimension.metrics:
            if matches_changed_files(metric, changed_files, domains, preset):
                filtered_metrics.append(metric)
        if filtered_metrics:
            filtered_dimensions.append(
                Dimension(
                    name=dimension.name,
                    weight=dimension.weight,
                    threshold_pass=dimension.threshold_pass,
                    threshold_warn=dimension.threshold_warn,
                    metrics=filtered_metrics,
                    source_file=dimension.source_file,
                )
            )
    return filtered_dimensions


def run_fitness_report(
    project_root: Path,
    policy: GovernancePolicy,
    preset: ProjectPreset,
    *,
    changed_files: list[str] | None = None,
    base: str = "HEAD",
) -> tuple[FitnessReport, list[Dimension]]:
    """Execute a fitness run and return report plus the selected dimensions."""
    dimensions = filter_dimensions(load_dimensions(preset.fitness_dir(project_root)), policy)

    runner_env: dict[str, str] = {}
    effective_changed_files = changed_files or []
    if effective_changed_files:
        changed_domains = preset.domains_from_files(effective_changed_files)
        dimensions = filter_dimensions_for_incremental(
            dimensions,
            effective_changed_files,
            changed_domains,
            preset,
        )
        runner_env = {
            "ROUTA_FITNESS_CHANGED_ONLY": "1",
            "ROUTA_FITNESS_CHANGED_BASE": base,
            "ROUTA_FITNESS_CHANGED_FILES": "\n".join(effective_changed_files),
        }

    runner = ShellRunner(project_root, env_overrides=runner_env)
    dimension_scores = []
    for dim in dimensions:
        results = runner.run_batch(
            dim.metrics,
            parallel=policy.parallel,
            dry_run=policy.dry_run,
        )
        dimension_scores.append(score_dimension(results, dim.name, dim.weight))

    return score_report(dimension_scores, min_score=policy.min_score), dimensions
