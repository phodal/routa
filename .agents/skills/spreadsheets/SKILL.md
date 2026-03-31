---
name: spreadsheets
description: Use this skill for spreadsheet creation, editing, analysis, formatting, formula modeling, charting, or workbook review. Triggers include requests to create or modify an .xlsx file, build a model or tracker, format a workbook, add formulas or charts, or prepare a shareable spreadsheet deliverable.
metadata:
  short-description: Spreadsheet workflows
---

# Spreadsheet Skill

The canonical spreadsheet workflow for this repo lives in `tools/spreadsheets/`.

Before doing spreadsheet work:

1. Read `tools/spreadsheets/SKILL.md`.
2. Prefer `artifact_tool` when available; otherwise use `openpyxl`.
3. Recalculate formulas and render sheets for QA when the chosen toolchain supports it.
4. Verify the workbook exists before finishing.
