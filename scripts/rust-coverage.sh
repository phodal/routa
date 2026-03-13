#!/usr/bin/env bash
set -euo pipefail

CRATE="${1:-routa-core}"
FORMAT="${2:-summary}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found" >&2
  exit 1
fi

if ! cargo llvm-cov --version >/dev/null 2>&1; then
  echo "cargo-llvm-cov is not installed." >&2
  echo "Install with:" >&2
  echo "  rustup component add llvm-tools-preview" >&2
  echo "  cargo install cargo-llvm-cov" >&2
  exit 2
fi

case "$FORMAT" in
  summary)
    cargo llvm-cov -p "$CRATE" --summary-only
    ;;
  lcov)
    mkdir -p target/coverage
    cargo llvm-cov -p "$CRATE" --lcov --output-path target/coverage/${CRATE}.lcov
    echo "LCOV written to target/coverage/${CRATE}.lcov"
    ;;
  html)
    cargo llvm-cov -p "$CRATE" --html
    echo "HTML report written to target/llvm-cov/html/index.html"
    ;;
  *)
    echo "Unsupported format: $FORMAT" >&2
    echo "Use one of: summary | lcov | html" >&2
    exit 1
    ;;
esac
