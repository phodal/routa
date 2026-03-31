#!/usr/bin/env python3
"""Smoke test for common edit operations (focus: paginate).

Why:
  The most common regressions are API mismatches across pypdf versions.
  This test ensures pdf_edit.py paginate runs end-to-end and produces a valid PDF.

Run:
  python edit_smoketest.py --workdir /mnt/data/_pdf_edit_smoke
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def _make_two_page_pdf(path: Path) -> None:
    w, h = letter
    c = canvas.Canvas(str(path), pagesize=(w, h))
    for i in range(2):
        c.setFont("Helvetica", 18)
        c.drawString(72, h - 72, f"Edit smoke test page {i+1}")
        c.showPage()
    c.save()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workdir", default="/mnt/data/_pdf_edit_smoke")
    p.add_argument("--dpi", type=int, default=150)
    args = p.parse_args()

    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)

    inp = wd / "in.pdf"
    out = wd / "paginated.pdf"
    _make_two_page_pdf(inp)

    subprocess.check_call(
        [
            "python",
            str(Path(__file__).with_name("pdf_edit.py")),
            "paginate",
            str(inp),
            "-o",
            str(out),
            "--start",
            "1",
            "--position",
            "br",
        ]
    )

    # Basic sanity: render page 1
    renders = wd / "render"
    subprocess.check_call(
        [
            "python",
            str(Path(__file__).with_name("render_pdf.py")),
            str(out),
            "--out_dir",
            str(renders),
            "--pages",
            "1",
            "--dpi",
            str(args.dpi),
        ]
    )
    png = renders / "page-1.png"
    if not png.exists():
        raise SystemExit("[FAIL] paginate produced no render output")

    print("[OK] edit smoke test passed")
    print(str(wd))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
