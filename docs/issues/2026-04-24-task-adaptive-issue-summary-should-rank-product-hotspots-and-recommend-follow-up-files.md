---
title: "Task-Adaptive issue summary should rank product hotspots and recommend follow-up files"
date: "2026-04-24"
kind: issue
status: resolved
resolved_at: "2026-04-25"
severity: medium
area: harness
tags:
  - task-adaptive
  - github
  - summary
  - hotspot
  - ranking
  - relevance
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-22-task-adaptive-summary-cli-should-publish-sanitized-hotspot-report-to-github-issue.md"
github_issue: 534
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/534"
---

# Task-Adaptive issue summary should rank product hotspots and recommend follow-up files

## What Happened

The local-to-GitHub summary pipeline now exists and is already publishing a marked summary comment, but the issue-facing ranking is still too literal.

The current report can elevate repository meta files such as:

- `docs/fitness/README.md`
- `docs/issues/issue-gc-state.yaml`

above product files that are more likely to matter during triage.

That means the summary satisfies the publication contract, but it still falls short of being a strong reviewer-facing hotspot guide.

## Expected Behavior

The published summary should prioritize files and features that are most useful for humans to inspect next.

In practice that means:

1. ranking product/domain hotspots above repo-maintenance noise when both have similar transcript churn
2. emitting an explicit "recommended follow-up files to inspect first" section instead of expecting reviewers to infer it from raw hotspot order
3. keeping the output sanitized while improving relevance

## Why This Might Happen

- current file ranking mostly reflects transcript frequency and recency, not reviewer utility
- docs, issue-maintenance, and harness-governance files are not down-weighted in the issue-facing summary layer
- the formatter exposes top hotspots directly, but does not yet derive a narrower follow-up recommendation list

## Proposed Direction

- add issue-summary ranking heuristics that prefer product-facing source files over docs and tracker files when evidence is otherwise similar
- derive a separate "recommended follow-up files" section from failure severity, feature linkage, and hotspot confidence
- add regression tests that prove the summary recommends product files before repo-maintenance files for mixed snapshots

## Relevant Files

- `src/core/harness/task-adaptive-issue-summary.ts`
- `src/core/harness/__tests__/task-adaptive-issue-summary.test.ts`
- `src/core/harness/task-adaptive.ts`

## Initial Evidence

- GitHub issue `#525` already contains a published sanitized summary comment
- that summary currently lists `docs/fitness/README.md` and `docs/issues/issue-gc-state.yaml` among the top file hotspots
- this is acceptable for raw hotspot transparency, but weak as a "inspect these first" recommendation for human follow-up
- GitHub follow-up issue: `https://github.com/phodal/routa/issues/534`

## Resolution Notes

- Confirmed the issue-facing summary now ranks product and supporting code hotspots ahead of repo docs and issue tracker noise.
- Confirmed the formatter emits a dedicated `Recommended Follow-Up Files` section derived from ranked product/supporting-code candidates.
- Confirmed repo-maintenance files such as `docs/issues/issue-gc-state.yaml` stay visible in raw top file hotspots but are excluded from product follow-up recommendations when stronger product candidates exist.

## Verification Notes

- `npx vitest run src/core/harness/__tests__/task-adaptive-issue-summary.test.ts`
  - PASS (`2 passed`)
