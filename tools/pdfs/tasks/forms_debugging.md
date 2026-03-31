# Forms debugging (field exists but won't fill)

Use this when:
- field name mismatch errors
- checkbox/radio fills with wrong state
- dropdown doesn't accept a value
- values appear only in some viewers

---

## Golden path: inspect widgets and acceptable values

```bash
python3 tools/pdfs/scripts/pdf_extract.py forms input.pdf --out /tmp/fields.json --include_widgets
```

What to look for in the JSON:

- `widgets[].page` and `widgets[].rect`: confirms the field is on the expected page and where it is.
- `options`: for dropdown/list fields, valid choices.
- `appearance_states`: for checkboxes/radios, valid "on" states (usually something like `/Yes` or `/1`).

---

## Common failure modes

### 1) Field fills but isn't visible

Cause: missing appearance stream; viewer may synthesize it.

Fix:
- prefer pdf-lib fill + flatten (most robust)
- if using pypdf fill, try setting `/NeedAppearances` (see `pdf_edit.py fill-form --need_appearances`) but still verify by rendering.

### 2) Checkbox/radio won't check

Cause: the form expects a specific "on" name.

Fix:
- inspect `appearance_states`
- set the field value to one of those on-states (string) rather than `true`

### 3) Dropdown won't accept a value

Cause: value not in `/Opt`.

Fix:
- inspect `options`
- set the value exactly (case-sensitive)

---

## Viewer verification

At minimum, render with one engine. For tricky docs, compare engines:

```bash
python3 tools/pdfs/scripts/render_pdf.py filled.pdf --engine pdftoppm --out_dir /tmp/_r1
python3 tools/pdfs/scripts/render_pdf.py filled.pdf --engine pdfium --out_dir /tmp/_r2
```

If it looks different, prefer flattening.
