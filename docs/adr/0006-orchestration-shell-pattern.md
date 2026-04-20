# ADR 0006: Orchestration Shell Pattern

- Status: accepted
- Date: 2026-03-01

## Context

As the codebase grew, several files accumulated mixed concerns: JSX layout interleaved with side effects, streaming logic, session management, and queue orchestration. Splitting these by "component vs utility" created catch-all `utils.ts` files that were just as large.

The failure mode: one oversized file replaced by one oversized hook or one oversized utils module.

## Decision

Complex files must follow an **orchestration shell + domain hooks** structure:

- The **orchestration shell** is a thin top-level entrypoint that routes flow and coordinates modules. It does not carry the implementation mass.
- **Domain hooks/modules** contain the actual logic, each focused on one stable workflow boundary (e.g., bootstrap, navigation, task execution, streaming sync).

Extraction order:
1. Split by workflow branch first (e.g., session creation vs. prompt streaming vs. provider dispatch)
2. Extract shared helpers only after workflow branches are stable
3. Never start with a generic `utils` file when the real mass lives in one or two protocol branches

This applies equally to:
- React components mixing layout with side effects
- API route handlers mixing CRUD with streaming or orchestration
- Kanban automation mixing event handling with queue management

## Consequences

- Before refactoring a behavior-heavy file, add characterization tests that lock current routing, lifecycle, persistence, and recovery behavior.
- Prefer extracting one workflow boundary at a time over splitting everything at once.
- The `code_quality` fitness dimension in `entrix` enforces file size budgets that make this pattern mechanically necessary.
- `entrix analyze long-file` identifies extraction candidates by combining size and git change frequency.

## Code References

- `AGENTS.md` § Coding Standards — normative enforcement
- `docs/REFACTOR.md` — extraction priority signals and long-file triage workflow
- `docs/REFACTOR.md` — refactor playbook for long-file triage
