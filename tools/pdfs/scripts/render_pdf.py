#!/usr/bin/env python3
"""Render PDF pages to images for visual inspection.

Default renderer is poppler's `pdftoppm`.
Optionally, you can use `pypdfium2` for faster rendering.

Examples:
  python render_pdf.py input.pdf --out_dir /mnt/data/_renders/input
  python render_pdf.py input.pdf --out_dir /mnt/data/_renders/input --dpi 200 --pages 1-3

Output naming:
  <out_dir>/<prefix>-1.png, <out_dir>/<prefix>-2.png, ...

..."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, List, Optional, Tuple


def _clear_existing(out_dir: Path, prefix: str, fmt: str) -> None:
    """Remove stale outputs for this prefix/format to avoid mixed renders."""
    if not out_dir.exists():
        return
    pat = re.compile(rf"^{re.escape(prefix)}-(\d+)\.{re.escape(fmt)}$")
    for p in out_dir.iterdir():
        if p.is_file() and pat.match(p.name):
            p.unlink(missing_ok=True)


def _parse_pages(pages: str) -> List[Tuple[int, int]]:
    """Parse page ranges like '1-3,5,7-9' into [(1,3),(5,5),(7,9)]."""
    out: List[Tuple[int, int]] = []
    for part in pages.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start = int(a)
            end = int(b)
        else:
            start = end = int(part)
        if start < 1 or end < 1 or end < start:
            raise ValueError(f"Invalid pages segment: {part}")
        out.append((start, end))
    if not out:
        raise ValueError("Empty --pages")
    return out


def _pdftoppm_render(
    input_pdf: Path,
    out_dir: Path,
    prefix: str,
    fmt: str,
    dpi: int,
    pages: Optional[List[Tuple[int, int]]],
) -> List[Path]:
    if shutil.which("pdftoppm") is None:
        raise RuntimeError("pdftoppm not found (poppler-utils missing)")

    out_dir.mkdir(parents=True, exist_ok=True)
    _clear_existing(out_dir, prefix, fmt)
    out_prefix = out_dir / prefix

    rendered: List[Path] = []

    # pdftoppm supports -f/-l for ranges. If multiple disjoint ranges are requested,
    # we invoke pdftoppm per range and collect outputs.
    ranges = pages or [(1, 10**9)]

    for (first, last) in ranges:
        cmd = ["pdftoppm", f"-{fmt}", "-r", str(dpi)]
        if pages is not None:
            cmd += ["-f", str(first), "-l", str(last)]
        cmd += [str(input_pdf), str(out_prefix)]
        subprocess.run(cmd, check=True)

    # Collect outputs: prefix-1.png, prefix-2.png, ...
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)\.{re.escape(fmt)}$")
    for p in sorted(out_dir.iterdir()):
        m = pattern.match(p.name)
        if m:
            rendered.append(p)

    if not rendered:
        raise RuntimeError("No images produced. Is the PDF empty or protected?")

    return rendered


def _pdfium_render(
    input_pdf: Path,
    out_dir: Path,
    prefix: str,
    fmt: str,
    dpi: int,
    pages: Optional[List[Tuple[int, int]]],
) -> List[Path]:
    try:
        import pypdfium2 as pdfium  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "pypdfium2 is not installed. Install with: python -m pip install pypdfium2"
        ) from e

    from PIL import Image  # pillow is installed

    out_dir.mkdir(parents=True, exist_ok=True)
    _clear_existing(out_dir, prefix, fmt)

    pdf = pdfium.PdfDocument(str(input_pdf))
    page_count = len(pdf)

    def _page_indices() -> Iterable[int]:
        if pages is None:
            return range(1, page_count + 1)
        idxs: List[int] = []
        for (a, b) in pages:
            for i in range(a, min(b, page_count) + 1):
                idxs.append(i)
        return idxs

    scale = dpi / 72.0
    rendered: List[Path] = []

    for i in _page_indices():
        page = pdf[i - 1]
        bitmap = page.render(scale=scale)
        im: Image.Image = bitmap.to_pil()
        out_path = out_dir / f"{prefix}-{i}.{fmt}"
        im.save(out_path)
        rendered.append(out_path)

    if not rendered:
        raise RuntimeError("No images produced")

    return rendered


def main() -> None:
    parser = argparse.ArgumentParser(description="Render PDF to images for inspection")
    parser.add_argument("input_pdf", type=str, help="Path to input PDF")
    parser.add_argument("--out_dir", type=str, required=True, help="Output directory")
    parser.add_argument(
        "--prefix",
        type=str,
        default="page",
        help="Output filename prefix (default: page)",
    )
    parser.add_argument(
        "--dpi", type=int, default=150, help="Render DPI (default: 150)"
    )
    parser.add_argument(
        "--fmt",
        type=str,
        default="png",
        choices=["png", "jpeg"],
        help="Output image format",
    )
    parser.add_argument(
        "--pages",
        type=str,
        default=None,
        help="Page ranges like '1-3,5,7-9' (1-indexed)",
    )
    parser.add_argument(
        "--engine",
        type=str,
        default="pdftoppm",
        choices=["pdftoppm", "pdfium"],
        help="Rendering engine",
    )

    args = parser.parse_args()

    input_pdf = Path(args.input_pdf)
    if not input_pdf.exists():
        raise SystemExit(f"Input not found: {input_pdf}")

    out_dir = Path(args.out_dir)
    prefix = args.prefix
    pages = _parse_pages(args.pages) if args.pages else None

    if args.engine == "pdftoppm":
        paths = _pdftoppm_render(input_pdf, out_dir, prefix, args.fmt, args.dpi, pages)
    else:
        paths = _pdfium_render(input_pdf, out_dir, prefix, args.fmt, args.dpi, pages)

    print(f"Rendered {len(paths)} page(s) to {out_dir}")


if __name__ == "__main__":
    main()
