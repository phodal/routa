#!/usr/bin/env python3
"""Smoke test for true redaction (PyMuPDF).

Creates a small PDF containing a secret phrase, redacts it, and verifies:
- `pdftotext` no longer finds the phrase
- rendered pixels differ

Usage:
  python redact_smoketest.py  # writes to /mnt/data/_pdf_redact_smoke
  python redact_smoketest.py --workdir /mnt/data/_pdf_redact_smoke_custom
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from PIL import Image, ImageChops


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.check_call(cmd, cwd=str(cwd))


def _write_input_pdf(path: Path) -> None:
    # Create with ReportLab to avoid any external deps.
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch

    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    c.setFont("Helvetica-Bold", 18)
    c.drawString(1 * inch, h - 1 * inch, "Redaction Smoke Test")
    c.setFont("Helvetica", 12)
    c.drawString(1 * inch, h - 1.5 * inch, "TOP SECRET: project-aurora")
    c.drawString(1 * inch, h - 1.8 * inch, "Public line")
    c.showPage()
    c.save()


def _pixels_changed(a_png: Path, b_png: Path) -> bool:
    a = Image.open(a_png).convert("RGB")
    b = Image.open(b_png).convert("RGB")
    if a.size != b.size:
        return True
    diff = ImageChops.difference(a, b)
    return diff.getbbox() is not None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workdir", default="/mnt/data/_pdf_redact_smoke")
    ap.add_argument("--dpi", type=int, default=200)
    args = ap.parse_args()

    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)

    inp = wd / "input.pdf"
    out = wd / "redacted.pdf"

    _write_input_pdf(inp)

    # Render before
    _run(["python", str(Path(__file__).with_name("render_pdf.py")), str(inp), "--out_dir", "before", "--dpi", str(args.dpi)], wd)

    # Redact
    _run(["python", str(Path(__file__).with_name("pdf_redact.py")), "text", str(inp), str(out), "--text", "TOP SECRET", "--ignore_case", "--whole_word"], wd)

    # Render after
    _run(["python", str(Path(__file__).with_name("render_pdf.py")), str(out), "--out_dir", "after", "--dpi", str(args.dpi)], wd)

    # Verify extraction
    proc = subprocess.run(["pdftotext", str(out), "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if "top secret" in (proc.stdout or "").lower():
        raise SystemExit("FAIL: redacted phrase still present in pdftotext output")

    # Verify pixels changed
    before_png = wd / "before" / "page-1.png"
    after_png = wd / "after" / "page-1.png"
    if not before_png.exists() or not after_png.exists():
        raise SystemExit("FAIL: missing render outputs")
    if not _pixels_changed(before_png, after_png):
        raise SystemExit("FAIL: rendered pixels did not change (redaction may have failed)")

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
