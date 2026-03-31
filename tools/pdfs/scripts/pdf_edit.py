#!/usr/bin/env python3
"""Edit/manipulate PDFs.

This is the main "structural edit" helper: merge/split/reorder/rotate/crop,
watermarks, page-number overlays, (basic) form fill, and encryption.

Golden rule: after ANY edit, render and visually verify:
  python render_pdf.py out.pdf --out_dir /mnt/data/_renders/out

Subcommands:
  merge         Merge PDFs in order
  split         Split into single-page PDFs
  select        Extract selected pages into a new PDF
  extract       Extract multiple ranges into separate PDFs
  rotate        Rotate pages by 90/180/270
  crop          Adjust CropBox (box or uniform inset)
  watermark     Overlay a watermark PDF onto pages
  paginate      Add page numbers (overlay) using ReportLab
  fill-form     Best-effort fill AcroForm values (may not render in all viewers)
  encrypt       Encrypt with user/owner passwords
  decrypt       Remove encryption (if password known)
  repair        Attempt recovery + rewrite via PyMuPDF
  optimize      Optimize/clean up by rewriting via PyMuPDF

Examples:
  python pdf_edit.py merge a.pdf b.pdf -o out.pdf
  python pdf_edit.py split input.pdf --out_dir /mnt/data/split
  python pdf_edit.py select input.pdf --pages 1-2,5 -o excerpt.pdf
  python pdf_edit.py extract input.pdf --ranges 1-3,7,10-12 --out_dir /mnt/data/extract
  python pdf_edit.py rotate input.pdf --angle 90 --pages 1-3 -o rotated.pdf
  python pdf_edit.py crop input.pdf --inset 0.25in -o cropped.pdf
  python pdf_edit.py watermark input.pdf --watermark wm.pdf -o watermarked.pdf
  python pdf_edit.py paginate input.pdf -o numbered.pdf --format "{page}/{total}"
"""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from pypdf import PdfReader, PdfWriter
from pypdf.generic import BooleanObject, NameObject, RectangleObject


def _parse_pages(spec: Optional[str], num_pages: int) -> List[int]:
    """Parse a 1-indexed page spec like '1-3,5' (or 'all') into a list of pages."""
    if not spec:
        return list(range(1, num_pages + 1))

    if spec.strip().lower() == "all":
        return list(range(1, num_pages + 1))

    spec = spec.strip()
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start = int(a)
            end = int(b)
            if start < 1 or end < 1:
                raise ValueError("Pages must be >= 1")
            for p in range(start, end + 1):
                if 1 <= p <= num_pages:
                    out.append(p)
        else:
            p = int(part)
            if 1 <= p <= num_pages:
                out.append(p)
    # De-dup while preserving order
    seen = set()
    uniq = []
    for p in out:
        if p not in seen:
            uniq.append(p)
            seen.add(p)
    return uniq


def _position_to_xy(position: str, page_w: float, page_h: float, margin: float) -> Tuple[float, float]:
    """Convert shorthand positions to an (x, y) baseline in PDF points.

    Supported:
      br, bc, bl, tr, tc, tl

    The returned (x, y) is a baseline point suitable for ReportLab drawString.
    """
    pos = (position or "br").lower().strip()
    if pos not in {"br", "bc", "bl", "tr", "tc", "tl"}:
        raise ValueError(f"Unsupported --position {position!r}; use br/bc/bl/tr/tc/tl")

    if pos[0] == "b":
        y = margin
    else:
        y = page_h - margin

    if pos[1] == "l":
        x = margin
    elif pos[1] == "c":
        x = page_w / 2.0
    else:
        x = page_w - margin
    return x, y


def _writer_from_reader(reader: PdfReader) -> PdfWriter:
    w = PdfWriter()
    # Clone preserves object graph (important for forms/metadata)
    w.clone_document_from_reader(reader)
    return w


def cmd_merge(args: argparse.Namespace) -> int:
    writer = PdfWriter()
    for path in args.inputs:
        reader = PdfReader(path)
        writer.append(reader)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_split(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.input_pdf).stem

    for i, page in enumerate(reader.pages, start=1):
        writer = PdfWriter()
        writer.add_page(page)
        out_path = out_dir / f"{stem}_p{i:03d}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)
    print(str(out_dir))
    return 0


def cmd_select(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    pages = _parse_pages(args.pages, len(reader.pages))
    writer = PdfWriter()
    for p in pages:
        writer.add_page(reader.pages[p - 1])
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_extract(args: argparse.Namespace) -> int:
    """Extract multiple ranges into separate PDFs."""
    reader = PdfReader(args.input_pdf)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ranges = args.ranges.split(",")
    stem = Path(args.input_pdf).stem

    def _parse_range(r: str) -> Tuple[int, int]:
        r = r.strip()
        if not r:
            raise ValueError("Empty range")
        if "-" in r:
            a, b = r.split("-", 1)
            return int(a), int(b)
        return int(r), int(r)

    written = 0
    for r in ranges:
        a, b = _parse_range(r)
        if a > b:
            a, b = b, a
        a = max(1, a)
        b = min(len(reader.pages), b)
        writer = PdfWriter()
        for p in range(a, b + 1):
            writer.add_page(reader.pages[p - 1])
        out_path = out_dir / f"{stem}_p{a:03d}-p{b:03d}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)
        written += 1
    print(str(out_dir))
    return 0


def cmd_rotate(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    pages_to_rotate = set(_parse_pages(args.pages, len(reader.pages)))
    angle = int(args.angle) % 360
    if angle not in (0, 90, 180, 270):
        raise ValueError("angle must be 0/90/180/270")

    writer = PdfWriter()
    for i, page in enumerate(reader.pages, start=1):
        if i in pages_to_rotate and angle != 0:
            page = page.rotate(angle)
        writer.add_page(page)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_crop(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    pages_to_crop = set(_parse_pages(args.pages, len(reader.pages)))

    def _parse_inset(inset: str) -> float:
        m = re.match(r"^\s*([0-9]*\.?[0-9]+)\s*(pt|in|cm|mm)\s*$", inset)
        if not m:
            raise ValueError("--inset must look like '12pt' or '0.25in' or '5mm'")
        val = float(m.group(1))
        unit = m.group(2)
        if unit == "pt":
            return val
        if unit == "in":
            return val * 72.0
        if unit == "cm":
            return val * (72.0 / 2.54)
        if unit == "mm":
            return val * (72.0 / 25.4)
        raise AssertionError(unit)

    use_inset = args.inset is not None
    use_box = args.box is not None
    if use_inset == use_box:
        raise ValueError("Provide exactly one of --inset or --box")

    writer = PdfWriter()
    for i, page in enumerate(reader.pages, start=1):
        if i in pages_to_crop:
            mb = page.mediabox
            if use_inset:
                ins = _parse_inset(args.inset)
                l = float(mb.left) + ins
                b = float(mb.bottom) + ins
                r = float(mb.right) - ins
                t = float(mb.top) - ins
            else:
                parts = [p.strip() for p in args.box.split(",")]
                if len(parts) != 4:
                    raise ValueError("--box must be left,bottom,right,top in points")
                l, b, r, t = map(float, parts)
            page.cropbox = RectangleObject((l, b, r, t))
        writer.add_page(page)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_watermark(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    wm_reader = PdfReader(args.watermark)
    wm_page = wm_reader.pages[0]

    writer = PdfWriter()
    for page in reader.pages:
        # merge_page mutates; copy via clone approach is overkill here.
        page.merge_page(wm_page)
        writer.add_page(page)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def _make_page_number_overlay(page_width: float, page_height: float, label: str, x: float, y: float, font_size: int) -> bytes:
    # Create a 1-page PDF overlay in-memory.
    from io import BytesIO
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFont("Helvetica", font_size)
    c.drawString(x, y, label)
    c.save()
    return buf.getvalue()


def cmd_paginate(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    total = len(reader.pages)

    writer = PdfWriter()
    for i, page in enumerate(reader.pages, start=1):
        mb = page.mediabox
        w = float(mb.width)
        h = float(mb.height)

        label = args.format.format(page=i + (args.start - 1), total=total)

        # Positioning: either explicit x/y (PDF points), or a named position.
        margin = args.margin
        if args.x is not None or args.y is not None:
            # If one is omitted, fall back to the position-derived default.
            x_default, y_default = _position_to_xy(args.position, w, h, margin)
            x = args.x if args.x is not None else x_default
            y = args.y if args.y is not None else y_default
        else:
            x, y = _position_to_xy(args.position, w, h, margin)

        # Nudge right-aligned positions by a rough label width estimate so the label stays on-page.
        if args.position.endswith("r") and args.x is None:
            x = x - (len(label) * args.font_size * 0.45)

        from io import BytesIO

        overlay_pdf_bytes = _make_page_number_overlay(w, h, label, x, y, args.font_size)
        # pypdf 6.x: no PdfReader.from_bytes(); wrap with BytesIO.
        overlay_reader = PdfReader(BytesIO(overlay_pdf_bytes))
        page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_encrypt(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)

    writer.encrypt(
        user_password=args.user_password,
        owner_password=args.owner_password,
        algorithm=args.algorithm,
    )

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_decrypt(args: argparse.Namespace) -> int:
    reader = PdfReader(args.input_pdf)
    if reader.is_encrypted:
        if reader.decrypt(args.password) == 0:
            raise RuntimeError("Bad password")

    writer = PdfWriter()
    writer.append_pages_from_reader(reader)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def cmd_optimize(args: argparse.Namespace) -> int:
    """Best-effort size reduction + structural cleanup.

    We prefer PyMuPDF here because it is available by default in this environment and is
    robust at rewriting PDFs (rebuilding xref, garbage collecting objects, etc.).

    If you later install pikepdf/qpdf, you can add a dedicated qpdf-style path, but this
    PyMuPDF approach already fixes many "odd PDF" cases.
    """
    import fitz  # PyMuPDF

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    # Save params:
    # - garbage=4: full garbage collection
    # - clean=True: sanitize/rewrite content streams
    # - deflate=True: compress streams
    # - linear=True: attempt fast web view (may be ignored if not supported)
    garbage = 4 if args.optimize_streams or args.compress_streams or args.recover else 2
    clean = bool(args.optimize_streams) or bool(args.recover)
    deflate = bool(args.compress_streams)
    linear = bool(args.linearize)

    doc = fitz.open(args.input_pdf)
    doc.save(
        args.output,
        garbage=garbage,
        clean=clean,
        deflate=deflate,
        incremental=False,
        linear=linear,
    )
    doc.close()
    print(args.output)
    return 0


def cmd_repair(args: argparse.Namespace) -> int:
    """Attempt to repair a problematic PDF by round-tripping through PyMuPDF.

    This often rebuilds xref tables and drops malformed objects.
    """
    import fitz  # PyMuPDF

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(args.input_pdf)
    doc.save(
        args.output,
        garbage=4,
        clean=True,
        deflate=False,
        incremental=False,
    )
    doc.close()
    print(args.output)
    return 0


def cmd_fill_form(args: argparse.Namespace) -> int:
    """Best-effort AcroForm fill.

    WARNING: many real-world PDFs rely on appearance streams. Setting values
    without regenerating appearances may look blank in some viewers.
    If you need reliable rendering, use pdf-lib + flatten (see tasks/forms_annotations.md).
    """
    import json

    data: Dict[str, object] = json.loads(Path(args.data).read_text(encoding="utf-8"))
    reader = PdfReader(args.input_pdf)

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    # Update fields on each page (pypdf API uses widgets on pages)
    for page in writer.pages:
        try:
            writer.update_page_form_field_values(page, data)
        except Exception:
            # Some PDFs have malformed fields; ignore best-effort.
            continue

    if args.need_appearances:
        root = writer._root_object  # pypdf internal, but stable enough for this use
        acro = root.get("/AcroForm")
        if acro is None:
            # nothing to do
            pass
        else:
            acro.update({NameObject("/NeedAppearances"): BooleanObject(True)})

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as f:
        writer.write(f)
    print(args.output)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_merge = sub.add_parser("merge", help="merge PDFs")
    p_merge.add_argument("inputs", nargs="+", help="input PDFs (in order)")
    p_merge.add_argument("-o", "--output", required=True)
    p_merge.set_defaults(func=cmd_merge)

    p_split = sub.add_parser("split", help="split into single-page PDFs")
    p_split.add_argument("input_pdf")
    p_split.add_argument("--out_dir", required=True)
    p_split.set_defaults(func=cmd_split)

    p_sel = sub.add_parser("select", help="extract selected pages")
    p_sel.add_argument("input_pdf")
    p_sel.add_argument("--pages", required=True, help="e.g. 1-3,8")
    p_sel.add_argument("-o", "--output", required=True)
    p_sel.set_defaults(func=cmd_select)

    p_ext = sub.add_parser("extract", help="extract multiple ranges into separate PDFs")
    p_ext.add_argument("input_pdf")
    p_ext.add_argument("--ranges", required=True, help="e.g. 1-3,7,10-12")
    p_ext.add_argument("--out_dir", required=True)
    p_ext.set_defaults(func=cmd_extract)

    p_rot = sub.add_parser("rotate", help="rotate pages")
    p_rot.add_argument("input_pdf")
    p_rot.add_argument("--angle", required=True)
    p_rot.add_argument("--pages", default=None)
    p_rot.add_argument("-o", "--output", required=True)
    p_rot.set_defaults(func=cmd_rotate)

    p_crop = sub.add_parser("crop", help="set CropBox")
    p_crop.add_argument("input_pdf")
    p_crop.add_argument("--inset", default=None, help="Uniform inset like '0.25in' or '12pt'")
    p_crop.add_argument("--box", default=None, help="left,bottom,right,top in points")
    p_crop.add_argument("--pages", default=None)
    p_crop.add_argument("-o", "--output", required=True)
    p_crop.set_defaults(func=cmd_crop)

    p_wm = sub.add_parser("watermark", help="overlay watermark PDF")
    p_wm.add_argument("input_pdf")
    p_wm.add_argument("--watermark", required=True, help="Watermark PDF (first page used)")
    p_wm.add_argument("-o", "--output", required=True)
    p_wm.set_defaults(func=cmd_watermark)

    p_pag = sub.add_parser("paginate", help="add page numbers")
    p_pag.add_argument("input_pdf")
    p_pag.add_argument("-o", "--output", required=True)
    p_pag.add_argument("--start", type=int, default=1)
    p_pag.add_argument("--format", default="{page}")
    p_pag.add_argument("--font_size", type=int, default=9)
    p_pag.add_argument("--margin", type=float, default=24.0, help="points")
    p_pag.add_argument("--position", default="br", choices=["br", "bc", "bl", "tr", "tc", "tl"], help="corner/edge shorthand")
    p_pag.add_argument("--x", type=float, default=None, help="override x in PDF points")
    p_pag.add_argument("--y", type=float, default=None, help="override y in PDF points")
    p_pag.set_defaults(func=cmd_paginate)

    p_enc = sub.add_parser("encrypt", help="encrypt PDF")
    p_enc.add_argument("input_pdf")
    p_enc.add_argument("-o", "--output", required=True)
    p_enc.add_argument("--user_password", "--user-pass", dest="user_password", required=True)
    p_enc.add_argument("--owner_password", "--owner-pass", dest="owner_password", default=None)
    p_enc.add_argument("--algorithm", default="AES-256")
    p_enc.set_defaults(func=cmd_encrypt)

    p_dec = sub.add_parser("decrypt", help="decrypt PDF")
    p_dec.add_argument("input_pdf")
    p_dec.add_argument("-o", "--output", required=True)
    p_dec.add_argument("--password", required=True)
    p_dec.set_defaults(func=cmd_decrypt)

    p_opt = sub.add_parser("optimize", help="optimize/clean up by rewriting via PyMuPDF")
    p_opt.add_argument("input_pdf")
    p_opt.add_argument("-o", "--output", required=True)
    p_opt.add_argument("--recover", action="store_true")
    p_opt.add_argument("--optimize_streams", action="store_true")
    p_opt.add_argument("--compress_streams", action="store_true")
    p_opt.add_argument("--linearize", action="store_true")
    p_opt.set_defaults(func=cmd_optimize)

    p_rep = sub.add_parser("repair", help="attempt recovery + rewrite via PyMuPDF")
    p_rep.add_argument("input_pdf")
    p_rep.add_argument("-o", "--output", required=True)
    p_rep.set_defaults(func=cmd_repair)

    p_ff = sub.add_parser("fill-form", help="best-effort fill AcroForm values")
    p_ff.add_argument("input_pdf")
    p_ff.add_argument("data", help="JSON mapping field name -> value")
    p_ff.add_argument("-o", "--output", required=True)
    p_ff.add_argument("--need_appearances", "--need-appearances", dest="need_appearances", action="store_true")
    p_ff.set_defaults(func=cmd_fill_form)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
