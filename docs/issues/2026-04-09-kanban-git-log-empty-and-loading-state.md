---
title: "Kanban Git Log panel returned empty data or stayed in loading state"
date: "2026-04-09"
status: resolved
severity: medium
area: "ui"
tags: ["kanban", "git-log", "multi-repo", "nextjs", "rust-parity"]
reported_by: "github-copilot"
related_issues:
  - "2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md"
  - "https://github.com/phodal/routa/issues/407"
---

# Kanban Git Log panel returned empty data or stayed in loading state

## What Happened

The new Kanban Git Log panel could render its shell and refs tree, but the commit list either stayed empty or remained in a loading state.

Observed failure modes during verification:

- `/api/git/log` returned `{ commits: [], total: 0, hasMore: false }` for a repository that clearly had history.
- After the first API fix, the browser UI could still stay in `Loading...` because the client hook re-triggered its own load cycle on repo changes.
- In a multi-repo setup, the panel initially only followed the default codebase and did not expose a dedicated repo switcher.

## Expected Behavior

The Kanban Git Log panel should:

- show commits for the currently selected repository,
- support branch and hash/text filtering,
- open commit detail inline,
- and support explicit repository switching when a workspace contains multiple codebases.

## Reproduction Context

- Environment: web
- Trigger: open `/workspace/default/kanban`, expand `Git Log`, observe empty or permanently loading commit list
- Verification context:
  - real workspace codebase: `/Users/phodal/ai/routa-js/.routa/repos/phodal--routa`
  - temporary second codebase used to validate multi-repo switching: `/Users/phodal/ai/routa-js`

## Why This Might Happen

- The list endpoint serialized commit body text with `%B`, then parsed the output line-by-line. Multiline commit bodies broke record parsing and caused valid commits to be dropped.
- The frontend hook reset `activeBranches` inside an effect that also depended on the derived log loader, which could create a self-triggered loading loop.
- The panel originally read only the default codebase path, so multi-repo behavior was implicit rather than explicit.
- The desktop/runtime parity gap existed until the Rust server exposed matching root-level `/api/git/refs`, `/api/git/log`, and `/api/git/commit` routes.

## Relevant Files

- `src/app/api/git/log/route.ts`
- `src/app/api/git/refs/route.ts`
- `src/app/workspace/[workspaceId]/kanban/git-log/use-git-log.ts`
- `src/app/workspace/[workspaceId]/kanban/git-log/git-log-panel.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`

## Observations

- Direct API verification after the fix returned commit data for both repositories.
- Rust parity verification confirmed the same contract on `routa-server` via live requests to `/api/git/refs`, `/api/git/log`, and `/api/git/commit`, including `branches=origin/main` remote filtering.
- Browser verification confirmed:
  - commit list rendering,
  - commit detail rendering,
  - hash search,
  - branch filter state,
  - multi-repo repo selector and repo switch behavior.
- The temporary second codebase used during verification was removed after testing to restore workspace state.

## References

- Browser verification artifacts captured during implementation.
- Follow-up GitHub issue originally tracked Rust backend parity for this panel: https://github.com/phodal/routa/issues/407