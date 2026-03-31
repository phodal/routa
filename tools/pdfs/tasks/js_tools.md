# JavaScript PDF helpers (pdf-lib, pdfjs-dist)

These tools are for things Python libraries often struggle with:
- filling and flattening AcroForm fields reliably across viewers
- getting text extraction similar to what browsers do (pdfjs)

---

## Install deps

```bash
bash tools/pdfs/js/install_deps.sh
```

Notes:
- This step requires **network access** (npm downloads dependencies). In this runtime, npm installs work.
- If you are in an offline environment, you can fall back to the Python helpers:
  - Form fill (best-effort): `python3 tools/pdfs/scripts/pdf_edit.py fill-form in.pdf --values values.json -o out.pdf`
  - Text extraction: `python3 tools/pdfs/scripts/pdf_extract.py text in.pdf --method pdfplumber`

---

## Fill form (pdf-lib)

```bash
node tools/pdfs/js/fill_form.mjs --input in.pdf --values values.json --output out.pdf --flatten
```

`values.json` example:

```json
{
  "name": "Ada Lovelace",
  "agree": true,
  "state": "CA"
}
```

---

## List fields (pdf-lib)

```bash
node tools/pdfs/js/extract_form_fields.mjs --input in.pdf
```

---

## Extract text (pdfjs)

```bash
node tools/pdfs/js/extract_text_pdfjs.mjs --input in.pdf > text.txt
```

Tip: prefer Python-based extraction for coordinates/layout (`pdf_extract.py text --layout_json ...`) and use pdfjs text as a cross-check.
