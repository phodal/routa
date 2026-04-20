---
title: "Review lane may remain ambiguous after QA verdict writes"
date: "2026-04-13"
kind: issue
status: investigating
severity: medium
area: "kanban"
tags: ["review-lane", "kanban", "dual-backend", "qa"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/issues/417"]
github_issue: 417
github_state: open
github_url: "https://github.com/phodal/routa/issues/417"
---

# Review lane may remain ambiguous after QA verdict writes

## What Happened

Cards in the `review` lane can retain a meaningful `verificationVerdict` / `verificationReport` while still remaining in `review`, leaving the board state ambiguous.

## Expected Behavior

Once the final review step has produced a durable verdict, the task should converge into a clear lane outcome that matches that verdict.

## Reproduction Context

- Environment: both
- Trigger: multi-step review lane (`QA Frontend -> Review Guard`) writes verdict evidence without an explicit successful `move_card`

## Why This Might Happen

- Task evidence updates and Kanban lane transitions are modeled separately, so verdict persistence does not currently imply lane convergence.
- The review lane is multi-step and non-auto-advancing, so a rejected or skipped `move_card` can leave evidence and board state out of sync.

## Relevant Files

- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/lane-automation-state.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/tools/agent-tools.ts`
- `crates/routa-server/src/application/tasks.rs`

## Observations

- Default `review` automation is `QA Frontend` followed by `Review Guard`, with `autoAdvanceOnSuccess: false`.
- Next.js and Rust task update paths both persist review evidence, but neither previously treated a final verdict as a convergence signal.

## References

- https://github.com/phodal/routa/issues/417
