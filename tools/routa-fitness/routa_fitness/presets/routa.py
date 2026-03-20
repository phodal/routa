"""Routa-specific preset for path roots and domain inference."""

from __future__ import annotations

from pathlib import Path

from routa_fitness.model import Metric


class RoutaPreset:
    """Repository-specific behavior for the Routa monorepo."""

    def fitness_dir(self, project_root: Path) -> Path:
        return project_root / "docs" / "fitness"

    def review_trigger_config(self, project_root: Path) -> Path:
        return self.fitness_dir(project_root) / "review-triggers.yaml"

    def should_ignore_changed_file(self, file_path: str) -> bool:
        return file_path.startswith(
            (
                "tmp/",
                "docs/",
                ".routa-fitness/",
                ".code-review-graph/",
                "node_modules/",
            )
        )

    def domains_from_files(self, files: list[str]) -> set[str]:
        domains: set[str] = set()
        config_files = {
            "package.json",
            "package-lock.json",
            "Cargo.toml",
            "Cargo.lock",
            "api-contract.yaml",
            "eslint.config.mjs",
            "tsconfig.json",
            "pyproject.toml",
            "tools/routa-fitness/file_budgets.json",
        }
        for file_path in files:
            suffix = Path(file_path).suffix.lower()
            name = Path(file_path).name
            lowered = file_path.lower()
            if suffix == ".rs" or lowered.startswith("crates/"):
                domains.add("rust")
            if suffix in {".ts", ".tsx", ".js", ".jsx", ".css", ".scss"} or lowered.startswith(
                ("src/", "apps/")
            ):
                domains.add("web")
            if suffix == ".py" or lowered.startswith("tools/routa-fitness/"):
                domains.add("python")
            if file_path in config_files or name in config_files:
                domains.add("config")
        return domains

    def metric_domains(self, metric: Metric) -> set[str]:
        if metric.scope:
            return set(metric.scope)

        command = metric.command.lower()
        domains: set[str] = set()

        if "cargo " in command or "clippy" in command or "rust" in command:
            domains.add("rust")
        if any(
            token in command
            for token in (
                "npm ",
                "npx ",
                "eslint",
                "vitest",
                "playwright",
                "jscpd",
                "dependency-cruiser",
                "ast-grep",
                " semgrep",
                "semgrep ",
            )
        ):
            domains.add("web")
        if "python" in command or "pytest" in command or "routa_fitness" in command:
            domains.add("python")
        if "audit" in command:
            domains.add("config")

        if not domains:
            domains.add("global")
        return domains
