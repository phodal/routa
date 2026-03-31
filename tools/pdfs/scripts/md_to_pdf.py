#!/usr/bin/env python3
"""Convert Markdown to PDF using Pandoc.

Pandoc gives you a very productive "doc-like" pipeline with citations, math, and templates.

Examples:
  python md_to_pdf.py report.md --output report.pdf
  python md_to_pdf.py report.md -o report.pdf --pdf_engine xelatex
  python md_to_pdf.py report.md -o report.pdf --template template.tex

Tips:
- Use `--resource_path` so relative image paths resolve.
- For LaTeX-heavy docs, consider writing LaTeX directly (see latex_to_pdf.py).
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
import shutil


SAFE_PANDOC_ENGINES = {
    "pdflatex",
    "xelatex",
    "lualatex",
    "tectonic",
    "weasyprint",
    "wkhtmltopdf",
    "prince",
}


def _resolve_input_file(value: str, description: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    if not path.exists():
        raise SystemExit(f"{description} not found: {path}")
    if not path.is_file():
        raise SystemExit(f"{description} must be a file: {path}")
    return path


def _resolve_output_file(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_optional_file(value: str | None, description: str) -> Path | None:
    if value is None:
        return None
    return _resolve_input_file(value, description)


def _resolve_resource_path(value: str | None, fallback: Path) -> Path:
    candidate = fallback if value is None else Path(value).expanduser()
    path = candidate.resolve(strict=False)
    if not path.exists():
        raise SystemExit(f"Resource path not found: {path}")
    return path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_md")
    p.add_argument("--output", "-o", required=True, help="Output PDF path")
    p.add_argument("--pdf_engine", default="xelatex", choices=sorted(SAFE_PANDOC_ENGINES))
    p.add_argument("--template")
    p.add_argument("--resource_path")
    args = p.parse_args()

    if shutil.which("pandoc") is None:
        raise SystemExit(
            "pandoc not found. Install pandoc or use an alternative pipeline (e.g. ReportLab or HTML->PDF)."
        )

    inp = _resolve_input_file(args.input_md, "Markdown input")
    out = _resolve_output_file(args.output)
    template = _resolve_optional_file(args.template, "Pandoc template")
    resource_path = _resolve_resource_path(args.resource_path, inp.parent)

    cmd = [
        "pandoc",
        "-o",
        str(out),
        "--pdf-engine",
        args.pdf_engine,
        "--resource-path",
        str(resource_path),
    ]
    if template is not None:
        cmd += ["--template", str(template)]
    cmd.append(str(inp))

    print(" ".join(cmd))
    subprocess.run(cmd, check=True)  # nosemgrep
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
