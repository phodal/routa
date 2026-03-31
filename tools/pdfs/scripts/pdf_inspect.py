#!/usr/bin/env python3
"""Inspect a PDF and print a useful summary.

This is a quick way to learn:
- page count
- encryption
- page sizes
- metadata
- outlines/bookmarks
- forms, attachments, and annotations

Examples:
  python pdf_inspect.py input.pdf
  python pdf_inspect.py input.pdf --json > info.json
  python pdf_inspect.py input.pdf --password "secret"
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pypdf import PdfReader


def _run_cli(cmd: List[str]) -> Tuple[int, str]:
    """Run a CLI tool and return (returncode, combined_output)."""
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
        return proc.returncode, proc.stdout
    except FileNotFoundError:
        return 127, f"[missing] {cmd[0]} not found\n"


def _outline_count(outline_obj: Any) -> int:
    if outline_obj is None:
        return 0
    if isinstance(outline_obj, list):
        return sum(_outline_count(x) for x in outline_obj)
    # single outline item
    return 1


def _unique_page_sizes(reader: PdfReader, max_pages: int = 200) -> List[Dict[str, Any]]:
    """Return unique page sizes (rounded) for first N pages."""
    seen: Dict[Tuple[int, int], int] = {}
    for i, page in enumerate(reader.pages[:max_pages], start=1):
        mb = page.mediabox
        w = float(mb.width)
        h = float(mb.height)
        key = (round(w), round(h))
        seen[key] = seen.get(key, 0) + 1

    out = []
    for (w, h), count in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0])):
        out.append({"width_pt": w, "height_pt": h, "count": count})
    return out


@dataclass
class PdfSummary:
    path: str
    pages: int
    encrypted: bool
    page_sizes: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    outline_items: int
    form_fields: int
    attachments: int
    annotations: int
    poppler_pdfinfo: Optional[str] = None
    poppler_pdffonts: Optional[str] = None


def inspect_pdf(path: Path, password: Optional[str] = None) -> PdfSummary:
    reader = PdfReader(str(path))
    encrypted = bool(getattr(reader, "is_encrypted", False))

    if encrypted:
        if password:
            try:
                reader.decrypt(password)
            except Exception:
                # keep going; some data may remain inaccessible
                pass

    pages = len(reader.pages)
    page_sizes = _unique_page_sizes(reader)

    # Metadata
    md: Dict[str, Any] = {}
    try:
        meta = reader.metadata
        if meta:
            for k, v in meta.items():
                md[str(k)] = str(v) if v is not None else None
    except Exception:
        pass

    # Outlines
    outline_items = 0
    try:
        outline_items = _outline_count(reader.outline)
    except Exception:
        outline_items = 0

    # Forms
    form_fields = 0
    try:
        fields = reader.get_fields()
        form_fields = len(fields) if fields else 0
    except Exception:
        form_fields = 0

    # Attachments (embedded files)
    attachments = 0
    try:
        att = getattr(reader, "attachments", None)
        if isinstance(att, dict):
            attachments = len(att)
    except Exception:
        attachments = 0

    # Annotations
    annots = 0
    try:
        for page in reader.pages:
            if "/Annots" in page:
                a = page["/Annots"]
                try:
                    annots += len(a)
                except Exception:
                    annots += 1
    except Exception:
        annots = 0

    # Poppler summaries (nice for quick font + doc info)
    rc_info, pdfinfo_out = _run_cli(["pdfinfo", str(path)])
    rc_fonts, pdffonts_out = _run_cli(["pdffonts", str(path)])

    return PdfSummary(
        path=str(path),
        pages=pages,
        encrypted=encrypted,
        page_sizes=page_sizes,
        metadata=md,
        outline_items=outline_items,
        form_fields=form_fields,
        attachments=attachments,
        annotations=annots,
        poppler_pdfinfo=pdfinfo_out.strip() if rc_info == 0 else None,
        poppler_pdffonts=pdffonts_out.strip() if rc_fonts == 0 else None,
    )


def _print_human(summary: PdfSummary) -> None:
    print(f"PDF: {summary.path}")
    print(f"Pages: {summary.pages}")
    print(f"Encrypted: {summary.encrypted}")

    if summary.page_sizes:
        print("Page sizes (pt, rounded):")
        for s in summary.page_sizes:
            print(f"  - {s['width_pt']} x {s['height_pt']} ({s['count']} page(s))")

    if summary.metadata:
        print("Metadata:")
        for k in sorted(summary.metadata.keys()):
            print(f"  {k}: {summary.metadata[k]}")

    print(f"Outline items: {summary.outline_items}")
    print(f"Form fields: {summary.form_fields}")
    print(f"Attachments: {summary.attachments}")
    print(f"Annotations: {summary.annotations}")

    if summary.poppler_pdffonts:
        lines = summary.poppler_pdffonts.splitlines()
        print("\nFonts (pdffonts, first 25 lines):")
        print("\n".join(lines[:25]))


def main() -> int:
    ap = argparse.ArgumentParser(description="Inspect a PDF")
    ap.add_argument("input_pdf", type=Path)
    ap.add_argument("--password", default=None, help="Password for encrypted PDFs")
    ap.add_argument("--json", action="store_true", help="Print JSON")
    args = ap.parse_args()

    if not args.input_pdf.exists():
        print(f"ERROR: not found: {args.input_pdf}", file=sys.stderr)
        return 2

    summary = inspect_pdf(args.input_pdf, password=args.password)

    if args.json:
        print(json.dumps(asdict(summary), indent=2, ensure_ascii=True))
    else:
        _print_human(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
