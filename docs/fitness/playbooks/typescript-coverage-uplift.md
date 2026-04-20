# TypeScript Coverage Uplift Playbook

Use this when overall TS coverage is below target and the goal is to raise it quickly without adding brittle tests.

## Selection Heuristic

1. Export detailed per-file coverage and sort by:
   - low statement coverage
   - large statement count
   - stable runtime surface
2. Prefer this order:
   - hooks with pure async state transitions
   - thin stores / adapters with deterministic I/O
   - UI components with mockable child boundaries
   - pages only after component/hook seams are exhausted
3. Avoid early investment in:
   - ACP process adapters
   - long orchestration flows with heavy environment coupling
   - editor / terminal / drag-drop integrations unless already partially tested

## Test Strategy

- For hooks:
  - use `renderHook`
  - cover mount success path first
  - then cover one failure path per async action
  - verify merged derived state, not just individual setter calls
- For stores:
  - use in-memory sqlite or small fakes
  - hit CRUD + filtering + one update/upsert path
  - prefer one shared fixture file per store family
- For components:
  - mock expensive children and platform hooks
  - assert prop wiring, gating, and dispatch behavior
  - test effects that auto-select defaults or normalize state

## Current High-Yield Pattern

- First clear `0%` or near-`0%` files with moderate size.
- Then target files around `100-250` statements where one test file can cover most branches.
- Favor files under `src/core`, `src/client/hooks`, and `src/client/components` before page-level integration tests.

## Working Rule

- One commit = one coverage slice.
- Run targeted Vitest first.
- Run full `npm run test:cov:ts` after each slice.
- Keep notes on which files moved the aggregate most, then keep reusing the same file families.
