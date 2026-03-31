#!/usr/bin/env python3
"""Generate a 1-page watermark PDF (text or diagonal stamp) for use with pdf_edit.py watermark.

Examples:
  python make_watermark_pdf.py --text "CONFIDENTIAL" --out watermark.pdf
  python make_watermark_pdf.py --text "DRAFT" --angle 45 --font_size 72 --opacity 0.12 --out wm.pdf

Notes:
  - Uses ReportLab; output is a regular vector PDF.
  - Opacity uses a PDF transparency state; most viewers handle this.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--pagesize", choices=["letter", "a4"], default="letter")
    p.add_argument("--font", default="Helvetica-Bold")
    p.add_argument("--font_size", type=int, default=72)
    p.add_argument("--angle", type=float, default=45.0)
    p.add_argument("--opacity", type=float, default=0.12)
    p.add_argument("--center_x", type=float, default=None, help="points; default: page center")
    p.add_argument("--center_y", type=float, default=None, help="points; default: page center")
    args = p.parse_args()

    if not (0.0 <= args.opacity <= 1.0):
        raise SystemExit("--opacity must be in [0,1]")

    if args.pagesize == "letter":
        w, h = letter
    else:
        from reportlab.lib.pagesizes import A4

        w, h = A4

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out), pagesize=(w, h))

    cx = args.center_x if args.center_x is not None else w / 2.0
    cy = args.center_y if args.center_y is not None else h / 2.0

    # Transparency
    try:
        c.setFillAlpha(args.opacity)
    except Exception:
        # Older reportlab builds may not support; fall back to solid.
        pass

    c.setFont(args.font, args.font_size)
    c.saveState()
    c.translate(cx, cy)
    c.rotate(args.angle)
    c.drawCentredString(0, 0, args.text)
    c.restoreState()

    c.showPage()
    c.save()
    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
