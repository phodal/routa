---
title: "Global Kanban flow learning should be agent-driven and produce actionable guidance"
date: "2026-04-16"
kind: issue
status: open
severity: medium
area: kanban
tags:
  - kanban
  - agent
  - specialist
  - trace-learning
  - observability
  - flow-analysis
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md"
  - "https://github.com/phodal/routa/issues/294"
  - "https://github.com/phodal/routa/issues/466"
github_issue: 466
github_state: open
github_url: "https://github.com/phodal/routa/issues/466"
---

# Global Kanban flow learning should be agent-driven and produce actionable guidance

## What Happened

Routa already records lane-scoped execution history for Kanban tasks, including:

- `laneSessions` with lane, attempt, recovery, and status metadata
- `laneHandoffs` between adjacent workflow runs
- review verdict convergence such as `review -> dev`
- move-block comments and contract-gate failure notes
- `lastSyncError` messages from orchestration and guardrails

However, the product still cannot answer a global workflow question such as:

- why cards frequently bounce between `backlog` and `todo`
- why work repeatedly loops between `dev` and `review`
- which flow anti-patterns are systemic versus isolated
- what advice the next agent should receive before entering a risky lane

The current trace-learning capability is centered on harness evolution playbooks rather than Kanban workflow behavior.

## Expected Behavior

Routa should be able to analyze Kanban flow history at the board/workspace/global level, identify repeated transition patterns, and let an AI specialist produce actionable guidance such as:

- likely root-cause categories for recurring lane bounce patterns
- recommended policy or board changes
- specialist prompt adjustments for risky lanes
- warnings and preflight guidance for future card runs

The learned output should not be limited to dashboards or raw metrics. It should be consumable by another agent as structured advice.

## Reproduction Context

- Environment: both
- Trigger: reviewing Kanban lane history and existing trace-learning direction showed that current learning is scoped to harness evolution instead of global Kanban flow behavior

## Why This Might Happen

- Kanban currently persists lane/session history, but not a first-class global flow event ledger with normalized reason codes.
- Existing failure evidence is split across `laneSessions`, `laneHandoffs`, `verificationVerdict`, task comments, and `lastSyncError`, which makes higher-level analysis hard to automate reliably.
- Current trace learning is task-type specific and focused on `harness_evolution`, so the playbook pipeline does not yet treat Kanban workflow as a learnable surface.
- There is no dedicated specialist that aggregates board-level transition history and turns it into recommendations for operators or downstream agents.

## Relevant Files

- `src/core/models/task.ts`
- `src/core/kanban/task-lane-history.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/review-lane-convergence.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/tools/kanban-tools.ts`
- `docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`
- `docs/features/harness-trace-learning.md`
- `crates/routa-cli/src/commands/harness/engineering/learning.rs`

## Observations

- `TaskLaneSession` already captures lane-level run metadata such as `columnId`, `attempt`, `loopMode`, `completionRequirement`, and `recoveryReason`.
- `workflow-orchestrator.ts` already detects repeated non-dev lane loops and records recovery/failure messages, but those signals are not promoted into a reusable diagnosis layer.
- task comments already persist move-block and contract-gate notes, but they are plain text rather than structured flow reasons.
- the current trace-learning pipeline stores and loads playbooks for `harness_evolution`, which demonstrates the learning pattern but not yet for Kanban flow analysis.

## References

- Parent issue candidate: `phodal/routa#294`
- Local tracker: `docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`
