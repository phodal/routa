#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -d node_modules ]; then
  echo "[OK] node_modules already present"
  exit 0
fi

# Install into this folder only.
# Use npm (network access required).

echo "[INFO] Installing JS deps (pdf-lib, pdfjs-dist)..."
npm install --silent
echo "[OK] Installed JS deps"
