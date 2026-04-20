---
title: "ACP provider inventory can report providers as installed when no runnable adapter exists"
date: "2026-04-06"
status: open
severity: medium
area: cli
tags: ["cli", "acp", "provider", "inventory", "installation", "codex"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/364"]
github_issue: 364
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/364"
---

# ACP provider inventory can report providers as installed when no runnable adapter exists

## What Happened

`routa acp list` reported Codex as `"installed": true` even when the machine had no `codex-acp` executable and `routa chat --provider codex` could not start.

Observed state:

- `routa acp list` included `codex-acp` / `Codex CLI` with `"installed": true`
- `routa acp installed` returned an empty list
- `which codex-acp` returned nothing
- `routa chat --provider codex` failed with `Failed to spawn 'codex-acp'`

## Expected Behavior

- A provider should only be marked installed when Routa can actually resolve a runnable adapter for that provider:
  - a tracked binary path,
  - a recorded managed installation, or
  - a verified runnable wrapper/adapter command.
- Merely having `npx` or `uvx` on `PATH` should not mark a specific provider as installed.

## Reproduction Context

- Environment: local CLI on Linux
- Trigger:
  1. Ensure `npx` is available on `PATH`.
  2. Do not install `codex-acp`.
  3. Run `routa acp list` and inspect Codex.
  4. Compare with `which codex-acp`, `routa acp installed`, and `routa chat --provider codex`.

## Why This Happened

- `quick_check_installed(...)` treats any provider with an `npx` distribution as installed whenever `npx` exists on the system.
- That check does not verify that the specific package, adapter command, or binary can actually be executed.
- The resulting inventory view overstates readiness and can mislead users into treating an unavailable provider as operational.

## Relevant Files

- `crates/routa-cli/src/commands/acp.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-core/src/acp/installation_state.rs`
- `crates/routa-core/src/acp/runtime_manager.rs`

## Observations

- `quick_check_installed(...)` currently returns true when `dist.get("npx").is_some()` and `npx` exists on `PATH`, regardless of provider-specific availability.
- This misclassified Codex as installed before `codex-acp` was present.
- Installing `@zed-industries/codex-acp` later made the provider genuinely runnable, but the original inventory result was still a false positive.
