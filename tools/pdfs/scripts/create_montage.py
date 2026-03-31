#!/usr/bin/env python3
"""Create a simple contact-sheet montage from a list of images.

Intended for quickly skimming multi-page renders.

Examples:
  python create_montage.py /mnt/data/_renders/input --out /mnt/data/montage.png
  python create_montage.py /mnt/data/_renders/input/page-*.png --out /mnt/data/montage.png --cols 4

Notes:
  - Inputs must be raster images (PNG/JPEG).
  - Montage is generated in reading order (sorted by filename).
"""

from __future__ import annotations

import argparse
import glob
from pathlib import Path
from typing import List

from PIL import Image


def _collect_paths(items: List[str]) -> List[Path]:
    paths: List[Path] = []
    for item in items:
        p = Path(item)
        if p.is_dir():
            paths.extend(sorted([x for x in p.iterdir() if x.suffix.lower() in {".png", ".jpg", ".jpeg"}]))
        else:
            expanded = glob.glob(item)
            if expanded:
                paths.extend(sorted([Path(x) for x in expanded]))
            elif p.exists():
                paths.append(p)
    # De-dup while preserving order
    seen = set()
    out: List[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def make_montage(
    image_paths: List[Path],
    out_path: Path,
    cols: int = 4,
    tile_max_w: int = 800,
    margin: int = 10,
    bg: tuple[int, int, int] = (255, 255, 255),
) -> None:
    if not image_paths:
        raise ValueError("No images provided")

    # Load + resize to a consistent tile width (preserve aspect ratio)
    tiles: List[Image.Image] = []
    max_w = 0
    max_h = 0
    for p in image_paths:
        im = Image.open(p).convert("RGB")
        if im.width > tile_max_w:
            scale = tile_max_w / float(im.width)
            im = im.resize((int(im.width * scale), int(im.height * scale)))
        tiles.append(im)
        max_w = max(max_w, im.width)
        max_h = max(max_h, im.height)

    rows = (len(tiles) + cols - 1) // cols
    canvas_w = cols * max_w + (cols + 1) * margin
    canvas_h = rows * max_h + (rows + 1) * margin

    montage = Image.new("RGB", (canvas_w, canvas_h), bg)

    for idx, im in enumerate(tiles):
        r = idx // cols
        c = idx % cols
        x = margin + c * (max_w + margin) + (max_w - im.width) // 2
        y = margin + r * (max_h + margin) + (max_h - im.height) // 2
        montage.paste(im, (x, y))

    montage.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an image montage/contact sheet")
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Image files, globs, or a directory containing images",
    )
    parser.add_argument("--out", type=str, required=True, help="Output montage image path")
    parser.add_argument("--cols", type=int, default=4, help="Columns (default: 4)")
    parser.add_argument(
        "--tile_max_w",
        type=int,
        default=800,
        help="Max tile width in pixels (default: 800)",
    )
    parser.add_argument("--margin", type=int, default=10, help="Margin in pixels (default: 10)")

    args = parser.parse_args()

    paths = _collect_paths(args.inputs)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    make_montage(paths, out_path, cols=args.cols, tile_max_w=args.tile_max_w, margin=args.margin)
    print(str(out_path))


if __name__ == "__main__":
    main()
