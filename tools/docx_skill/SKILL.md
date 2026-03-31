---
name: docx
description: Use this skill for DOCX creation, rewrite, structured document authoring, or export of reports, proposals, briefs, and technical documentation to Word format. Triggers include requests to create a Word document, generate a .docx from markdown or structured content, polish a business document, or prepare a shareable DOCX deliverable.
metadata:
  short-description: DOCX workflows
---

# DOCX Skill

Use the repo-local DOCX workflow centered on `pandoc`.

## Environment reality

- `pandoc` is available in this repo environment and is the default path for generating `.docx`
- `soffice` / LibreOffice is not guaranteed to exist here, so visual DOCX-to-PDF QA is optional and environment-dependent
- Favor accurate content structure first: headings, tables, lists, callouts, and consistent hierarchy

## Default workflow

1. Draft the document in Markdown with clean heading structure.
2. Generate the DOCX with `pandoc`.
3. Verify the `.docx` exists and inspect its OOXML text if needed.
4. If LibreOffice is available later, optionally convert to PDF for visual QA.

## Core commands

### Create DOCX from Markdown

```bash
pandoc input.md -o output.docx
```

### Create DOCX with a reference template

```bash
pandoc input.md -o output.docx --reference-doc=reference.docx
```

### Inspect textual content quickly

```bash
unzip -p output.docx word/document.xml | sed -n '1,160p'
```

### Optional PDF QA when LibreOffice is available

```bash
python3 tools/pdfs/scripts/lo_convert_to_pdf.py output.docx --out_dir /tmp/docx-pdf-qa
```

If `soffice` is missing, skip this step rather than claiming a visual QA pass.

## Authoring guidance

- Use DOCX for text-heavy business documents, reports, proposals, SOPs, and handbooks.
- Prefer DOCX over PDF when the user will continue editing the document.
- Prefer PPTX over DOCX for slide-like layouts.
- Prefer PDF only as the final export format when editability is not needed.

## Quality bar

- Clear heading ladder and consistent section spacing
- Tables sized for content, not equal-width by default
- Readable body type and restrained emphasis
- No invented facts: ground the document in repo sources or user-provided material
- If you cannot visually QA the DOCX in the current environment, say so explicitly

## Deliverable discipline

- Return the requested `.docx` as the primary artifact
- Keep temporary Markdown or extracted XML out of the final deliverable path unless the user asked for them
