#!/usr/bin/env python3
"""Render the same PDF with two engines and diff the results.

Use cases
- Debug "looks fine in one viewer/renderer but broken in another" problems.
- Quickly catch renderer-sensitive issues (missing glyphs, clipped elements, etc.).

Golden path
  python renderer_parity.py input.pdf --out_dir /mnt/data/_parity --dpi 200

Outputs
  - out_dir/render_pdftoppm/page-*.png
  - out_dir/render_pdfium/page-*.png
  - out_dir/diff/page-*.png (only for changed pages)
  - out_dir/summary.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from PIL import Image, ImageChops


def _render(pdf: Path, out_dir: Path, dpi: int, engine: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "python",
        str(Path(__file__).with_name("render_pdf.py")),
        str(pdf),
        "--out_dir",
        str(out_dir),
        "--dpi",
        str(dpi),
        "--engine",
        engine,
    ]
    subprocess.check_call(cmd)


def _sorted_pages(render_dir: Path) -> List[Path]:
    return sorted(render_dir.glob("page-*.png"))


def _diff_images(a: Path, b: Path) -> Dict[str, Any]:
    im_a = Image.open(a).convert("RGB")
    im_b = Image.open(b).convert("RGB")

    if im_a.size != im_b.size:
        w = max(im_a.width, im_b.width)
        h = max(im_a.height, im_b.height)
        ca = Image.new("RGB", (w, h), (255, 255, 255))
        cb = Image.new("RGB", (w, h), (255, 255, 255))
        ca.paste(im_a, (0, 0))
        cb.paste(im_b, (0, 0))
        im_a, im_b = ca, cb

    diff = ImageChops.difference(im_a, im_b)
    bbox = diff.getbbox()
    if bbox is None:
        return {"changed": False, "bbox": None, "pct_changed": 0.0, "max_channel": 0}

    gray = diff.convert("L")
    hist = gray.histogram()
    total = im_a.width * im_a.height
    changed = total - hist[0]
    pct = float(changed) / float(total) if total else 0.0
    max_channel = max(i for i, v in enumerate(hist) if v)
    return {"changed": True, "bbox": list(map(int, bbox)), "pct_changed": pct, "max_channel": int(max_channel), "diff": diff}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_pdf")
    p.add_argument("--out_dir", required=True)
    p.add_argument("--dpi", type=int, default=200)
    p.add_argument("--engine_a", choices=["pdftoppm", "pdfium"], default="pdftoppm")
    p.add_argument("--engine_b", choices=["pdftoppm", "pdfium"], default="pdfium")
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    render_a = out_dir / f"render_{args.engine_a}"
    render_b = out_dir / f"render_{args.engine_b}"
    diff_dir = out_dir / "diff"
    diff_dir.mkdir(parents=True, exist_ok=True)

    _render(Path(args.input_pdf), render_a, dpi=args.dpi, engine=args.engine_a)
    _render(Path(args.input_pdf), render_b, dpi=args.dpi, engine=args.engine_b)

    pages_a = _sorted_pages(render_a)
    pages_b = _sorted_pages(render_b)
    n = max(len(pages_a), len(pages_b))

    per_page = []
    changed_pages = 0
    for i in range(n):
        pa = pages_a[i] if i < len(pages_a) else None
        pb = pages_b[i] if i < len(pages_b) else None
        if pa is None or pb is None:
            per_page.append({"page": i + 1, "missing": True, "a": str(pa) if pa else None, "b": str(pb) if pb else None})
            changed_pages += 1
            continue

        res = _diff_images(pa, pb)
        rec: Dict[str, Any] = {
            "page": i + 1,
            "a": str(pa),
            "b": str(pb),
            "changed": bool(res["changed"]),
            "pct_changed": float(res.get("pct_changed", 0.0)),
            "bbox": res.get("bbox"),
            "max_channel": int(res.get("max_channel", 0)),
        }
        if res["changed"]:
            changed_pages += 1
            diff_path = diff_dir / f"page-{i+1}.png"
            res["diff"].save(diff_path)
            rec["diff"] = str(diff_path)
        per_page.append(rec)

    summary = {
        "input_pdf": str(Path(args.input_pdf)),
        "dpi": args.dpi,
        "engine_a": args.engine_a,
        "engine_b": args.engine_b,
        "pages": n,
        "changed_pages": changed_pages,
        "per_page": per_page,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(str(out_dir / "summary.json"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
