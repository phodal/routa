#!/usr/bin/env python3
"""Stamp text / checkbox marks into precise rectangles (for non-fillable forms).

This is the opinionated workflow for "there are no form fields" cases.

Workflow:
  1) Render page -> pick boxes (use box_picker_html.py)
  2) Create a values JSON mapping item names -> text/bool
  3) Generate a preview PDF w/ guides and inspect renders
  4) Apply overlay (merge) and re-render verification

Golden path:
  python place_text_by_boxes.py in.pdf spec.json values.json --out out.pdf --preview_pdf /mnt/data/_tmp/preview.pdf

spec.json example (rect in PDF points, origin bottom-left):
  {
    "page": 1,
    "items": [
      {"name": "name", "kind": "text", "rect": [72, 500, 300, 520], "font": "Helvetica", "font_size": 10, "wrap": false, "fit": "shrink_to_fit"},
      {"name": "agree", "kind": "check", "rect": [72, 450, 84, 462]}
    ]
  }

values.json example:
  {"name": "Ada Lovelace", "agree": true}

Notes:
  - This tool stamps *real PDF text* (not just pixels), but correctness still depends on viewers.
  - Always render the output and inspect.
"""

from __future__ import annotations

import argparse
import json
import math
import tempfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth


def _load_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def _ensure_pages_spec(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    if "pages" in spec and isinstance(spec["pages"], list):
        return spec["pages"]
    if "page" in spec:
        return [{"page": spec["page"], "items": spec.get("items", [])}]
    raise ValueError("spec.json must contain either 'page' or 'pages'")


def _rect_ok(rect: List[float]) -> bool:
    if not (isinstance(rect, list) and len(rect) == 4):
        return False
    x0, y0, x1, y1 = rect
    return x1 > x0 and y1 > y0


def _overlap(a: List[float], b: List[float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    return float((ix1 - ix0) * (iy1 - iy0))


def _fit_single_line(text: str, font: str, font_size: float, max_w: float) -> float:
    if max_w <= 0:
        return font_size
    w = stringWidth(text, font, font_size)
    if w <= max_w:
        return font_size
    # Scale down with a small safety margin.
    scale = max_w / max(w, 1e-6)
    return max(4.0, font_size * scale * 0.98)


def _wrap_lines(text: str, font: str, font_size: float, max_w: float) -> List[str]:
    # Very small, dependency-free greedy wrapper.
    words = str(text).split()
    if not words:
        return [""]
    lines: List[str] = []
    cur = words[0]
    for w in words[1:]:
        candidate = cur + " " + w
        if stringWidth(candidate, font, font_size) <= max_w or not cur:
            cur = candidate
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def _draw_text_in_rect(
    c: canvas.Canvas,
    rect: List[float],
    text: str,
    font: str,
    font_size: float,
    align: str,
    valign: str,
    wrap: bool,
    fit: str,
    padding: float = 1.0,
) -> None:
    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0
    inner_w = max(0.0, w - 2 * padding)
    inner_h = max(0.0, h - 2 * padding)

    fs = float(font_size)
    if not wrap:
        if fit == "shrink_to_fit":
            fs = _fit_single_line(text, font, fs, inner_w)
        c.setFont(font, fs)
        tw = stringWidth(str(text), font, fs)
        if align == "center":
            tx = x0 + (w - tw) / 2.0
        elif align == "right":
            tx = x1 - tw - padding
        else:
            tx = x0 + padding

        # Baseline: put text roughly centered by font size.
        if valign == "top":
            ty = y1 - fs - padding
        elif valign == "middle":
            ty = y0 + (h - fs) / 2.0
        else:
            ty = y0 + padding
        c.drawString(tx, ty, str(text))
        return

    # Wrapped text
    # If shrink_to_fit is requested, reduce font size until lines fit height.
    target_fs = fs
    for _ in range(20):
        lines = _wrap_lines(str(text), font, target_fs, inner_w)
        line_h = target_fs * 1.2
        total_h = len(lines) * line_h
        if total_h <= inner_h or fit != "shrink_to_fit":
            fs = target_fs
            break
        target_fs *= 0.92
        if target_fs < 4.0:
            fs = target_fs
            break

    c.setFont(font, fs)
    lines = _wrap_lines(str(text), font, fs, inner_w)
    line_h = fs * 1.2
    total_h = len(lines) * line_h
    if valign == "top":
        start_y = y1 - padding - line_h
    elif valign == "middle":
        start_y = y0 + padding + (inner_h - total_h) / 2.0 + (len(lines) - 1) * line_h
    else:
        start_y = y0 + padding + (len(lines) - 1) * line_h

    y = start_y
    for line in lines:
        tw = stringWidth(line, font, fs)
        if align == "center":
            tx = x0 + (w - tw) / 2.0
        elif align == "right":
            tx = x1 - tw - padding
        else:
            tx = x0 + padding
        c.drawString(tx, y, line)
        y -= line_h


def _draw_check(c: canvas.Canvas, rect: List[float], checked: bool) -> None:
    if not checked:
        return
    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0
    # Draw a simple checkmark that adapts to the box.
    c.saveState()
    c.setLineWidth(max(1.0, min(w, h) * 0.12))
    c.setStrokeColor(colors.black)
    c.line(x0 + 0.2 * w, y0 + 0.55 * h, x0 + 0.45 * w, y0 + 0.25 * h)
    c.line(x0 + 0.45 * w, y0 + 0.25 * h, x0 + 0.82 * w, y0 + 0.8 * h)
    c.restoreState()


def _make_overlay_pdf(
    page_w: float,
    page_h: float,
    items: List[Dict[str, Any]],
    values: Dict[str, Any],
    draw_guides: bool,
) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))

    if draw_guides:
        c.setStrokeColor(colors.red)
        c.setLineWidth(0.75)

    for it in items:
        name = str(it.get("name") or "")
        rect = it.get("rect")
        if not _rect_ok(rect):
            continue
        kind = (it.get("kind") or "text").lower()
        if draw_guides:
            x0, y0, x1, y1 = rect
            c.rect(x0, y0, x1 - x0, y1 - y0, stroke=1, fill=0)
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.red)
            c.drawString(x0 + 2, y1 + 2, f"{name}")
            c.setFillColor(colors.black)

        val = values.get(name)
        if kind == "check" or kind == "checkbox":
            _draw_check(c, rect, bool(val))
        else:
            text = "" if val is None else str(val)
            font = it.get("font", "Helvetica")
            font_size = float(it.get("font_size", 10))
            align = str(it.get("align", "left")).lower()
            valign = str(it.get("valign", "bottom")).lower()
            wrap = bool(it.get("wrap", False))
            fit = str(it.get("fit", "none")).lower()
            _draw_text_in_rect(c, rect, text, font, font_size, align, valign, wrap, fit)

    c.showPage()
    c.save()
    return buf.getvalue()


def _validate_items(page_w: float, page_h: float, items: List[Dict[str, Any]]) -> List[str]:
    warnings: List[str] = []
    rects: List[Tuple[str, List[float]]] = []
    for it in items:
        name = str(it.get("name") or "")
        rect = it.get("rect")
        if not _rect_ok(rect):
            warnings.append(f"[WARN] invalid rect for {name}: {rect}")
            continue
        x0, y0, x1, y1 = rect
        if x0 < 0 or y0 < 0 or x1 > page_w or y1 > page_h:
            warnings.append(f"[WARN] rect out of bounds for {name}: {rect} (page {page_w}x{page_h})")
        rects.append((name, rect))

    # Overlap check (warn, don't fail)
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            n1, r1 = rects[i]
            n2, r2 = rects[j]
            area = _overlap(r1, r2)
            if area > 1.0:
                warnings.append(f"[WARN] overlap between {n1} and {n2}: {area:.1f} pt^2")
    return warnings


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_pdf")
    p.add_argument("spec_json", help="box spec JSON (rects in PDF points)")
    p.add_argument("values_json", help="values JSON mapping item names to text/bool")
    p.add_argument("--out", required=True)
    p.add_argument("--preview_pdf", default=None, help="Optional: write a guide+overlay preview PDF")
    p.add_argument("--draw_guides", action="store_true", help="Draw red rectangles/labels in preview")
    args = p.parse_args()

    inp = Path(args.input_pdf)
    spec = _load_json(Path(args.spec_json))
    values = _load_json(Path(args.values_json))
    pages = _ensure_pages_spec(spec)

    reader = PdfReader(str(inp))
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)

    preview_writer: Optional[PdfWriter] = None
    if args.preview_pdf is not None:
        preview_writer = PdfWriter()
        preview_writer.append_pages_from_reader(reader)

    # We build one overlay PDF per page and merge.
    for page_spec in pages:
        pageno = int(page_spec.get("page"))
        if not (1 <= pageno <= len(writer.pages)):
            raise SystemExit(f"spec references page {pageno}, but PDF has {len(writer.pages)} pages")
        page = writer.pages[pageno - 1]
        page_w = float(page.mediabox.width)
        page_h = float(page.mediabox.height)
        items = page_spec.get("items", [])
        if not isinstance(items, list):
            raise SystemExit("spec 'items' must be a list")

        warnings = _validate_items(page_w, page_h, items)
        for w in warnings:
            print(w)

        overlay_bytes = _make_overlay_pdf(page_w, page_h, items, values, draw_guides=bool(args.draw_guides))
        overlay_reader = PdfReader(BytesIO(overlay_bytes))
        overlay_page = overlay_reader.pages[0]
        page.merge_page(overlay_page)

        if preview_writer is not None:
            # Preview uses guides to help human verification.
            prev_bytes = _make_overlay_pdf(page_w, page_h, items, values, draw_guides=True)
            prev_reader = PdfReader(BytesIO(prev_bytes))
            prev_page = prev_reader.pages[0]
            preview_writer.pages[pageno - 1].merge_page(prev_page)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as f:
        writer.write(f)

    if preview_writer is not None:
        Path(args.preview_pdf).parent.mkdir(parents=True, exist_ok=True)
        with open(args.preview_pdf, "wb") as f:
            preview_writer.write(f)
        print(f"[OK] preview: {args.preview_pdf}")
    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
