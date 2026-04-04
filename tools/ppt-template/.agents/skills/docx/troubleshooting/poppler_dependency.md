# Troubleshooting: poppler / pdfinfo dependency

## Symptom: `pdfinfo not found` or `PDFInfoNotInstalledError`

When running `render_docx.py`, you get an error like:

```
FileNotFoundError: [Errno 2] No such file or directory: 'pdfinfo'
pdf2image.exceptions.PDFInfoNotInstalledError: Unable to get page count. Is poppler installed and in PATH?
```

## Root cause

`render_docx.py` uses the `pdf2image` Python library to convert PDF pages to PNG images for visual QA. `pdf2image` requires the `poppler` utility suite (specifically the `pdfinfo` command) to be installed on your system.

## Fix: Install poppler

### macOS

```bash
# Using Homebrew (recommended)
brew install poppler

# Verify installation
which pdfinfo
# Should output: /opt/homebrew/bin/pdfinfo or /usr/local/bin/pdfinfo
```

### Linux (Debian/Ubuntu)

```bash
sudo apt-get install poppler-utils
```

### Linux (RHEL/CentOS/Fedora)

```bash
sudo dnf install poppler-utils
# or
sudo yum install poppler-utils
```

### Windows

1. Download poppler from the [poppler-windows releases](https://github.com/oschwartz10612/poppler-windows/releases/)
2. Extract to a directory (e.g., `C:\poppler`)
3. Add the `bin` directory to your PATH:
   - Search for "Environment Variables" in Windows
   - Edit `Path` under System or User variables
   - Add `C:\poppler\Library\bin`
4. Restart your terminal/IDE

## Verify the fix

```bash
# Test that pdfinfo is available
pdfinfo --version

# Re-run render_docx.py
python render_docx.py /path/to/input.docx --output_dir /path/to/out
```

## Alternative: Skip rendering

If you only need to generate a DOCX file (not PNGs/PDFs), you can skip rendering entirely:

1. Generate the DOCX using python-docx
2. Open it directly in Word, LibreOffice, or WPS for visual review

## Note for containerized environments

In Docker or similar containers, you'll need to install poppler at build time:

```dockerfile
# For Debian-based images
RUN apt-get update && apt-get install -y poppler-utils

# For Alpine-based images
RUN apk add poppler-utils
```
