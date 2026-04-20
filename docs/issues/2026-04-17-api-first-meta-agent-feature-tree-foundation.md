---
title: "API-first Meta Agent foundation for cross-framework FEATURE_TREE generation"
date: "2026-04-17"
kind: issue
status: open
severity: medium
area: "feature-tree"
tags: ["feature-tree", "meta-agent", "openapi", "spring-boot", "eggjs", "specialists"]
reported_by: "codex"
related_issues:
  - "https://github.com/phodal/routa/issues/481"
  - "https://github.com/phodal/routa/issues/483"
github_issue: 483
github_state: open
github_url: "https://github.com/phodal/routa/issues/483"
---

# API-first Meta Agent foundation for cross-framework FEATURE_TREE generation

## What Happened

Routa's current `FEATURE_TREE` generation path is tightly coupled to the current Routa/Next.js repository shape:

- frontend routes are derived from `src/app/**/page.tsx`
- contract APIs are derived from `api-contract.yaml`
- implementation APIs are derived from Next.js route handlers and Rust Axum routers
- feature metadata is normalized around those Routa-specific page/API surfaces

This works for the current repository, but it does not generalize to other frameworks such as Spring Boot or Egg.js.

At the same time, GitHub issue #481 proposes a feature-scoped recovery and file explorer experience that assumes a stable feature/surface foundation across sessions, tasks, files, and APIs.

## Expected Behavior

Routa should have a reusable analysis foundation that:

- treats API contract discovery as the primary intermediate artifact
- reuses existing OpenAPI / Swagger / contract files when available
- can infer a usable in-memory API contract when a repository has no pre-authored OpenAPI
- supports framework adapters for non-Routa repositories such as Spring Boot and Egg.js
- continues to emit compatible `docs/product-specs/FEATURE_TREE.md` and `feature-tree.index.json`
- leaves room for AI specialists to fill gaps after deterministic extraction

## Why This Matters

Without this foundation:

- `#481` can only consume Routa-specific assumptions rather than a portable feature/surface model
- feature-scoped recovery would remain fragile outside the current repository layout
- cross-framework feature attribution would be blocked on ad hoc scripts instead of a stable runtime capability

## Proposed Direction

- Introduce a Meta Agent driven analysis pipeline
- Make API-first contract discovery the canonical intermediate representation
- Support deterministic framework adapters first, with AI specialists used only for gap filling
- Add a validator step that enforces schema, deduplication, source-file traceability, and compatibility of emitted artifacts

## Relevant Files

- `scripts/docs/feature-tree-generator.ts`
- `src/core/spec/feature-surface-index.ts`
- `src/core/spec/feature-surface-metadata.ts`
- `src/app/api/spec/surface-index/route.ts`
- `api-contract.yaml`

## References

- https://github.com/phodal/routa/issues/481
- https://github.com/phodal/routa/issues/483
