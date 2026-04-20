# ADR 0004: Kanban-Driven Automation

- Status: accepted
- Date: 2026-03-08
- Derived from: [issue #96](https://github.com/phodal/routa/issues/96), [issue #148](https://github.com/phodal/routa/issues/148)

## Context

Kanban boards could be pure UI projections of task state, or they could be active automation surfaces. As Routa.js added agent orchestration, the question was where to put the automation trigger boundary.

Options considered:
1. Automation triggered by task state changes (independent of board)
2. Automation triggered by kanban column transitions (board-aware)
3. Automation triggered by explicit user action only

## Decision

Kanban lanes are automation triggers. Column transitions create ACP sessions through a queue with per-board concurrency control.

The flow:
1. Card moves to a column with `automation.enabled=true`
2. `column-transition.ts` emits a `COLUMN_TRANSITION` event
3. `workflow-orchestrator.ts` receives the event, builds a task prompt via `agent-trigger.ts`
4. Session is queued in `kanban-session-queue.ts` respecting board concurrency limit (default: 1)
5. On session completion, the next queued card promotes automatically
6. Stale detection removes entries if the card has already been moved or already has a session

The kanban data model is local-first and independent of external issue trackers. GitHub Issues sync is an overlay, not the source of truth.

## Consequences

- Kanban is not just UI — code that modifies kanban column state must be aware that it may trigger automation.
- Per-board concurrency prevents stampedes when multiple cards enter automated lanes simultaneously.
- The session queue must handle stale entries (cards moved away before their session starts).
- Both TypeScript (`src/core/kanban/`) and Rust (`crates/routa-core/src/store/kanban*.rs`) implement the kanban domain.
- Board configuration (columns, automation rules, concurrency limits) is stored per-workspace.

## Code References

- `src/core/kanban/column-transition.ts` — transition event emission
- `src/core/kanban/workflow-orchestrator.ts` — event → session trigger
- `src/core/kanban/kanban-session-queue.ts` — per-board concurrency queue
- `src/core/kanban/agent-trigger.ts` — task prompt building
- `src/core/kanban/board-session-limits.ts` — concurrency limit management
- `src/core/models/kanban.ts` — KanbanBoard, KanbanColumn, KanbanColumnAutomation
