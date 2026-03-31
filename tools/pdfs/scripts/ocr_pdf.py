#!/usr/bin/env python3
"""OCR a scanned PDF into a searchable PDF.

Primary path: ocrmypdf (best quality).
Optional fallback path: pdftoppm + tesseract (page-by-page), then merge.

Golden path:
  python ocr_pdf.py scanned.pdf -o searchable.pdf --lang eng

Defaults are intentionally conservative to avoid damaging already-text PDFs:
- If text is already present, we *copy-through* unless --force is set.

Note: This skill does NOT rely on optional OCRmyPDF helpers that require
extra system binaries. We only use options that work in this runtime by
default.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

import fitz  # PyMuPDF
from pypdf import PdfReader, PdfWriter


def _which(name: str) -> Optional[str]:
    return shutil.which(name)


def _has_meaningful_text(pdf: Path, max_pages: int = 3, min_chars: int = 40) -> bool:
    """Heuristic: treat as "text PDF" if extracted text is non-trivial on any sampled page."""
    try:
        doc = fitz.open(str(pdf))
        n = min(doc.page_count, max_pages)
        for i in range(n):
            t = (doc.load_page(i).get_text("text") or "").strip()
            if len(t) >= min_chars:
                return True
    except Exception:
        # If we can't read it, don't assume it has text.
        return False
    return False


def _run_ocrmypdf(
    input_pdf: Path,
    output_pdf: Path,
    lang: str,
    force: bool,
    deskew: bool,
    optimize: int,
    jobs: int,
) -> None:
    cmd: List[str] = [
        "ocrmypdf",
        "--language",
        lang,
        "--jobs",
        str(jobs),
        "--optimize",
        str(optimize),
    ]
    if deskew:
        cmd.append("--deskew")
    if not force:
        cmd.append("--skip-text")
    cmd.extend([str(input_pdf), str(output_pdf)])
    print(" ".join(cmd))
    subprocess.check_call(cmd)


def _page_num_from_name(p: Path) -> int:
    m = re.search(r"-(\d+)\.(png|jpg|jpeg)$", p.name)
    return int(m.group(1)) if m else 10**9


def _run_tesseract_fallback(
    input_pdf: Path,
    output_pdf: Path,
    lang: str,
    force: bool,
    dpi: int,
    keep_tmp: bool,
) -> None:
    if not force and _has_meaningful_text(input_pdf):
        shutil.copyfile(input_pdf, output_pdf)
        print(f"[OK] Input already contains text; copied to {output_pdf} (use --force to OCR anyway)")
        return

    if _which("pdftoppm") is None:
        raise SystemExit("pdftoppm not found (poppler-utils missing); cannot run fallback OCR")
    if _which("tesseract") is None:
        raise SystemExit("tesseract not found; cannot run fallback OCR")

    tmp = Path(tempfile.mkdtemp(prefix="ocr_fallback_", dir=str(output_pdf.parent)))
    try:
        prefix = tmp / "page"
        # Render images
        subprocess.check_call(["pdftoppm", "-png", "-r", str(dpi), str(input_pdf), str(prefix)])
        images = sorted(tmp.glob("page-*.png"), key=_page_num_from_name)
        if not images:
            raise SystemExit("Fallback OCR: no rendered images produced (is the PDF empty/protected?)")

        per_page_pdfs: List[Path] = []
        for img in images:
            n = _page_num_from_name(img)
            outbase = tmp / f"ocr_{n:04d}"
            cmd = ["tesseract", str(img), str(outbase), "-l", lang, "pdf"]
            subprocess.check_call(cmd)
            per_page_pdfs.append(outbase.with_suffix(".pdf"))

        writer = PdfWriter()
        for p in sorted(per_page_pdfs):
            reader = PdfReader(str(p))
            for page in reader.pages:
                writer.add_page(page)

        with open(output_pdf, "wb") as f:
            writer.write(f)

        # Sanity check
        r = PdfReader(str(output_pdf))
        if len(r.pages) == 0:
            raise SystemExit("Fallback OCR produced a PDF with zero pages")

        print(str(output_pdf))
    finally:
        if keep_tmp:
            print(f"[INFO] Kept temp dir: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_pdf")
    p.add_argument("-o", "--output", required=True, help="Output searchable PDF")
    p.add_argument("--lang", default="eng", help="Tesseract language code(s), e.g. 'eng' or 'eng+spa'")
    p.add_argument("--force", action="store_true", help="Force OCR even if text exists")

    p.add_argument(
        "--fallback",
        action="store_true",
        help="Use fallback OCR (pdftoppm+tesseract) instead of ocrmypdf",
    )

    # ocrmypdf path supports deskew; fallback path ignores it.
    try:
        bool_action = argparse.BooleanOptionalAction  # py3.9+
        p.add_argument("--deskew", action=bool_action, default=True, help="Deskew pages (default: on)")
    except Exception:
        p.add_argument("--deskew", action="store_true", help="Deskew pages (ocrmypdf only)")

    p.add_argument("--jobs", type=int, default=2, help="Parallel jobs for ocrmypdf")
    p.add_argument(
        "--optimize",
        type=int,
        choices=[0, 1],
        default=1,
        help="OCRmyPDF optimization level (0 or 1). Higher levels require extra system tools.",
    )
    p.add_argument("--dpi", type=int, default=300, help="DPI for fallback renderer (pdftoppm+tesseract)")
    p.add_argument("--keep_tmp", action="store_true", help="Keep temporary files for debugging (fallback)")
    args = p.parse_args()

    input_pdf = Path(args.input_pdf)
    output_pdf = Path(args.output)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    if not input_pdf.exists():
        raise SystemExit(f"Input not found: {input_pdf}")

    if bool(args.fallback):
        _run_tesseract_fallback(
            input_pdf=input_pdf,
            output_pdf=output_pdf,
            lang=args.lang,
            force=bool(args.force),
            dpi=int(args.dpi),
            keep_tmp=bool(args.keep_tmp),
        )
        return 0

    if _which("ocrmypdf") is None:
        raise SystemExit(
            "ocrmypdf not found. Install it with: python -m pip install ocrmypdf\n"
            "Or re-run with --fallback to use pdftoppm+tesseract."
        )

    _run_ocrmypdf(
        input_pdf=input_pdf,
        output_pdf=output_pdf,
        lang=args.lang,
        force=bool(args.force),
        deskew=bool(getattr(args, "deskew", True)),
        optimize=int(args.optimize),
        jobs=int(args.jobs),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
