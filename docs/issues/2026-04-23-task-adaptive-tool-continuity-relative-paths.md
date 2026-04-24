---
title: "Task-Adaptive history relevance should preserve tool-call continuity across nested cwd paths"
date: "2026-04-23"
kind: issue
status: resolved
severity: medium
area: harness
tags:
  - task-adaptive
  - codex-sessions
  - transcript-analysis
  - relative-paths
  - tool-continuity
reported_by: "user"
github_issue: 528
github_state: open
github_url: "https://github.com/phodal/routa/issues/528"
---

# Task-Adaptive history relevance should preserve tool-call continuity across nested cwd paths

## What Happened

The original GitHub issue title over-focused on normalizing every file path to repository-relative form. The real intent is narrower and more behavioral: Task-Adaptive history analysis should understand normal local agent workflows from `~/.codex/sessions`, especially tool-call sequences such as:

- search or enumerate files with `rg --files`, `rg`, `grep`, `find`, or `fd`
- read one of the returned relative paths
- edit the same path through `apply_patch`
- use those linked signals to rank the session as relevant

In real Codex transcripts, some sessions run with `cwd` under a nested codebase path such as `.routa/repos/<codebase>`. A path like `packages/app/src/page.tsx` is correct relative to that session `cwd`, but not correct relative to the Routa repo root. If Task-Adaptive keeps the raw token as `packages/app/src/page.tsx`, it cannot match a selected file stored as `.routa/repos/<codebase>/packages/app/src/page.tsx`.

## Expected Behavior

Task-Adaptive transcript analysis should treat file paths as relative to the session `cwd` first when the session runs inside a nested repo path, then convert them back to the current repo root's relative form for matching and ranking.

It should also preserve enough tool-call continuity to count search results as useful discovery/read signals, so a normal `rg -> sed -> apply_patch` sequence improves relevance instead of being split into disconnected events.

## Why This Might Happen

- `normalizeRepoRelative` returned the raw relative token before considering that `sessionCwd/token` may be the real target.
- Absolute paths were previously checked relative to the session cwd before the current repo root, which could also strip nested repo prefixes.
- Search-like command outputs were ignored as file discovery evidence.
- `parsePatchBlock` did not match real `apply_patch` headers like `*** Update File: ...`, so edited files could be missed entirely.

## Relevant Files

- `src/core/harness/task-adaptive.ts`
- `src/app/api/harness/task-adaptive/__tests__/shared.test.ts`

## Verification

- 2026-04-23: added a regression test for a nested `cwd` transcript with `rg --files -> sed -> apply_patch`.
- 2026-04-23: `npx vitest run src/app/api/harness/task-adaptive/__tests__/shared.test.ts` passed.
- 2026-04-24: re-verified on `main` that commit `2b52fc46` already covers nested `cwd` path continuity in `src/core/harness/task-adaptive.ts`.
- 2026-04-24: added direct helper regressions for `parsePatchBlock`, `normalizeRepoRelative`, and search-output discovery in `src/core/harness/__tests__/task-adaptive-path-signals.test.ts`.
- 2026-04-24: `npx vitest run src/core/harness/__tests__/task-adaptive-path-signals.test.ts src/app/api/harness/task-adaptive/__tests__/shared.test.ts` passed.
- 2026-04-24: `entrix run --tier fast` passed.
