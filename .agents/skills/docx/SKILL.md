---
name: docx
description: Use this skill for DOCX creation, rewrite, structured document authoring, or export of reports, proposals, briefs, and technical documentation to Word format. Triggers include requests to create a Word document, generate a .docx from markdown or structured content, polish a business document, or prepare a shareable DOCX deliverable.
metadata:
  short-description: DOCX workflows
---

# DOCX Skill

The canonical DOCX workflow for this repo lives in `tools/docx_skill/`.

Before doing DOCX work:

1. Read `tools/docx_skill/SKILL.md`.
2. Prefer `pandoc` for generation.
3. Verify the generated `.docx` exists and inspect content through `word/document.xml` when needed.
4. Only claim visual QA if LibreOffice-based conversion is actually available.
