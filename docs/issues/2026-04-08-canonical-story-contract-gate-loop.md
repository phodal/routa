---
title: "Canonical story YAML needs a contract gate to stop backlog/todo bounce loops"
date: "2026-04-08"
status: open
severity: high
area: "kanban"
tags: ["kanban", "yaml", "contract", "automation", "loop-prevention"]
reported_by: "agent"
related_issues: []
---

# Canonical Story YAML Contract Gate Loop

## What Happened

Kanban cards could bounce between `backlog` and `todo` when the canonical story YAML was malformed.

- Backlog refinement produced a ` ```yaml ` contract block that looked structurally close to valid YAML but did not parse cleanly.
- Todo orchestration or downstream checks rejected the malformed contract and sent the card back to Backlog.
- The system had delivery gates and generic non-dev loop limits, but no dedicated canonical-contract gate on `update_card` or on the `backlog -> todo` transition.
- This allowed repeated retries with the same malformed YAML and created visible churn in the board history.

## Why It Mattered

- The canonical story contract is the source of truth for downstream INVEST/readiness checks. If it is malformed, Todo cannot safely treat the story as execution-ready.
- Repeated Backlog/Todo bouncing creates noisy comments, wastes automation runs, and obscures the actual remediation path.
- Different mutation paths (`update_card`, REST task PATCH, `move_card`) could diverge in behavior unless the contract gate was centralized.

## Design Direction

Keep YAML as the canonical story format, but enforce it earlier and uniformly.

- Add column-level `contractRules` beside existing `deliveryRules` in Kanban automation config.
- Make `todo` require a valid canonical story YAML contract by default.
- Validate canonical YAML on description updates when the current or next transition depends on the contract.
- Validate canonical YAML again on `move_card` / task column transitions.
- Record system notes for contract-gate failures and trip a loop breaker after repeated failures, so automatic retries stop until the YAML is regenerated in Backlog.

## Expected Outcome

- Malformed canonical YAML is blocked before Todo can start execution work.
- All mutation paths share the same contract gate semantics.
- Cards stop oscillating between Backlog and Todo after repeated canonical-contract failures.
