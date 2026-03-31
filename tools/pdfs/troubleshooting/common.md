# Troubleshooting

## The PDF looks different after edits

- Always render both the input and output PDFs to PNGs and compare.
- Common culprits:
  - Different `MediaBox/CropBox/TrimBox` settings.
  - Missing fonts (fallback fonts can change line breaks).
  - Watermark/page-number overlays that don't match per-page sizes.

## "Black squares" / missing glyphs

- PDF viewers can substitute fonts differently.
- Avoid unusual Unicode punctuation. Use ASCII hyphens (`-`), quotes (`"`), etc.
- If you need full Unicode coverage, use a Unicode font and embed it (LaTeX with `xelatex` is the easiest path).

## `pdftoppm` warnings (syntax errors)

Poppler is strict and may print warnings like "syntax error" but still render correctly. Use the PNG output as the source of truth.

If Poppler fails outright:
- Try rendering with `pypdfium2`:

```bash
python3 tools/pdfs/scripts/render_pdf.py input.pdf --engine pdfium
```

## OCR errors / `ocrmypdf` refuses

- If `ocrmypdf` complains about Ghostscript regressions in `--skip-text` or `--redo-ocr` modes, use `--force-ocr` for image-only PDFs:

```bash
python3 tools/pdfs/scripts/ocr_pdf.py input.pdf -o out.pdf --force
```

- If OCR quality is poor, render the page to a higher DPI image first and re-OCR (sometimes helps for tiny fonts).

## Table extraction is messy

- Many "tables" are just positioned text. Expect imperfect extraction.
- Try both `pdfplumber` and (if available) `pymupdf` word boxes.
- For high-stakes tables, consider:
  - OCR + table re-detection
  - Manual reconstruction into a spreadsheet
  - Asking the user for the original XLSX/DOCX

## Cropping confusion

- `CropBox` changes the visible region; it does not delete content.
- Coordinates:
  - `pypdf` page boxes use a bottom-left origin.
  - `pdfplumber` and `pymupdf` word boxes are typically top-left origin.

## Encryption / permissions

- Some PDFs are encrypted with owner-only permissions.
- `pypdf` can decrypt if you have the password; otherwise you cannot legally/technically remove encryption.
