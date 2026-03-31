#!/usr/bin/env python3
"""Compile LaTeX to PDF using latexmk.

Examples:
  python latex_to_pdf.py main.tex --out_dir /mnt/data/out
  python latex_to_pdf.py main.tex --out_dir /mnt/data/out --engine xelatex
  python latex_to_pdf.py main.tex -o /mnt/data/out.pdf --engine xelatex

Notes:
- latexmk runs multiple passes as needed.
- If you want a one-shot compile, you can call pdflatex directly.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
import shutil
import tempfile
from typing import Optional


def _resolve_input_file(value: str, description: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    if not path.exists():
        raise SystemExit(f"{description} not found: {path}")
    if not path.is_file():
        raise SystemExit(f"{description} must be a file: {path}")
    return path


def _resolve_output_dir(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_output_file(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tex", help="Path to a .tex file")
    # Back-compat: --out_dir writes <stem>.pdf into that directory.
    # Convenience: -o/--output writes to an exact file path (compiles in a temp build dir then copies).
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--out_dir", help="Output directory (writes <stem>.pdf)")
    group.add_argument("-o", "--output", help="Exact output PDF path")
    ap.add_argument(
        "--engine",
        default="pdflatex",
        choices=["pdflatex", "xelatex", "lualatex"],
        help="LaTeX engine",
    )
    ap.add_argument("--clean", action="store_true", help="Clean auxiliary files after build")
    ap.add_argument(
        "--keep_build",
        action="store_true",
        help="Keep intermediate build directory when using -o/--output",
    )
    args = ap.parse_args()

    if shutil.which("latexmk") is None:
        raise SystemExit("latexmk not found. Install texlive/latexmk or use another PDF pipeline.")

    tex_path = _resolve_input_file(args.tex, "LaTeX input")
    temp_build_dir: Optional[Path] = None
    if args.out_dir:
        out_dir = _resolve_output_dir(args.out_dir)
        output_path = None
    else:
        output_path = _resolve_output_file(args.output)
        # Keep build artifacts out of the destination folder by default.
        out_dir = Path(tempfile.mkdtemp(prefix="latex_build_", dir=str(output_path.parent)))
        temp_build_dir = out_dir

    cmd = [
        "latexmk",
        "-pdf",
        f"-pdflatex={args.engine} %O %S",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-outdir=" + str(out_dir),
        "--",
        str(tex_path),
    ]

    proc = subprocess.run(cmd, text=True)  # nosemgrep
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)

    pdf_path = out_dir / (tex_path.stem + ".pdf")
    if not pdf_path.exists():
        raise SystemExit(f"Expected output not found: {pdf_path}")

    if output_path is not None:
        shutil.copyfile(pdf_path, output_path)
        pdf_path = output_path

    if args.clean:
        subprocess.run(["latexmk", "-c", "-outdir=" + str(out_dir), "--", str(tex_path)], check=False)  # nosemgrep

    # If we compiled into a temp dir for -o, clean it up unless requested.
    if temp_build_dir is not None and not args.keep_build:
        shutil.rmtree(temp_build_dir, ignore_errors=True)

    print(str(pdf_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
