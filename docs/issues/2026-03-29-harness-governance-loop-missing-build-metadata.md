---
title: "Harness governance loop build stage lacks live build metadata"
date: "2026-03-29"
status: resolved
severity: medium
area: "ui"
tags: ["harness", "governance-loop", "build", "metadata"]
reported_by: "codex"
related_issues: [
  "https://github.com/phodal/routa/issues/245",
  "docs/issues/2026-03-28-harness-governance-loop-semantic-drift.md",
  "docs/issues/2026-03-29-harness-governance-loop-panel-orchestration-gap.md",
  "docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md"
]
resolved_at: "2026-04-11"
resolution: "Merged into the broader build/test harness issue because missing build metadata is a narrower symptom of the same missing config contract and compact UI problem."
---

# Governance loop build stage is still a static label instead of a live repository signal

## What Happened

On `/settings/harness?workspaceId=default`, the `Governance loop` graph is already backed by live data for:

- fitness specs
- execution plan
- hook runtime
- instruction file
- GitHub Actions workflows

But the `构建` node still renders a fixed note, `本地集成 / 运行准备`, and does not show any actual build-related metadata from the selected repository or the current harness snapshot.

During inspection, the page was already loading live payloads that contain timestamps such as `generatedAt`, and the surrounding system also has version / revision signals available elsewhere. None of that currently appears in the governance loop header, node details, or build-stage context.

## Expected Behavior

When a repository is selected, the `Governance loop` should make it obvious whether the build stage is showing fresh, repo-specific state rather than a conceptual placeholder.

At minimum, the build stage should expose live metadata that answers questions like:

- which repo snapshot the graph is describing
- when the harness data was generated
- whether the displayed build context is fresh or stale
- which branch / revision / version the current build context belongs to

## Reproduction Context

- Environment: web
- Trigger: Open `http://localhost:3000/settings/harness?workspaceId=default`
- Observed repo: `phodal/routa`

## Why This Might Happen

- `HarnessGovernanceLoopGraph` currently reduces incoming API payloads into coarse summaries and static node notes.
- The graph header only renders repo label, tier, and aggregate counts, so transport metadata is discarded before it reaches the UI.
- The build stage does not have a dedicated data contract; unlike hooks, plan, or workflows, it is represented as a conceptual step in the graph only.

## Relevant Files

- `src/app/settings/harness/page.tsx`
- `src/client/hooks/use-harness-settings-data.ts`
- `src/client/components/harness-governance-loop-graph.tsx`
- `src/app/api/fitness/specs/route.ts`
- `src/app/api/fitness/plan/route.ts`
- `src/app/api/harness/hooks/route.ts`
- `src/app/api/harness/instructions/route.ts`
- `src/app/api/harness/github-actions/route.ts`
- `src/app/api/health/route.ts`
- `crates/routa-server/src/lib.rs`
- `crates/routa-core/src/trace/vcs.rs`

## Observations

- `useHarnessSettingsData` already fetches five live endpoints, and all response types include `generatedAt`.
- The selected repository already carries repo identity and branch context before rendering the graph.
- The app has existing version signals in `/api/health` and git revision helpers in trace utilities, so the missing piece is primarily UI integration and a stable build-stage data shape.

## Deduplication Note

This record is retained as evidence, but it no longer serves as an independent
active issue. The authoritative local tracker is
`docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md`.
