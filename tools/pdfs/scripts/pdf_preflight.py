#!/usr/bin/env python3
"""Preflight / triage a PDF and emit actionable warnings.

This is not a full print-prepress checker; it's a high-signal diagnostic for
common failure modes in programmatic PDF workflows.

Checks (best-effort)
- Openability (PyMuPDF): corruption / xref issues
- Encryption
- "Image-only" heuristic (likely scanned)
- XFA forms presence (problematic for many libraries)
- Font embedding warnings (pdffonts if available)

Golden path
  python pdf_preflight.py input.pdf
  python pdf_preflight.py input.pdf --json > preflight.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF
from pypdf import PdfReader


@dataclass
class PreflightResult:
    path: str
    ok_open: bool
    encrypted: bool
    pages: int
    likely_scanned: bool
    xfa_present: bool
    warnings: List[str]
    pdffonts_excerpt: Optional[str] = None


def _run(cmd: List[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)


def _pdffonts_warnings(pdf: Path) -> Optional[str]:
    proc = _run(["pdffonts", str(pdf)])
    if proc.returncode != 0:
        return None

    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if len(lines) <= 2:
        return None

    # Heuristic: in pdffonts output, the "emb" column indicates embedding.
    # We flag any rows where emb != yes.
    header = lines[0]
    body = lines[2:]
    base14 = {
        'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
        'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
        'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
        'Symbol', 'ZapfDingbats',
    }
    bad = []
    for ln in body:
        cols = ln.split()
        if len(cols) < 6:
            continue
        # Find "emb" column by scanning for a token that is exactly yes/no.
        # Typically col positions are stable, but be defensive.
        emb = None
        for tok in cols:
            if tok in ("yes", "no"):
                emb = tok
                break
        if emb == "no":
            font_name = cols[0]
            if font_name in base14:
                continue
            bad.append(ln)
    if not bad:
        return None

    excerpt = "\n".join([header] + bad[:20])
    return excerpt


def _xfa_present(reader: PdfReader) -> bool:
    try:
        root = reader.trailer.get("/Root")
        if not root:
            return False
        acro = root.get("/AcroForm")
        if not acro:
            return False
        return "/XFA" in acro
    except Exception:
        return False


def _likely_scanned(doc: fitz.Document, max_pages: int = 10) -> bool:
    # Heuristic:
    # - very little extracted text
    # - but images exist on most pages
    n = min(doc.page_count, max_pages)
    if n <= 0:
        return False
    low_text_pages = 0
    image_pages = 0
    for i in range(n):
        page = doc.load_page(i)
        text = page.get_text("text") or ""
        if len(text.strip()) < 20:
            low_text_pages += 1
        if page.get_images(full=True):
            image_pages += 1
    # "Likely scanned" if most sampled pages have low text and images.
    return (low_text_pages / n) >= 0.7 and (image_pages / n) >= 0.7


def preflight(pdf: Path, password: Optional[str] = None) -> PreflightResult:
    warnings: List[str] = []

    ok_open = True
    encrypted = False
    pages = 0
    likely_scanned = False
    xfa = False

    # pypdf for structural checks
    try:
        reader = PdfReader(str(pdf))
        encrypted = bool(getattr(reader, "is_encrypted", False))
        if encrypted and password:
            try:
                reader.decrypt(password)
            except Exception:
                warnings.append("Encrypted PDF: decrypt failed with provided password")
        pages = len(reader.pages)
        xfa = _xfa_present(reader)
        if xfa:
            warnings.append("XFA form detected: many libraries cannot fill/render XFA reliably")
    except Exception as e:
        warnings.append(f"pypdf failed to read: {type(e).__name__}: {e}")

    # PyMuPDF openability + scanned heuristic
    try:
        doc = fitz.open(str(pdf))
        if doc.is_encrypted and password:
            doc.authenticate(password)
        pages = pages or doc.page_count
        likely_scanned = _likely_scanned(doc)
        if likely_scanned:
            warnings.append("Likely scanned/image-only PDF: consider OCR (ocr_pdf.py) before text extraction")
    except Exception as e:
        ok_open = False
        warnings.append(f"PyMuPDF failed to open (possible corruption/xref issue): {type(e).__name__}: {e}")

    # Font embedding warnings
    ff = _pdffonts_warnings(pdf)
    if ff:
        warnings.append("Non-embedded fonts detected (pdffonts): rendering may vary across viewers")

    return PreflightResult(
        path=str(pdf),
        ok_open=ok_open,
        encrypted=encrypted,
        pages=int(pages),
        likely_scanned=bool(likely_scanned),
        xfa_present=bool(xfa),
        warnings=warnings,
        pdffonts_excerpt=ff,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input_pdf", type=Path)
    ap.add_argument("--password", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not args.input_pdf.exists():
        print(f"ERROR: not found: {args.input_pdf}", file=sys.stderr)
        return 2

    res = preflight(args.input_pdf, password=args.password)

    if args.json:
        print(json.dumps(asdict(res), indent=2, ensure_ascii=True))
    else:
        print(f"PDF: {res.path}")
        print(f"Pages: {res.pages}")
        print(f"Encrypted: {res.encrypted}")
        print(f"Openable (PyMuPDF): {res.ok_open}")
        print(f"Likely scanned: {res.likely_scanned}")
        print(f"XFA present: {res.xfa_present}")
        if res.warnings:
            print("\nWarnings:")
            for w in res.warnings:
                print(f"- {w}")
        if res.pdffonts_excerpt:
            print("\nFonts excerpt (pdffonts):")
            print(res.pdffonts_excerpt)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
