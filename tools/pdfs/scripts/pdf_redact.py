#!/usr/bin/env python3
"""Redact content from PDFs (real redaction, not just drawing black boxes).

Why this exists
- Many "redaction" attempts only overlay a black rectangle, leaving underlying
  content extractable.
- PyMuPDF supports *true* redaction via redact annotations plus
  apply_redactions(), which removes the covered content.

Golden paths
- Redact a literal phrase (case-sensitive) on all pages:
    python pdf_redact.py text in.pdf out.pdf --text "TOP SECRET"

- Case-insensitive word/phrase match (best-effort) using word boxes:
    python pdf_redact.py text in.pdf out.pdf --text "secret" --ignore_case

- Redact predefined rectangles (PDF points) from a boxes JSON:
    python pdf_redact.py boxes in.pdf out.pdf --boxes_json boxes.json

Always verify
- Render the output and spot-check.
- Try extracting text (pdftotext/pdfplumber) to confirm the sensitive string is gone.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import fitz  # PyMuPDF


def parse_page_range(spec: Optional[str], num_pages: int) -> List[int]:
    """Parse a 1-indexed page range string like "1-3,5,7-" into 0-indexed pages."""
    if not spec:
        return list(range(num_pages))

    pages: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            a = a.strip()
            b = b.strip()
            start = int(a) if a else 1
            end = int(b) if b else num_pages
            start = max(1, start)
            end = min(num_pages, end)
            pages.extend(list(range(start - 1, end)))
        else:
            p = int(part)
            if 1 <= p <= num_pages:
                pages.append(p - 1)

    # de-dup while preserving order
    seen = set()
    out: List[int] = []
    for p in pages:
        if p not in seen:
            out.append(p)
            seen.add(p)
    return out


def _load_text_list(args: argparse.Namespace) -> List[str]:
    texts: List[str] = []
    if args.text:
        texts.extend(args.text)
    if args.text_file:
        for line in Path(args.text_file).read_text(encoding="utf-8", errors="ignore").splitlines():
            s = line.strip("\n\r")
            if s:
                texts.append(s)
    # drop empties
    texts = [t for t in (x.strip() for x in texts) if t]
    return texts


def _sorted_words(page: fitz.Page) -> List[Tuple[fitz.Rect, str]]:
    """Return words in stable reading-ish order, with their rectangles."""
    words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,word_no
    # Sort by block, line, word index
    words.sort(key=lambda w: (w[5], w[6], w[7], w[1], w[0]))
    out: List[Tuple[fitz.Rect, str]] = []
    for w in words:
        rect = fitz.Rect(w[0], w[1], w[2], w[3])
        out.append((rect, str(w[4])))
    return out


def _phrase_matches(seq: Sequence[str], phrase_tokens: Sequence[str], ignore_case: bool, whole_word: bool) -> bool:
    if len(seq) != len(phrase_tokens):
        return False

    for a, b in zip(seq, phrase_tokens):
        aa = a
        bb = b
        if ignore_case:
            aa = aa.casefold()
            bb = bb.casefold()
        if whole_word:
            # Treat token as a whole word: strip punctuation around the token.
            aa = re.sub(r"^\W+|\W+$", "", aa)
            bb = re.sub(r"^\W+|\W+$", "", bb)
        if aa != bb:
            return False
    return True


def _find_rects_by_words(page: fitz.Page, needle: str, ignore_case: bool, whole_word: bool) -> List[fitz.Rect]:
    """Best-effort search using word boxes. Supports ignore_case and multi-word phrases."""
    phrase_tokens = [t for t in needle.split() if t]
    if not phrase_tokens:
        return []

    words = _sorted_words(page)
    toks = [w for _, w in words]

    rects: List[fitz.Rect] = []
    k = len(phrase_tokens)
    for i in range(0, max(0, len(toks) - k + 1)):
        window = toks[i : i + k]
        if _phrase_matches(window, phrase_tokens, ignore_case=ignore_case, whole_word=whole_word):
            # Union all token rects
            r = None
            for j in range(i, i + k):
                rr = words[j][0]
                r = rr if r is None else (r | rr)
            if r is not None:
                rects.append(r)

    return rects


def _add_redactions_for_text(
    doc: fitz.Document,
    pages: Iterable[int],
    needles: List[str],
    ignore_case: bool,
    whole_word: bool,
    fill_rgb: Tuple[float, float, float],
) -> int:
    total = 0
    for pno in pages:
        page = doc.load_page(pno)
        for needle in needles:
            if not ignore_case and not whole_word:
                # Fast path: let MuPDF search. (Case sensitive.)
                rects = page.search_for(needle)
            else:
                rects = _find_rects_by_words(page, needle, ignore_case=ignore_case, whole_word=whole_word)

            for r in rects:
                # Redaction annotation. Content is removed when apply_redactions() runs.
                page.add_redact_annot(r, fill=fill_rgb)
                total += 1
    return total


@dataclass
class BoxSpec:
    page: int  # 1-indexed
    rect: List[float]  # [x0, y0, x1, y1] in PDF points


def _load_boxes(path: Path) -> List[BoxSpec]:
    obj = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    boxes: List[BoxSpec] = []

    # Accept either:
    # 1) {"items": [{"page": 1, "rect": [..], ...}, ...]}
    # 2) {"pages": {"1": {"boxes": [{"rect": [...]}, ...]}}}
    if isinstance(obj, dict) and "items" in obj and isinstance(obj["items"], list):
        for it in obj["items"]:
            if not isinstance(it, dict):
                continue
            if "page" in it and "rect" in it:
                boxes.append(BoxSpec(page=int(it["page"]), rect=list(map(float, it["rect"]))))
        return boxes

    if isinstance(obj, dict) and "pages" in obj and isinstance(obj["pages"], dict):
        for k, v in obj["pages"].items():
            try:
                page_num = int(k)
            except Exception:
                continue
            if not isinstance(v, dict):
                continue
            for b in v.get("boxes", []) or []:
                if isinstance(b, dict) and "rect" in b:
                    boxes.append(BoxSpec(page=page_num, rect=list(map(float, b["rect"]))))
        return boxes

    raise ValueError("Unsupported boxes JSON format")


def _add_redactions_for_boxes(
    doc: fitz.Document,
    pages: Iterable[int],
    boxes: List[BoxSpec],
    fill_rgb: Tuple[float, float, float],
) -> int:
    allowed = set(pages)
    total = 0
    for b in boxes:
        pno0 = b.page - 1
        if pno0 not in allowed:
            continue
        page = doc.load_page(pno0)
        x0, y0, x1, y1 = b.rect
        r = fitz.Rect(float(x0), float(y0), float(x1), float(y1))
        page.add_redact_annot(r, fill=fill_rgb)
        total += 1
    return total


def _apply_and_save(doc: fitz.Document, out_pdf: Path, image_mode: str) -> None:
    # Redact images: remove is safest default.
    if image_mode == "remove":
        img_mode = fitz.PDF_REDACT_IMAGE_REMOVE
    elif image_mode == "pixels":
        img_mode = fitz.PDF_REDACT_IMAGE_PIXELS
    else:
        img_mode = fitz.PDF_REDACT_IMAGE_NONE

    # Apply redactions per page.
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        # text=PDF_REDACT_TEXT_REMOVE ensures text behind redactions is removed.
        page.apply_redactions(images=img_mode, graphics=1, text=fitz.PDF_REDACT_TEXT_REMOVE)

    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    doc.save(
        str(out_pdf),
        garbage=4,
        clean=1,
        deflate=1,
        incremental=0,
    )


def _parse_fill(fill: str) -> Tuple[float, float, float]:
    f = fill.strip().lower()
    if f in ("black", "#000", "#000000"):
        return (0.0, 0.0, 0.0)
    if f in ("white", "#fff", "#ffffff"):
        return (1.0, 1.0, 1.0)
    m = re.fullmatch(r"#?([0-9a-f]{6})", f)
    if m:
        hexv = m.group(1)
        r = int(hexv[0:2], 16) / 255.0
        g = int(hexv[2:4], 16) / 255.0
        b = int(hexv[4:6], 16) / 255.0
        return (r, g, b)
    raise ValueError("fill must be black|white|#RRGGBB")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    p_text = sub.add_parser("text", help="redact by searching for text")
    p_text.add_argument("input_pdf", type=Path)
    p_text.add_argument("output_pdf", type=Path)
    p_text.add_argument("--text", action="append", default=[], help="Text / phrase to redact (repeatable)")
    p_text.add_argument("--text_file", default=None, help="File with one phrase per line")
    p_text.add_argument("--pages", default=None, help='Page range like "1-3,5" (1-indexed)')
    p_text.add_argument("--ignore_case", action="store_true", help="Best-effort case-insensitive match using word boxes")
    p_text.add_argument("--whole_word", action="store_true", help="Best-effort whole-word match (strips punctuation)")
    p_text.add_argument("--fill", default="black", help="Fill color for redaction box: black|white|#RRGGBB")
    p_text.add_argument("--image_mode", choices=["remove", "pixels", "none"], default="remove")
    p_text.add_argument("--password", default=None)

    p_boxes = sub.add_parser("boxes", help="redact by rectangle(s) in a JSON file (PDF points)")
    p_boxes.add_argument("input_pdf", type=Path)
    p_boxes.add_argument("output_pdf", type=Path)
    p_boxes.add_argument("--boxes_json", required=True, help="JSON file with page+rect entries")
    p_boxes.add_argument("--pages", default=None, help='Optional page filter like "1-3,5"')
    p_boxes.add_argument("--fill", default="black")
    p_boxes.add_argument("--image_mode", choices=["remove", "pixels", "none"], default="remove")
    p_boxes.add_argument("--password", default=None)

    args = p.parse_args()

    if args.cmd == "text":
        needles = _load_text_list(args)
        if not needles:
            print("ERROR: provide --text and/or --text_file", file=sys.stderr)
            return 2
        fill = _parse_fill(args.fill)
        doc = fitz.open(str(args.input_pdf))
        if doc.is_encrypted and args.password:
            doc.authenticate(args.password)
        pages = parse_page_range(args.pages, doc.page_count)
        n = _add_redactions_for_text(
            doc,
            pages=pages,
            needles=needles,
            ignore_case=bool(args.ignore_case),
            whole_word=bool(args.whole_word),
            fill_rgb=fill,
        )
        if n == 0:
            print("WARNING: no matches found")
        _apply_and_save(doc, args.output_pdf, image_mode=args.image_mode)
        print(f"Applied {n} redaction(s) -> {args.output_pdf}")
        return 0

    if args.cmd == "boxes":
        fill = _parse_fill(args.fill)
        boxes = _load_boxes(Path(args.boxes_json))
        doc = fitz.open(str(args.input_pdf))
        if doc.is_encrypted and args.password:
            doc.authenticate(args.password)
        pages = parse_page_range(args.pages, doc.page_count)
        n = _add_redactions_for_boxes(doc, pages=pages, boxes=boxes, fill_rgb=fill)
        if n == 0:
            print("WARNING: no boxes applied (check pages filter)")
        _apply_and_save(doc, args.output_pdf, image_mode=args.image_mode)
        print(f"Applied {n} redaction(s) -> {args.output_pdf}")
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
