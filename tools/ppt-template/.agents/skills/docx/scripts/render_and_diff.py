#!/usr/bin/env python3
"""Render two DOCXs and produce visual + structural diffs.

Outputs an easy-to-browse directory:
  outdir/
    a_render/  (page-*.png)
    b_render/  (page-*.png)
    diff_pages/ (diff-page-*.png for changed pages)
    summary.json
    text_a.txt
    text_b.txt
    text_diff.txt

Visual diff
-----------
We render both DOCXs to PNGs via render_docx.py (LibreOffice headless) and then
diff each corresponding page using Pillow. We compute differences in RGB (not
RGBA) because alpha-only differences can cause getbbox() to return None.

Structural diff
---------------
We also extract plain text from word/document.xml (w:t runs) and emit a unified
diff. This catches content regressions even when page rendering shifts.

Usage
-----
python scripts/render_and_diff.py a.docx b.docx --outdir /mnt/data/diff
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import zipfile
import sys
from pathlib import Path

from lxml import etree
from PIL import Image, ImageChops

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def _run_render(render_py: str, docx: str, outdir: str) -> None:
    os.makedirs(outdir, exist_ok=True)
    cmd = [sys.executable, render_py, docx, "--output_dir", outdir]
    subprocess.check_call(cmd)


def _list_pages(png_dir: str) -> list[Path]:
    p = Path(png_dir)
    pages = sorted(p.glob("page-*.png"), key=lambda x: int(x.stem.split("-")[1]))
    return pages


def _diff_images(a_path: Path, b_path: Path, out_path: Path) -> bool:
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        # normalize by padding to max size
        max_w = max(a.size[0], b.size[0])
        max_h = max(a.size[1], b.size[1])
        a2 = Image.new("RGB", (max_w, max_h), (255, 255, 255))
        b2 = Image.new("RGB", (max_w, max_h), (255, 255, 255))
        a2.paste(a, (0, 0))
        b2.paste(b, (0, 0))
        a, b = a2, b2

    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    if bbox is None:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    diff.save(out_path)
    return True


def _extract_text(docx_path: str) -> str:
    with zipfile.ZipFile(docx_path, "r") as z:
        xml = z.read("word/document.xml")
    root = etree.fromstring(xml)
    paras = []
    for p in root.xpath(".//w:p", namespaces=NS):
        texts = [t.text for t in p.xpath(".//w:t", namespaces=NS) if t.text]
        if texts:
            paras.append("".join(texts))
    return "\n".join(paras) + "\n"


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("a_docx")
    ap.add_argument("b_docx")
    ap.add_argument("--outdir", required=True)
    ap.add_argument(
        "--render_py",
        default=str(Path(__file__).resolve().parents[1] / "render_docx.py"),
        help="Path to render_docx.py",
    )
    args = ap.parse_args()

    outdir = Path(args.outdir)
    a_render = outdir / "a_render"
    b_render = outdir / "b_render"
    diff_dir = outdir / "diff_pages"

    _run_render(args.render_py, args.a_docx, str(a_render))
    _run_render(args.render_py, args.b_docx, str(b_render))

    a_pages = _list_pages(str(a_render))
    b_pages = _list_pages(str(b_render))

    max_pages = max(len(a_pages), len(b_pages))
    changed = []

    for i in range(1, max_pages + 1):
        a_p = a_render / f"page-{i}.png"
        b_p = b_render / f"page-{i}.png"
        if not a_p.exists() or not b_p.exists():
            changed.append(i)
            continue
        out_p = diff_dir / f"diff-page-{i}.png"
        if _diff_images(a_p, b_p, out_p):
            changed.append(i)

    # Structural text diff
    text_a = _extract_text(args.a_docx)
    text_b = _extract_text(args.b_docx)
    _write_text(outdir / "text_a.txt", text_a)
    _write_text(outdir / "text_b.txt", text_b)

    import difflib

    diff_lines = difflib.unified_diff(
        text_a.splitlines(keepends=True),
        text_b.splitlines(keepends=True),
        fromfile="a",
        tofile="b",
    )
    text_diff = "".join(diff_lines)
    _write_text(outdir / "text_diff.txt", text_diff)

    summary = {
        "a_docx": os.path.abspath(args.a_docx),
        "b_docx": os.path.abspath(args.b_docx),
        "pages_a": len(a_pages),
        "pages_b": len(b_pages),
        "changed_pages": changed,
        "num_changed_pages": len(changed),
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[OK] wrote {outdir}")
    print(f"[summary] changed_pages={changed}")


if __name__ == "__main__":
    main()
