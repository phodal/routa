"""Preset protocol for repository-specific fitness behavior."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from routa_fitness.model import Metric


class ProjectPreset(Protocol):
    """Repository-specific hooks that customize fitness behavior."""

    def fitness_dir(self, project_root: Path) -> Path:
        """Return the default fitness directory for this project."""

    def review_trigger_config(self, project_root: Path) -> Path:
        """Return the default review-trigger config path for this project."""

    def should_ignore_changed_file(self, file_path: str) -> bool:
        """Return True when a changed file should be excluded from incremental fitness logic."""

    def domains_from_files(self, files: list[str]) -> set[str]:
        """Infer changed domains from file paths."""

    def metric_domains(self, metric: Metric) -> set[str]:
        """Infer metric domains for fallback change matching."""
