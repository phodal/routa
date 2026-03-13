# Fitness Workflow

## Purpose

This directory defines fitness functions for engineering quality, with test coverage as a primary signal.

## Required Flow For Rust Test Work

1. Read `AGENTS.md` testing rules.
2. Read this file (`docs/fitness/README.md`) for fitness gates and commands.
3. Update the detailed tracker in `docs/fitness/unit-test.md`.

## Rust Coverage Gate

- Preferred metric: line coverage from `cargo llvm-cov`.
- Fallback metric (only when tooling unavailable): file-level test-marker ratio.
- Rule: coverage should not decrease for touched Rust crates/files in a PR.

## Setup

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov
```

## Commands

```bash
# npm shortcut
npm run rust:cov

# summary report
./scripts/rust-coverage.sh routa-core summary

# lcov artifact for CI/analysis tools
./scripts/rust-coverage.sh routa-core lcov

# html report
./scripts/rust-coverage.sh routa-core html
```

## Reporting

- Record baseline, current value, and delta in `docs/fitness/unit-test.md`.
- If `cargo llvm-cov` is unavailable, record this as a temporary blocker and use fallback metric.
