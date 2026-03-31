---
name: pdf
description: Use this skill for PDF generation, conversion, inspection, extraction, editing, form filling, OCR, redaction, or render comparison. Triggers include requests to create a PDF, convert Markdown or HTML or LaTeX or DOCX or PPTX to PDF, extract text or tables or images, fill or inspect forms, OCR scans, compare revisions, or redact content.
metadata:
  short-description: PDF workflows
---

# PDF Skill

The canonical PDF toolkit for this repo lives in `tools/pdfs/`.

Before doing PDF work:

1. Read `tools/pdfs/SKILL.md`.
2. Use repo-local scripts under `tools/pdfs/scripts/`.
3. Follow the render -> inspect -> operate -> re-render verify loop.

Load these only when needed:

- `tools/pdfs/tasks/js_tools.md`
- `tools/pdfs/tasks/forms_debugging.md`
- `tools/pdfs/troubleshooting/common.md`
- `tools/pdfs/examples/smoke_test.md`
