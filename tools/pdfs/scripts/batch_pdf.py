#!/usr/bin/env python3
"""Run common PDF operations over many files (batch helper).

This is intentionally small: it glues together existing scripts with sane
output directory conventions.

Examples
- Render all PDFs under a folder:
    python batch_pdf.py render \
      --in_glob "/mnt/data/in/**/*.pdf" \
      --out_root /mnt/data/out_renders \
      --dpi 200

- Inspect all PDFs (JSON summary per file):
    python batch_pdf.py inspect \
      --in_glob "/mnt/data/in/**/*.pdf" \
      --out_root /mnt/data/out_inspect

- Normalize/repair a corpus (PyMuPDF rewrite):
    python batch_pdf.py normalize \
      --in_glob "/mnt/data/in/**/*.pdf" \
      --out_root /mnt/data/out_norm
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import List


def _match_paths(glob_pat: str) -> List[Path]:
    # pathlib doesn't support ** globs from a root without splitting; use glob from Path.
    # If user passes an absolute glob, anchor at /.
    pat = glob_pat
    if pat.startswith("/"):
        root = Path("/")
        pat = pat.lstrip("/")
    else:
        root = Path(".")
    return sorted([p for p in root.glob(pat) if p.is_file()])


def _safe_stem(p: Path) -> str:
    # Keep filename stable but safe.
    return p.name.replace(" ", "_")


def _run(cmd: List[str]) -> None:
    subprocess.check_call(cmd)


def cmd_render(args: argparse.Namespace) -> int:
    inputs = _match_paths(args.in_glob)
    if not inputs:
        print("No inputs matched", file=sys.stderr)
        return 2
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    for p in inputs:
        subdir = out_root / _safe_stem(p)
        subdir.mkdir(parents=True, exist_ok=True)
        _run([
            "python",
            str(Path(__file__).with_name("render_pdf.py")),
            str(p),
            "--out_dir",
            str(subdir),
            "--dpi",
            str(args.dpi),
            "--engine",
            args.engine,
        ])
    print(f"Rendered {len(inputs)} PDF(s) -> {out_root}")
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    inputs = _match_paths(args.in_glob)
    if not inputs:
        print("No inputs matched", file=sys.stderr)
        return 2
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    for p in inputs:
        out_json = out_root / f"{_safe_stem(p)}.json"
        proc = subprocess.run(
            ["python", str(Path(__file__).with_name("pdf_inspect.py")), str(p), "--json"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            out_json.write_text(json.dumps({"path": str(p), "error": proc.stderr or proc.stdout}, indent=2), encoding="utf-8")
        else:
            out_json.write_text(proc.stdout, encoding="utf-8")
    print(f"Inspected {len(inputs)} PDF(s) -> {out_root}")
    return 0


def cmd_normalize(args: argparse.Namespace) -> int:
    inputs = _match_paths(args.in_glob)
    if not inputs:
        print("No inputs matched", file=sys.stderr)
        return 2
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    for p in inputs:
        out_pdf = out_root / _safe_stem(p)
        out_pdf.parent.mkdir(parents=True, exist_ok=True)
        _run([
            "python",
            str(Path(__file__).with_name("pdf_edit.py")),
            "optimize",
            str(p),
            "-o",
            str(out_pdf),
            "--recover",
            "--optimize_streams",
            "--compress_streams",
        ])
    print(f"Normalized {len(inputs)} PDF(s) -> {out_root}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    p_r = sub.add_parser("render", help="render each PDF to PNGs")
    p_r.add_argument("--in_glob", required=True)
    p_r.add_argument("--out_root", required=True)
    p_r.add_argument("--dpi", type=int, default=200)
    p_r.add_argument("--engine", choices=["pdftoppm", "pdfium"], default="pdftoppm")

    p_i = sub.add_parser("inspect", help="write inspection JSON per PDF")
    p_i.add_argument("--in_glob", required=True)
    p_i.add_argument("--out_root", required=True)

    p_n = sub.add_parser("normalize", help="rewrite PDFs via pdf_edit.py optimize")
    p_n.add_argument("--in_glob", required=True)
    p_n.add_argument("--out_root", required=True)

    args = p.parse_args()
    if args.cmd == "render":
        return cmd_render(args)
    if args.cmd == "inspect":
        return cmd_inspect(args)
    if args.cmd == "normalize":
        return cmd_normalize(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
