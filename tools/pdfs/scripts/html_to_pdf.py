#!/usr/bin/env python3
"""Render HTML to PDF using Playwright (Chromium).

This is great for template-driven reports with modern CSS.

Examples:
  python html_to_pdf.py report.html --output report.pdf
  python html_to_pdf.py report.html -o report.pdf --format Letter

Notes:
- For local assets (CSS/images), keep them relative to the HTML file.
- Always render the resulting PDF to PNGs and inspect.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("input_html", help="Path to an HTML file")
    p.add_argument("--output", "-o", required=True, help="Output PDF path")
    p.add_argument("--format", default="Letter", help="Page format (e.g., Letter, A4)")
    p.add_argument("--scale", type=float, default=1.0, help="Scale factor (0.1-2.0)")
    p.add_argument("--landscape", action="store_true")
    p.add_argument("--timeout_ms", type=int, default=60_000)
    args = p.parse_args()

    # Normalize some common format spellings (Playwright expects canonical casing).
    fmt_map = {
        "letter": "Letter",
        "legal": "Legal",
        "tabloid": "Tabloid",
        "a4": "A4",
        "a3": "A3",
        "a5": "A5",
    }
    args.format = fmt_map.get(str(args.format).strip().lower(), args.format)

    input_html = Path(args.input_html).resolve()
    if not input_html.exists():
        raise SystemExit(f"Input not found: {input_html}")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    file_url = input_html.as_uri()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(file_url, wait_until="networkidle", timeout=args.timeout_ms)
        page.pdf(
            path=str(out),
            format=args.format,
            scale=args.scale,
            landscape=args.landscape,
            print_background=True,
            prefer_css_page_size=True,
        )
        browser.close()

    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
