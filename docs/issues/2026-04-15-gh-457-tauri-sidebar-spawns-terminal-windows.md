---
title: "GH-457 Tauri sidebar navigation spawns terminal windows on Windows"
date: "2026-04-15"
kind: issue
status: investigating
severity: high
area: "desktop"
tags: [desktop, tauri, windows, git, process, sidebar]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/457"]
github_issue: 457
github_state: open
github_url: "https://github.com/phodal/routa/issues/457"
---

# GH-457 Tauri sidebar navigation spawns terminal windows on Windows

## What Happened

On Windows desktop builds, opening a workspace and switching sidebar views can cause multiple terminal windows to flash open.

The strongest local match is the Kanban/workspace navigation path: when the page mounts, the desktop Rust backend computes per-repository git status and file changes for every codebase in the workspace. Those git calls are background diagnostics and should not create visible console windows.

## Expected Behavior

Desktop background checks such as git status inspection and ACP warmup should run headlessly on Windows.

## Reproduction Context

- Environment: desktop / Tauri / Windows
- Trigger: add a project, then switch sidebar views in a workspace

## Why This Might Happen

- The Rust desktop backend shells out to `git` multiple times per repository when loading workspace codebase changes.
- Some Rust child processes already opt into `CREATE_NO_WINDOW`, but the git helpers used by workspace/sidebar data loading did not apply the same Windows behavior.
- ACP warmup also launches background package-manager commands and should follow the same hidden-window policy.

## Relevant Files

- `crates/routa-core/src/git.rs`
- `crates/routa-core/src/acp/warmup.rs`
- `crates/routa-server/src/api/codebases.rs`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`

## Observations

- `GET /api/workspaces/{workspaceId}/codebases/changes` loads on the Kanban page and fans out into git status calls for each codebase.
- Packaged desktop mode defaults to the Rust backend, so the fix needs to be in the Rust command paths rather than only in Next.js routes.

## References

- https://github.com/phodal/routa/issues/457
