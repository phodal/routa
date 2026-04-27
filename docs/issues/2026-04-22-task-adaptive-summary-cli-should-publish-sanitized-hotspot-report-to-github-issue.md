---
title: "Task-Adaptive summary CLI should publish a sanitized hotspot report to a GitHub issue"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: "devops"
tags:
  - task-adaptive
  - github
  - issue-enricher
  - cli
  - friction-profile
  - summary
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md"
  - "docs/issues/2026-03-12-gh-128-feedback-sync-github-issues-to-local-docs-issues-for-duplicate-detection.md"
github_issue: 525
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/525"
---

# Task-Adaptive summary CLI should publish a sanitized hotspot report to a GitHub issue

## What Happened

`task-adaptive` can already recover rich local context from transcript history, reusable friction profiles, and feature-tree hints, but there is no lightweight way to publish a human-reviewable snapshot of that context into GitHub.

That leaves the current state split across:

- local `task-adaptive` analysis and friction profile storage
- ad hoc manual inspection in the repo or UI
- GitHub issues that do not yet carry a stable, refreshable local summary

As a result, there is no single issue thread that can be refreshed with the latest local hotspot evidence for later judgment.

## Expected Behavior

There should be a local CLI that:

1. computes a sanitized task-adaptive hotspot summary from the current repo and local transcript-derived friction profiles
2. formats that summary into a stable GitHub-friendly report
3. creates or updates a marked comment on a target GitHub issue so repeated runs replace the previous summary instead of spamming new comments

The published report should be safe to share in GitHub:

- no raw session ids
- no raw prompt snippets
- no raw command text
- no local absolute paths

## Why This Might Happen

- current task-adaptive outputs were designed for local runtime consumption, not GitHub publication
- friction profiles preserve useful signals, but there is no sanitized aggregation layer for issue-facing reporting
- existing GitHub issue helpers cover issue create/update, but not comment upsert for a renewable local summary panel
- `issue-enricher` currently analyzes issues, but there is no inverse local-to-issue reporting path for task-adaptive data

## Proposed Direction

- add a pure summary builder that converts friction profiles into a sanitized hotspot report
- add GitHub issue comment list/create/update helpers so a marked summary comment can be upserted
- add a local CLI under `scripts/harness/` that refreshes or loads task-adaptive data and publishes the report to a target issue
- create a detailed GitHub issue that acts as the review thread for this capability and receives the first published summary

## Relevant Files

- `src/core/harness/task-adaptive.ts`
- `src/core/kanban/github-issues.ts`
- `scripts/harness/inspect-transcript-turns.ts`
- `.github/scripts/issue-enricher.ts`

## References

- Local related issue: `docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md`
- Local related issue: `docs/issues/2026-03-12-gh-128-feedback-sync-github-issues-to-local-docs-issues-for-duplicate-detection.md`
- Local follow-up issue: `docs/issues/2026-04-24-task-adaptive-issue-summary-should-rank-product-hotspots-and-recommend-follow-up-files.md`
- GitHub issue: `https://github.com/phodal/routa/issues/525`
- GitHub follow-up issue: `https://github.com/phodal/routa/issues/534`
- First published summary comment: `https://github.com/phodal/routa/issues/525#issuecomment-4298046542`

## Resolution

- 2026-04-22: implemented a dedicated issue-summary builder in `src/core/harness/task-adaptive-issue-summary.ts`
- 2026-04-22: added issue comment list/create/update helpers in `src/core/kanban/github-issues.ts`
- 2026-04-22: added the local CLI `scripts/harness/publish-task-adaptive-issue-summary.ts` and exposed it via `npm run harness:publish-issue-summary`
- 2026-04-22: published the first marked summary comment into GitHub issue `#525`
- 2026-04-24: re-verified that the core CLI publish/upsert tests still pass
- 2026-04-24: narrowed the remaining work to summary relevance and follow-up file recommendation quality; that work now tracks separately
