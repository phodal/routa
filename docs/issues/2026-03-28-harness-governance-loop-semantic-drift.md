---
title: "Harness governance loop semantic drift"
date: "2026-03-28"
status: resolved
severity: medium
area: "ui"
tags: ["harness", "governance-loop", "react-flow"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md"
resolved_at: "2026-04-11"
resolution: "Merged into the broader harness build/test and governance-loop surface tracker because the graph semantic drift is a narrower presentation symptom within the same UI family."
---

# Governance loop layout no longer matches harness semantics

## What Happened

The governance loop visualization on `/settings/harness` drifted away from the intended loop semantics during iterative UI tuning.

Observed problems:

- `Execution Plan` no longer reads as part of the submit feedback loop.
- `Evidence` reads like a local or shared node instead of a remote/external feedback node.
- `CLAUDE.md` / `AGENTS.md`, `Fitness Files`, and `Hook Runtime` are visually grouped inconsistently across loops.
- The GitHub Actions self-heal path (`ci-red-fixer`) was first shown as a standalone card, then as a self-loop, but the loop ownership remained unclear.

## Expected Behavior

The graph should communicate the harness layers clearly:

- Internal loop: repository rulebook + fitness definitions
- Submit loop: hook runtime + execution plan
- External loop: GitHub Actions + evidence + CI self-heal

## Reproduction Context

- Environment: web
- Trigger: Open `/settings/harness` and compare node placement against current harness semantics

## Why This Might Happen

- The ring overlays use absolute positioning that is independent from the React Flow node layout.
- Semantic ownership of nodes changed during visual iterations, but the ring bounds and labels were not recalculated from those semantics.
- The graph currently mixes user-order flow, feedback-loop ownership, and workflow recovery behavior in one fixed coordinate map.

## Relevant Files

- `src/client/components/harness-governance-loop-graph.tsx`
- `src/app/api/harness/github-actions/route.ts`
- `src/app/api/harness/hooks/route.ts`
- `src/core/github/ci-red-fixer.ts`
- `.github/workflows/ci-red-fixer.yml`

## Observations

- `ci-red-fixer` is a real GitHub Actions repair path, not just a generic remote workflow.
- The current graph is visually close, but semantic grouping still shifts when nodes move.

## Deduplication Note

This record is retained as evidence for the governance-loop graph symptom, but
it is no longer tracked as an independent active issue. The authoritative local
tracker for this UI family is
`docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md`.
