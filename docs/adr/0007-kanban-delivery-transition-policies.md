# ADR 0007: Kanban Delivery Transition Policies

- Status: accepted
- Date: 2026-04-08
- Derived from: local design follow-up for Kanban delivery gating consistency

## Context

Kanban card transitions were already partially guarded, but the enforcement was split across multiple paths:

- UI/API task updates blocked some transitions with delivery-readiness checks
- MCP `move_card` enforced artifact gates and story-readiness gates, but not the same delivery rules
- specialist prompts described move expectations, but prompts alone were not an authoritative guard

This created an inconsistency: the same `dev -> review` or `review -> done` transition could be blocked in one path and allowed in another.

The failure mode is especially visible in Kanban automation because specialist sessions usually call MCP `move_card` directly. If the delivery gate only exists in the route handler, lane specialists can bypass it.

## Decision

Delivery-readiness requirements for Kanban transitions are column policy, not route-specific conditionals.

We represent them as `deliveryRules` inside `KanbanColumnAutomation`, and all transition paths must evaluate the same policy:

- `requireCommittedChanges`
- `requireCleanWorktree`
- `requirePullRequestReady`

The evaluation flow is:

1. The target column declares delivery policy in `automation.deliveryRules`
2. Transition handlers compute `TaskDeliveryReadiness`
3. A shared evaluator converts readiness + policy into a blocking error when needed
4. Both `/api/tasks/[taskId]` and MCP `move_card` use that same evaluator
5. Specialist prompts surface the same delivery policy as guidance, but the policy is enforced server-side

Default board recommendations define the default policies:

- `review`: committed changes + clean worktree
- `done`: committed changes + clean worktree + PR-ready branch

## Consequences

- Kanban delivery rules are configurable per column instead of being hard-coded to specific route branches.
- MCP, UI, and automation sessions now share one source of truth for move gating.
- Specialist prompts can describe the same gate the backend enforces, reducing prompt/backend drift.
- Boards with custom lane names can adopt the same delivery gate behavior without adding new `if targetColumnId === ...` branches.
- Blocking a transition can leave a deterministic task comment so the reason is visible in Kanban history even when the move was attempted by an automated specialist.

## Code References

- `src/core/models/kanban.ts` — `KanbanColumnAutomation.deliveryRules`
- `src/core/kanban/boards.ts` — recommended default delivery policies
- `src/core/kanban/task-delivery-readiness.ts` — shared readiness + policy evaluator
- `src/core/tools/kanban-tools.ts` — MCP `move_card` enforcement
- `src/app/api/tasks/[taskId]/route.ts` — REST task transition enforcement
- `src/core/kanban/agent-trigger.ts` — specialist prompt injection for delivery gates
