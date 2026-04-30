---
title: "Define Workspace Delivery Memory architecture and resolve /api/memory API boundary collision"
date: "2026-04-28"
kind: issue
status: open
severity: high
area: "agent-memory"
tags:
  - agent-memory
  - workspace-memory
  - task-adaptive-harness
  - role-memory
  - api-boundary
  - architecture
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "docs/issues/2026-04-25-reasoning-bank-style-agent-experience-memory.md"
github_issue: 538
github_state: open
github_url: "https://github.com/phodal/routa/pull/538"
references:
  - "https://github.com/phodal/routa/issues/301"
  - "https://github.com/phodal/routa/issues/535"
  - "https://github.com/phodal/routa/issues/515"
  - "https://github.com/phodal/routa/issues/516"
  - "https://github.com/phodal/routa/blob/main/docs/ARCHITECTURE.md"
  - "https://github.com/phodal/routa/blob/main/docs/product-specs/FEATURE_TREE.md"
  - "https://docs.langchain.com/oss/python/concepts/memory"
  - "https://docs.mem0.ai/core-concepts/memory-types"
  - "https://docs.letta.com/guides/core-concepts/stateful-agents/"
  - "https://help.getzep.com/graph-overview"
  - "https://arxiv.org/abs/2507.05257"
---

# Define Workspace Delivery Memory architecture and resolve /api/memory API boundary collision

## What Happened

Routa has accumulated strong primitives for task/session/trace/review orchestration, and recent issues already point to role memory externalization and task-adaptive history hydration.

However, there is still no unified, explicit architecture for **Workspace Delivery Memory** as a product concept across:

- session working memory
- role-scoped memory (ROUTA / CRAFTER / GATE)
- cross-session delivery memory records
- task-start context injection packs

A naming/semantic collision also exists around `/api/memory`:

- product docs/feature tree describe workspace memory records
- existing implementation uses this surface for runtime/process memory monitoring and cleanup/debug endpoints

This collision risks long-term confusion in API contracts, UI labels, and cross-backend parity.

## Current Update - 2026-04-30

The P0 API boundary split has been applied:

- `/api/system/memory` is now the canonical runtime/process memory monitoring route in both Next.js and desktop Axum.
- `/api/memory` remains as a deprecated compatibility alias for runtime memory monitoring and returns deprecation headers.
- The settings system info footer now calls `/api/system/memory`.
- `api-contract.yaml`, `docs/ARCHITECTURE.md`, and `docs/product-specs/FEATURE_TREE.md` describe the runtime diagnostics route separately from workspace delivery memory.

This tracker remains open for the product-domain layers that are not implemented yet: `/api/workspace-memory`, `/api/agent-memory`, and `/api/memory-pack`.

## Deduplication Context

- #301 covered role memory baseline work and should stay closed.
- #535 tracks reasoning strategy/experience memory and is a narrower sub-track.
- This PR tracks the broader workspace delivery memory architecture and the API boundary collision that blocked clear implementation.

## Expected Behavior

Routa should formalize memory as **workspace-scoped delivery context**, not generic chat-history persistence.

The architecture should define four layers:

1. `Session Working Memory` — in-session handoff state
2. `Role Memory` — file-backed ROUTA/CRAFTER/GATE memory
3. `Workspace Delivery Memory` — durable evidence-backed records across sessions
4. `Task-Adaptive Memory Pack` — minimal just-in-time context pack for new tasks

Routa should also split API surfaces to remove ambiguity:

- `/api/system/memory` for runtime/process monitoring
- `/api/memory` as a deprecated compatibility alias for runtime/process monitoring during migration
- `/api/workspace-memory` for cross-session memory records
- `/api/agent-memory` for session/role working memory
- `/api/memory-pack` for task-adaptive pack assembly

## Reproduction Context

- Environment: both (web + desktop semantics)
- Trigger: comparing feature-tree memory semantics with current `/api/memory` runtime monitoring behavior, and reviewing current memory-related issue backlog (#301 / #515 / #516)

## Why This Might Happen

- Memory capabilities evolved incrementally from diagnostics and harness features without one canonical domain contract.
- Existing primitives (trace/session/review/artifact) are rich, but promotion/classification/retrieval lifecycle is not yet normalized.
- Product naming reused a generic `/api/memory` route before separating system metrics memory vs. delivery memory domain.

## Proposed Direction

### P0 — Domain and naming contract

- Declare Workspace Delivery Memory scope and non-goals.
- Explicitly separate memory monitoring from agent memory product APIs.

### P1 — Role Working Memory + Memory Pack first

- Implement role memory writer/reader surfaces.
- Compile minimal task-adaptive memory packs from historical evidence.
- Surface Memory/Harness summary in card detail/refinement UI.
- Log which memory items were injected for each session.

### P2 — Workspace Memory Store

- Introduce `MemoryRecord` model (semantic/episodic/procedural/review/friction/decision).
- Back store with readable files + queryable index (SQLite/Postgres depending on runtime surface).
- Require evidence references (trace/session/file/review/artifact/commit).

### P3 — Promotion pipeline and governance

- Capture → classify → evidence-bind → dedup/contradiction-check → score → promote.
- Auto-promote low-risk memories; gate high-risk procedural/policy memories.
- Add controls for inspect/edit/delete/deprecate/TTL and no-memory/no-promote modes.

### P4 — Harness evaluation

Add memory quality metrics into harness/fitness:

- relevant recall
- precision/noise
- stale-memory usage rate
- evidence coverage
- context token savings
- blocked/rework/review failure impact
- forgetting correctness

## Acceptance Criteria

- Memory domain terms and API boundaries are unambiguous in docs and implementation.
- `/api/memory` semantic collision is removed via explicit route split and compatibility deprecation metadata.
- Role memory and memory pack contracts are defined and traceable.
- Workspace memory records are evidence-backed, queryable, and lifecycle-managed.
- Procedural memory changes require Gate/human approval before influencing specialist behavior.
- Memory quality appears in harness/fitness evaluation flow.

## Relevant Files

- `docs/ARCHITECTURE.md`
- `docs/product-specs/FEATURE_TREE.md`
- `api-contract.yaml`
- `src/app/api/system/memory/route.ts`
- `src/app/api/memory/route.ts`
- `crates/routa-server/src/api/memory.rs`
- `crates/routa-server/src/api/mod.rs`
- `src/client/components/settings-panel.tsx`
- `src/core/kanban/context-preload.ts`
- `src/core/trace/`
- `src/core/orchestration/`

## References

- https://github.com/phodal/routa/issues/301
- https://github.com/phodal/routa/issues/535
- https://github.com/phodal/routa/issues/515
- https://github.com/phodal/routa/issues/516
- https://docs.langchain.com/oss/python/concepts/memory
- https://docs.mem0.ai/core-concepts/memory-types
- https://docs.letta.com/guides/core-concepts/stateful-agents/
- https://help.getzep.com/graph-overview
- https://arxiv.org/abs/2507.05257
