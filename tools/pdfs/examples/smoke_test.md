# Smoke test (quick sanity check)

This is a quick end-to-end check that the PDF tooling works.

If you're debugging a regression, prefer the dedicated tests:

```bash
python3 tools/pdfs/scripts/edit_smoketest.py --workdir /tmp/_pdf_edit_smoke
python3 tools/pdfs/scripts/forms_smoketest.py --workdir /tmp/_pdf_forms_smoke
python3 tools/pdfs/scripts/redact_smoketest.py --workdir /tmp/_pdf_redact_smoke
```

```bash
mkdir -p /mnt/data/_pdf_smoke && cd /mnt/data/_pdf_smoke

# 1) Create a tiny PDF via ReportLab
python - <<'PY'
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch

out='sample.pdf'
c=canvas.Canvas(out, pagesize=letter)
w,h=letter
c.setFont('Helvetica-Bold', 16)
c.drawString(1*inch, h-1*inch, 'PDF Smoke Test')
c.setFont('Helvetica', 11)
c.drawString(1*inch, h-1.4*inch, 'Hello PDF')
c.showPage(); c.save()
print('Wrote', out)
PY

# 2) Render it
python3 tools/pdfs/scripts/render_pdf.py sample.pdf --out_dir render

# 3) Inspect metadata
python3 tools/pdfs/scripts/pdf_inspect.py sample.pdf

# 4) Extract text
python3 tools/pdfs/scripts/pdf_extract.py text sample.pdf --method pdfplumber

# 5) Add page numbers
python3 tools/pdfs/scripts/pdf_edit.py paginate sample.pdf -o numbered.pdf
python3 tools/pdfs/scripts/render_pdf.py numbered.pdf --out_dir render_numbered

# 6) Visual diff
python3 tools/pdfs/scripts/compare_renders.py sample.pdf numbered.pdf --out_dir diff --dpi 200
```

## Optional extras

### Preflight + normalize
```bash
python3 tools/pdfs/scripts/pdf_preflight.py numbered.pdf
python3 tools/pdfs/scripts/pdf_edit.py optimize numbered.pdf -o normalized.pdf --recover --optimize_streams --compress_streams
python3 tools/pdfs/scripts/render_pdf.py normalized.pdf --out_dir render_normalized
```

### True redaction (remove underlying text)
```bash
python3 tools/pdfs/scripts/pdf_redact.py text numbered.pdf redacted.pdf --text "Hello" --ignore_case
pdftotext redacted.pdf - | grep -i "hello" && echo "STILL PRESENT" || echo "OK: not found"
python3 tools/pdfs/scripts/render_pdf.py redacted.pdf --out_dir render_redacted
```

### Renderer parity
```bash
python3 tools/pdfs/scripts/renderer_parity.py redacted.pdf --out_dir parity --dpi 200
```
