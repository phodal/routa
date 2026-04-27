---
title: "Entrix long-file budget hook panics on Unicode comment boundaries"
date: "2026-04-21"
kind: issue
status: resolved
resolved_at: "2026-04-25"
severity: medium
area: entrix
tags:
  - entrix
  - long-file
  - unicode
  - commit-hook
  - panic
reported_by: "codex"
---

# Entrix long-file budget hook panics on Unicode comment boundaries

## What Happened

During a normal `git commit`, the file-budget hook printed the expected oversized-file warning but then panicked inside `crates/entrix/src/long_file.rs`:

`byte index 117 is not a char boundary; it is inside '─'`

The failure happened while processing a line that contains box-drawing Unicode characters in a comment banner, for example:

`// ── Tools that don't require workspaceId ─────────────────────────────`

The commit still completed, so this is not a hard blocker for shipping, but the hook behavior is unreliable and can obscure real file-budget feedback.

## Expected Behavior

`entrix` should report long-file budget warnings without panicking, even when source files contain Unicode comment banners or other multi-byte characters.

## Why This Might Happen

- long-file formatting or slicing logic appears to be using byte offsets where Rust string character boundaries are required
- hook-mode reporting likely assumes ASCII-safe slicing when building the structure summary
- oversized-file reporting and pretty-print formatting may share a path that is not Unicode-safe

## Relevant Files

- `crates/entrix/src/long_file.rs`
- `crates/entrix/src/cli_output.rs`
- `crates/entrix/src/main.rs`

## Reproduction Context

1. stage a commit that includes an oversized file
2. ensure the file contains a Unicode comment banner such as `─`
3. run `git commit`
4. observe the long-file warning, followed by the panic

## Impact

- commit-hook output becomes noisy and less trustworthy
- real long-file guidance can be hidden behind panic text
- future automation may misinterpret the hook result if the panic changes exit behavior

## Resolution Notes

- Replaced byte-index slicing in Entrix long-file comment preview formatting with character-safe truncation.
- Added a regression test covering a long Unicode box-drawing comment banner like the one seen in commit-hook output.

## Verification Notes

- `cargo test -p entrix long_file -- --nocapture`
  - PASS (`8 passed`)
- `entrix run --tier fast`
  - PASS
