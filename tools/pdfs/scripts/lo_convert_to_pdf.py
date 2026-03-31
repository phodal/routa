#!/usr/bin/env python3
"""Convert an Office document (DOCX/PPTX/ODT/...) to PDF using LibreOffice.

Examples:
  python lo_convert_to_pdf.py input.docx --out_dir /mnt/data/out
  python lo_convert_to_pdf.py deck.pptx --out_dir /mnt/data/out

Notes:
- Conversion quality varies by file. Always render the output PDF to images and inspect.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def _resolve_input_file(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    if not path.exists():
        raise SystemExit(f"Input file not found: {path}")
    if not path.is_file():
        raise SystemExit(f"Input path must be a file: {path}")
    return path


def _resolve_output_dir(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    path.mkdir(parents=True, exist_ok=True)
    return path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_file")
    p.add_argument("--out_dir", required=True)
    args = p.parse_args()

    inp = _resolve_input_file(args.input_file)
    out_dir = _resolve_output_dir(args.out_dir)

    cmd = [
        "soffice",
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out_dir),
        str(inp),
    ]
    print(" ".join(cmd))

    # LibreOffice can occasionally exit non-zero while still writing output.
    # Treat existence + readability of the output PDF as the primary success signal.
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)  # nosemgrep

    # LibreOffice names output based on input stem.
    out_pdf = out_dir / f"{inp.stem}.pdf"
    if not out_pdf.exists():
        # Some formats may change the stem slightly; best-effort search.
        matches = list(out_dir.glob("*.pdf"))
        if len(matches) == 1:
            out_pdf = matches[0]

    if not out_pdf.exists() or out_pdf.stat().st_size == 0:
        raise RuntimeError(
            "LibreOffice conversion did not produce a PDF.\n"
            f"exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )

    # Sanity-check that the PDF is parseable and non-empty.
    try:
        from pypdf import PdfReader

        r = PdfReader(str(out_pdf))
        if len(r.pages) == 0:
            raise RuntimeError("Output PDF has zero pages")
    except Exception as e:
        raise RuntimeError(
            "LibreOffice produced a PDF, but it does not appear to be a valid PDF.\n"
            f"exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        ) from e

    if proc.returncode != 0:
        print(f"[WARN] soffice exited with code {proc.returncode}, but output PDF looks valid.")
    print(str(out_pdf))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
