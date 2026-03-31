# ADR 0001: Dual-Backend Semantic Parity

- Status: accepted
- Date: 2026-02-15

## Context

Routa.js ships as both a web app (Next.js) and a desktop app (Tauri + Rust/Axum). Early in the project, the question arose: should these be two independent products with shared UI, or one product with two deployment surfaces?

Two separate products would allow faster divergence but risk domain model drift over time. A shared-semantics approach constrains both backends but keeps users and agents in a single mental model.

## Decision

Web and desktop are one product with two runtime surfaces. They must:

1. Share the same domain model vocabulary (workspace, session, task, kanban board, specialist, worktree, etc.)
2. Expose the same API shape, governed by `api-contract.yaml` at the repository root
3. Run API contract parity tests as part of CI (`npm run api:test:nextjs` vs `npm run api:test:rust`)

The TypeScript assembly point is `src/core/routa-system.ts`. The Rust assembly point is `crates/routa-core/src/state.rs`. Both wire the same set of stores, event buses, and domain services.

## Consequences

- New domain concepts must be introduced in both backends before they are considered shipped.
- `api-contract.yaml` is the single source of truth for API shape. Route handlers in Next.js and Axum must stay aligned.
- Storage can differ (Postgres in web, SQLite in desktop) but the store interface and domain semantics must not.
- The `api_contract` fitness dimension enforces this with automated parity checks.

## Code References

- `api-contract.yaml` — shared API contract
- `src/core/routa-system.ts` — TypeScript system factory
- `crates/routa-core/src/state.rs` — Rust system factory
- `docs/fitness/api-contract.md` — parity test specification
