---
title: "Rust ACP spawn ENOENT masks invalid cwd as missing provider binary"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "acp"
tags: [rust, acp, desktop, spawn, cwd, path, provider]
reported_by: "Codex"
related_issues: []
---

# Rust ACP spawn ENOENT masks invalid cwd as missing provider binary

## What Happened

Desktop ACP session creation failed with messages like:

- `Failed to spawn '/opt/homebrew/bin/codex-acp' (resolved: '/opt/homebrew/bin/codex-acp'): No such file or directory (os error 2)`
- `Failed to spawn '/opt/homebrew/bin/opencode' (resolved: '/opt/homebrew/bin/opencode'): No such file or directory (os error 2)`

At the same time, the UI also showed repository-path related failures:

- `GET /api/clone/branches?repoPath=...` returned `400 Bad Request`
- `GET /api/skills/clone?repoPath=...` returned `404 Not Found`

The same machine can execute both provider binaries successfully from a valid working directory:

- `/opt/homebrew/bin/opencode --version` succeeds
- `/opt/homebrew/bin/codex-acp --help` succeeds

This means the Rust error text is not sufficient to conclude that the provider binary is actually missing.

## Expected Behavior

- ACP session creation should distinguish between:
  - provider binary not found
  - provider wrapper target/interpreter missing
  - session `cwd` not found or invalid
- If the requested repo/worktree path is invalid, the API should fail early with a clear `cwd`/`repoPath` validation error instead of attributing the failure to the ACP binary.

## Reproduction Context

- Environment: desktop (`http://127.0.0.1:3210`)
- Trigger: create ACP session while the selected repo/worktree path is invalid or no longer exists

Minimal local reproduction of the same symptom shape:

```bash
node -e "const {spawn}=require('child_process'); const p=spawn('/opt/homebrew/bin/opencode',['--version'],{cwd:'/definitely/missing'}); p.on('error',e=>{console.error(e.code,e.message); process.exit(0);});"
```

Observed output:

```text
ENOENT spawn /opt/homebrew/bin/opencode ENOENT
```

So a valid executable plus an invalid `cwd` can still surface as the same ENOENT that currently gets rendered as "Is it installed and in PATH?".

## Why This Might Happen

- `crates/routa-core/src/acp/process.rs` wraps `Command::spawn()` failures with a binary-centric message, but `spawn()` can also fail when `.current_dir(cwd)` points to a non-existent directory.
- `crates/routa-server/src/api/acp_routes.rs` resolves `cwd` from request / workspace / codebase state but does not validate that the final directory exists before calling `acp_manager.create_session(...)`.
- The concurrent `repoPath` 400/404 errors strongly suggest the frontend had already selected an invalid repo path, making `cwd` drift a more plausible root cause than a missing CLI install.
- Static provider availability paths such as `crates/routa-server/src/api/providers.rs` check `shell_env::which(&preset.command)` directly instead of the preset-aware `resolve_preset_command(...)`, so diagnostics can diverge from the actual launch path when env overrides are used.

## Relevant Files

- `crates/routa-core/src/acp/process.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-server/src/api/acp_routes.rs`
- `crates/routa-server/src/api/clone_branches.rs`
- `crates/routa-server/src/api/skills_clone.rs`
- `crates/routa-server/src/api/providers.rs`
- `crates/routa-core/src/shell_env.rs`

## Observations

- On this machine, `command -v opencode` resolves to `/Users/phodal/.opencode/bin/opencode`.
- On this machine, `command -v codex-acp` resolves to `/opt/homebrew/bin/codex-acp`.
- `/opt/homebrew/bin/opencode` and `/opt/homebrew/bin/codex-acp` both exist and are executable.
- Both wrappers use `#!/usr/bin/env node`, and `node` is available at `/opt/homebrew/bin/node`.
- The screenshot shows `repoPath`-related API failures immediately before ACP creation failures, which fits the invalid-`cwd` hypothesis.

## Resolution

This issue is resolved in the current codebase.

The fix tightened ACP launch validation in the Rust backend:

- Added shared `cwd` validation in `AcpManager` so create/load flows reject missing or non-directory working directories before provider startup.
- Added a defensive `cwd` check in `AcpProcess::spawn(...)` so any future direct caller gets the same explicit failure.
- Improved `spawn()` error classification so ENOENT no longer always implies "not installed and in PATH"; when the resolved binary exists, the error now points to missing interpreter/wrapper-target classes instead.
- Added regression tests for both the core `cwd` validator and the desktop `session/new` route.

## Verification

- `cargo test -p routa-core validate_session_cwd_rejects_missing_or_non_directory_paths`
- `cargo test -p routa-server session_new_rejects_invalid_explicit_cwd_before_spawn`

## References

- Similar but not identical prior class: Windows ACP runtime launch fixes around wrapper/path handling (`fix: prefer spawnable Windows wrapper commands for ACP runtimes`, commit `ac5545c4`)
