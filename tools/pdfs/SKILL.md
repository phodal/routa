---
name: pdf
description: Use this skill for PDF generation, conversion, inspection, extraction, editing, form filling, OCR, redaction, or render comparison. Triggers include requests to create a PDF, convert Markdown or HTML or LaTeX or DOCX or PPTX to PDF, extract text or tables or images, fill or inspect forms, OCR scans, compare revisions, or redact content.
metadata:
  short-description: PDF workflows
---

# PDF Skill

Use the repo-local toolkit under `tools/pdfs/`. The default operating loop is:

1. Render to images.
2. Inspect layout visually.
3. Perform the edit, extraction, or generation.
4. Re-render and verify.

## Choose the right authoring path first

Even if the user wants a PDF deliverable, PDF is not always the right authoring format.

- Text-heavy business docs: author in DOCX first, then convert with `python3 tools/pdfs/scripts/lo_convert_to_pdf.py ...`
- Slide-like visual layouts: author in PPTX first, then export to PDF
- Direct PDF generation or low-level edits: use this toolkit

If you are hand-tuning line breaks in a programmatically generated PDF, stop and reconsider whether DOCX or PPTX is the better source format.

## Core loop

Render before and after any meaningful change:

```bash
python3 tools/pdfs/scripts/render_pdf.py input.pdf --out_dir /tmp/pdf-renders-in --dpi 200
python3 tools/pdfs/scripts/compare_renders.py before.pdf after.pdf --out_dir /tmp/pdf-diff --dpi 200
```

Rendered PNGs are the source of truth for layout QA. Do not trust extracted text alone for tables, forms, spacing, or clipping.

## Common workflows

### Inspect / extract

```bash
python3 tools/pdfs/scripts/pdf_inspect.py input.pdf
python3 tools/pdfs/scripts/pdf_extract.py text input.pdf --method pdfplumber
python3 tools/pdfs/scripts/pdf_extract.py tables input.pdf
python3 tools/pdfs/scripts/pdf_extract.py forms input.pdf --include_widgets
```

### Edit / normalize

```bash
python3 tools/pdfs/scripts/pdf_edit.py paginate input.pdf -o output.pdf
python3 tools/pdfs/scripts/pdf_edit.py merge a.pdf b.pdf -o merged.pdf
python3 tools/pdfs/scripts/pdf_edit.py rotate input.pdf -o rotated.pdf --pages 1 --degrees 90
python3 tools/pdfs/scripts/pdf_preflight.py input.pdf
```

### Redact / OCR

```bash
python3 tools/pdfs/scripts/pdf_redact.py text input.pdf redacted.pdf --text "secret" --ignore_case
python3 tools/pdfs/scripts/ocr_pdf.py scan.pdf -o searchable.pdf --force
```

### Create / convert

```bash
python3 tools/pdfs/scripts/md_to_pdf.py input.md -o output.pdf
python3 tools/pdfs/scripts/html_to_pdf.py input.html -o output.pdf
python3 tools/pdfs/scripts/latex_to_pdf.py input.tex -o output.pdf
python3 tools/pdfs/scripts/lo_convert_to_pdf.py input.docx -o output.pdf
```

### Forms

Best-effort Python path:

```bash
python3 tools/pdfs/scripts/pdf_edit.py fill-form in.pdf --values values.json -o out.pdf
```

If the form is stubborn, use the Node helpers:

```bash
bash tools/pdfs/js/install_deps.sh
node tools/pdfs/js/extract_form_fields.mjs --input in.pdf
node tools/pdfs/js/fill_form.mjs --input in.pdf --values values.json --output out.pdf --flatten
```

## Quality bar for generated PDFs

- No clipped text, overlaps, broken glyphs, or boundary-hugging table content
- Verify visually after each material change
- Prefer generous spacing and intentional column widths over dense layouts
- Keep captions, tables, and figures visually paired
- For tricky forms, verify in two renderers when possible

## Load extra references only when needed

- `tools/pdfs/tasks/js_tools.md`: Node helpers for forms and PDF.js extraction
- `tools/pdfs/tasks/forms_debugging.md`: widget-level debugging workflow
- `tools/pdfs/troubleshooting/common.md`: renderer and OCR troubleshooting
- `tools/pdfs/examples/smoke_test.md`: runnable smoke flows

## Toolkit map

- `tools/pdfs/scripts/render_pdf.py`: render PDF pages to PNGs
- `tools/pdfs/scripts/compare_renders.py`: render and diff two PDFs
- `tools/pdfs/scripts/pdf_inspect.py`: metadata and structure overview
- `tools/pdfs/scripts/pdf_extract.py`: text, tables, images, attachments, annotations, forms
- `tools/pdfs/scripts/pdf_edit.py`: merge, split, rotate, crop, paginate, encrypt, optimize, fill-form
- `tools/pdfs/scripts/pdf_preflight.py`: warnings and normalization hints
- `tools/pdfs/scripts/pdf_redact.py`: true redaction
- `tools/pdfs/scripts/ocr_pdf.py`: OCR wrapper
- `tools/pdfs/scripts/md_to_pdf.py`: Markdown to PDF
- `tools/pdfs/scripts/html_to_pdf.py`: HTML to PDF
- `tools/pdfs/scripts/latex_to_pdf.py`: LaTeX to PDF
- `tools/pdfs/scripts/lo_convert_to_pdf.py`: LibreOffice-based conversion
- `tools/pdfs/js/*.mjs`: PDF.js and pdf-lib helpers

## Final deliverable expectations

- Keep only the final PDF in the requested output location unless the user asked for intermediates.
- When the task is layout-sensitive, include a quick render verification pass before stopping.
- Prefer ASCII `-` over typographic dashes in generated content when renderer compatibility is uncertain.
