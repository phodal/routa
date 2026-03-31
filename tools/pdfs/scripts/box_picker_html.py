#!/usr/bin/env python3
"""Generate an interactive HTML "box picker" for precise placement on a PDF page.

Why:
  For non-fillable forms (no AcroForm fields), you often need to stamp text/marks
  into exact rectangles. This tool makes it fast to create those rectangles.

What it does:
  1) Renders a PDF page to PNG (given dpi)
  2) Writes a self-contained HTML that lets you draw rectangles on the image
  3) Exports a JSON spec with rectangles converted into PDF user-space points (pt)

Golden path:
  python box_picker_html.py input.pdf --page 1 --dpi 200 --out /mnt/data/box_picker.html
  # Open the HTML in a browser, draw boxes, export JSON.

JSON output (from the UI):
  {
    "dpi": 200,
    "page": 1,
    "items": [
      {"name": "field_1", "rect": [x0,y0,x1,y1], "kind": "text"}
    ]
  }
where rect is in PDF points, origin bottom-left.
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path

from pypdf import PdfReader


def _render_first_page(pdf: Path, page: int, dpi: int, out_png: Path) -> None:
    out_png.parent.mkdir(parents=True, exist_ok=True)
    # Reuse our renderer for consistency.
    import subprocess

    tmp_dir = out_png.parent
    subprocess.check_call(
        [
            "python",
            str(Path(__file__).with_name("render_pdf.py")),
            str(pdf),
            "--out_dir",
            str(tmp_dir),
            "--pages",
            str(page),
            "--dpi",
            str(dpi),
            "--engine",
            "pdftoppm",
        ]
    )
    # render_pdf writes page-<N>.png
    generated = tmp_dir / f"page-{page}.png"
    if not generated.exists():
        # fallback (some renderers use 1-based indexing in filenames)
        candidates = sorted(tmp_dir.glob("page-*.png"))
        if len(candidates) == 1:
            generated = candidates[0]
    generated.replace(out_png)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_pdf")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--dpi", type=int, default=200)
    p.add_argument("--out", required=True, help="Output HTML path")
    p.add_argument("--tmp_dir", default="/mnt/data/_box_picker", help="Temp render directory")
    args = p.parse_args()

    inp = Path(args.input_pdf)
    reader = PdfReader(str(inp))
    if not (1 <= args.page <= len(reader.pages)):
        raise SystemExit(f"--page must be in [1,{len(reader.pages)}]")

    page_obj = reader.pages[args.page - 1]
    w_pt = float(page_obj.mediabox.width)
    h_pt = float(page_obj.mediabox.height)

    tmp_dir = Path(args.tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    png_path = tmp_dir / "page.png"
    _render_first_page(inp, page=args.page, dpi=args.dpi, out_png=png_path)

    b64 = base64.b64encode(png_path.read_bytes()).decode("ascii")
    out_html = Path(args.out)
    out_html.parent.mkdir(parents=True, exist_ok=True)

    # Pixel->pt: x_pt = x_px * 72/dpi ; y_pt = (img_h_px - y_px) * 72/dpi
    html = f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>PDF Box Picker</title>
  <style>
    body {{ font-family: sans-serif; margin: 16px; }}
    #wrap {{ display: grid; grid-template-columns: 1fr 320px; gap: 16px; align-items: start; }}
    canvas {{ border: 1px solid #ccc; max-width: 100%; height: auto; }}
    textarea {{ width: 100%; height: 260px; }}
    .row {{ margin: 8px 0; }}
    button {{ padding: 6px 10px; }}
  </style>
</head>
<body>
  <h2>PDF Box Picker</h2>
  <div class=\"row\">PDF: <code>{inp.name}</code> · page: <b>{args.page}</b> · dpi: <b>{args.dpi}</b> · page size: <b>{w_pt:.2f}×{h_pt:.2f} pt</b></div>
  <div id=\"wrap\">
    <div>
      <canvas id=\"c\"></canvas>
      <div class=\"row\">Drag to draw a rectangle. Click a rectangle in the list to rename or delete.</div>
    </div>
    <div>
      <div class=\"row\">
        Default kind:
        <select id=\"kind\">
          <option value=\"text\">text</option>
          <option value=\"check\">checkbox</option>
        </select>
      </div>
      <div class=\"row\"><button id=\"export\">Export JSON</button> <button id=\"clear\">Clear</button></div>
      <textarea id=\"out\" placeholder=\"JSON output...\"></textarea>
      <div class=\"row\"><small>Coordinate system: PDF user space (pt), origin bottom-left.</small></div>
    </div>
  </div>

<script>
const IMG_B64 = "data:image/png;base64,{b64}";
const DPI = {args.dpi};
let boxes = []; // {{name, kind, rect_px:[x0,y0,x1,y1]}}

const img = new Image();
img.src = IMG_B64;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let drag = null;

function redraw() {{
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img, 0, 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'red';
  ctx.fillStyle = 'rgba(255,0,0,0.10)';
  for (const b of boxes) {{
    const [x0,y0,x1,y1] = b.rect_px;
    const w = x1-x0;
    const h = y1-y0;
    ctx.fillRect(x0,y0,w,h);
    ctx.strokeRect(x0,y0,w,h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x0, Math.max(0,y0-16), Math.min(canvas.width-x0, 160), 16);
    ctx.fillStyle = 'black';
    ctx.font = '12px sans-serif';
    ctx.fillText(b.name + ' (' + b.kind + ')', x0+3, Math.max(12,y0-4));
    ctx.fillStyle = 'rgba(255,0,0,0.10)';
  }}
}}

function pxToPt(rect_px) {{
  // IMPORTANT:
  //  - The canvas/image coordinate system is pixels with origin at top-left.
  //  - PDF user space is points (1/72 inch) with origin at bottom-left.
  // Convert directly from pixels to points in one step to avoid mixing units.
  const scale = 72.0 / DPI;
  const [x0,y0,x1,y1] = rect_px;
  const imgH_px = canvas.height;
  const left = x0 * scale;
  const right = x1 * scale;
  // In image-space y0 is the top edge, y1 is the bottom edge.
  const bottom = (imgH_px - y1) * scale;
  const top = (imgH_px - y0) * scale;
  return [left, bottom, right, top];
}}

img.onload = () => {{
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  redraw();
}};

canvas.addEventListener('mousedown', (e) => {{
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (canvas.width / r.width);
  const y = (e.clientY - r.top) * (canvas.height / r.height);
  drag = {{x0:x, y0:y, x1:x, y1:y}};
}});
canvas.addEventListener('mousemove', (e) => {{
  if (!drag) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (canvas.width / r.width);
  const y = (e.clientY - r.top) * (canvas.height / r.height);
  drag.x1 = x; drag.y1 = y;
  redraw();
  ctx.strokeStyle = 'blue';
  const x0 = Math.min(drag.x0, drag.x1);
  const y0 = Math.min(drag.y0, drag.y1);
  const x1 = Math.max(drag.x0, drag.x1);
  const y1 = Math.max(drag.y0, drag.y1);
  ctx.strokeRect(x0,y0,x1-x0,y1-y0);
}});
canvas.addEventListener('mouseup', () => {{
  if (!drag) return;
  const x0 = Math.min(drag.x0, drag.x1);
  const y0 = Math.min(drag.y0, drag.y1);
  const x1 = Math.max(drag.x0, drag.x1);
  const y1 = Math.max(drag.y0, drag.y1);
  drag = null;
  if (Math.abs(x1-x0) < 3 || Math.abs(y1-y0) < 3) return;
  const kind = document.getElementById('kind').value;
  // Escape braces for Python f-string: we want a JS template literal here.
  const name = `item_${{boxes.length+1}}`;
  boxes.push({{name, kind, rect_px:[x0,y0,x1,y1]}});
  redraw();
}});

document.getElementById('clear').addEventListener('click', () => {{ boxes = []; redraw(); document.getElementById('out').value=''; }});
document.getElementById('export').addEventListener('click', () => {{
  const items = boxes.map(b => ({{ name:b.name, kind:b.kind, rect: pxToPt(b.rect_px) }}));
  const payload = {{ dpi: DPI, page: {args.page}, items }};
  document.getElementById('out').value = JSON.stringify(payload, null, 2);
}});
</script>
</body>
</html>"""

    out_html.write_text(html, encoding="utf-8")
    print(str(out_html))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
