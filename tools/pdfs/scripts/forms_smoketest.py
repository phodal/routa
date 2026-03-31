#!/usr/bin/env python3
"""End-to-end smoke test for forms filling correctness.

What it tests:
  - Generate a tiny AcroForm PDF (text field + checkbox)
  - Fill + flatten via pdf-lib (Node)
  - Render before/after and run compare_renders to ensure pixels changed

Run:
  python forms_smoketest.py --workdir /mnt/data/_pdf_forms_smoke
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def _make_form_pdf(path: Path) -> None:
    w, h = letter
    c = canvas.Canvas(str(path), pagesize=(w, h))
    c.setFont("Helvetica", 12)
    c.drawString(72, h - 72, "Forms smoke test")
    c.drawString(72, h - 110, "Name:")

    # Text field
    c.acroForm.textfield(
        name="name",
        tooltip="Name",
        x=120,
        y=h - 122,
        width=240,
        height=18,
        borderStyle="inset",
        borderWidth=1,
        forceBorder=True,
    )

    # Checkbox
    c.drawString(72, h - 150, "I agree")
    c.acroForm.checkbox(
        name="agree",
        tooltip="Agree",
        x=120,
        y=h - 160,
        size=14,
        checked=False,
        borderWidth=1,
        forceBorder=True,
    )

    c.showPage()
    c.save()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workdir", default="/mnt/data/_pdf_forms_smoke")
    p.add_argument("--dpi", type=int, default=200)
    args = p.parse_args()

    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)
    inp = wd / "form_in.pdf"
    out = wd / "form_filled.pdf"
    values = wd / "values.json"

    _make_form_pdf(inp)
    values.write_text(json.dumps({"name": "Ada Lovelace", "agree": True}, indent=2), encoding="utf-8")

    # Ensure JS deps
    js_dir = Path(__file__).resolve().parents[1] / "js"
    subprocess.check_call(["bash", str(js_dir / "install_deps.sh")])

    # Fill + flatten via pdf-lib
    subprocess.check_call(
        [
            "node",
            str(js_dir / "fill_form.mjs"),
            "--input",
            str(inp),
            "--values",
            str(values),
            "--output",
            str(out),
            "--flatten",
        ]
    )

    # Compare renders
    diff_dir = wd / "diff"
    subprocess.check_call(
        [
            "python",
            str(Path(__file__).with_name("compare_renders.py")),
            str(inp),
            str(out),
            "--out_dir",
            str(diff_dir),
            "--dpi",
            str(args.dpi),
        ]
    )

    summary = json.loads((diff_dir / "summary.json").read_text(encoding="utf-8"))
    if int(summary.get("changed_pages", 0)) < 1:
        raise SystemExit("[FAIL] No visual change detected; form fill likely failed")
    print(f"[OK] forms smoke test passed. changed_pages={summary['changed_pages']}")
    print(str(wd))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
