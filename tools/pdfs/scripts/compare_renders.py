#!/usr/bin/env python3
"""Visual diff two PDFs by rendering pages and computing pixel diffs.

Golden path:
  python compare_renders.py a.pdf b.pdf --out_dir /mnt/data/_diff --dpi 200

Outputs:
  - /mnt/data/_diff/summary.json
  - /mnt/data/_diff/diff/page-<N>.png (only for changed pages)
  - /mnt/data/_diff/render_a/... and /mnt/data/_diff/render_b/... (renders)

Why this exists:
  Many PDF edits "succeed" structurally but fail visually (clipping, missing glyphs,
  wrong checkbox marks, etc.). A pixel diff catches these regressions quickly.
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
        # Pad to the larger size (avoids resampling artifacts)
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

    # Estimate fraction of changed pixels by thresholding any channel diff > 0.
    # (We avoid numpy to keep dependencies minimal.)
    # Convert to L (max across channels) for quick threshold.
    gray = diff.convert("L")
    hist = gray.histogram()
    total = im_a.width * im_a.height
    zero = hist[0]
    changed = total - zero
    pct = float(changed) / float(total) if total else 0.0
    max_channel = max(i for i, v in enumerate(hist) if v)
    return {"changed": True, "bbox": list(map(int, bbox)), "pct_changed": pct, "max_channel": int(max_channel), "diff": diff}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf_a")
    p.add_argument("pdf_b")
    p.add_argument("--out_dir", required=True)
    p.add_argument("--dpi", type=int, default=200)
    p.add_argument("--engine", choices=["pdftoppm", "pdfium"], default="pdftoppm")
    p.add_argument("--save_renders", action="store_true", help="Keep renders under out_dir/render_a|render_b")
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    render_a = out_dir / "render_a"
    render_b = out_dir / "render_b"
    diff_dir = out_dir / "diff"
    diff_dir.mkdir(parents=True, exist_ok=True)

    _render(Path(args.pdf_a), render_a, dpi=args.dpi, engine=args.engine)
    _render(Path(args.pdf_b), render_b, dpi=args.dpi, engine=args.engine)

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
        record: Dict[str, Any] = {
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
            diff_img: Image.Image = res["diff"]
            diff_path = diff_dir / f"page-{i+1}.png"
            diff_img.save(diff_path)
            record["diff"] = str(diff_path)
        per_page.append(record)

    summary = {
        "pdf_a": str(Path(args.pdf_a)),
        "pdf_b": str(Path(args.pdf_b)),
        "dpi": args.dpi,
        "engine": args.engine,
        "pages_a": len(pages_a),
        "pages_b": len(pages_b),
        "changed_pages": changed_pages,
        "per_page": per_page,
    }

    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(str(out_dir / "summary.json"))

    if not args.save_renders:
        # Keep only diffs + summary by default.
        for d in [render_a, render_b]:
            for pth in d.glob("*.png"):
                pth.unlink(missing_ok=True)
            # Remove directory if empty.
            try:
                d.rmdir()
            except OSError:
                pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
