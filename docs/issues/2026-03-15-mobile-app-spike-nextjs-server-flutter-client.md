---
title: "Mobile app spike: keep Next.js as server backend and explore a Flutter client"
date: "2026-03-15"
status: investigating
severity: low
area: "mobile"
tags: ["spike", "mobile", "nextjs", "flutter", "architecture"]
reported_by: "copilot"
related_issues:
  - "docs/product-specs/FEATURE_TREE.md"
  - "docs/ARCHITECTURE.md"
---

# Mobile app spike: keep Next.js as server backend and explore a Flutter client

## What Happened

Routa already has a dual-backend setup for web and desktop, but there is no repository-level spike note describing how a mobile client should fit into that architecture. The current product surface is centered on Next.js for web and Rust/Tauri for desktop.

## Expected Behavior

The repository should capture a lightweight spike note for a mobile direction so future implementation work can start from a shared assumption:

- Keep the existing Next.js server as the remote backend for mobile.
- Explore a dedicated mobile frontend instead of stretching the desktop shell to mobile.
- Treat Flutter as the leading client candidate until a deeper feasibility comparison is completed.

## Reproduction Context

- Environment: both
- Trigger:
  1. Review the current architecture docs and generated feature tree
  2. Observe that web and desktop are described, but mobile delivery is not
  3. Need a minimal planning artifact to align future work on a mobile spike

## Why This Might Happen

- The current architecture explicitly documents web and desktop targets, so mobile has not yet been formalized as a tracked direction.
- A mobile client likely benefits from reusing the existing Next.js APIs instead of introducing a third backend.
- Flutter is a reasonable spike candidate because it can ship cross-platform mobile UI while consuming the existing HTTP and SSE interfaces.

## Relevant Files

- `docs/ARCHITECTURE.md`
- `docs/product-specs/FEATURE_TREE.md`
- `api-contract.yaml`
- `src/app/api/`
- `crates/routa-server/`

## Observations

- The architecture document already frames Routa as a dual-backend system: Next.js for web and Rust for desktop.
- The generated feature tree enumerates current web pages and API endpoints, which suggests mobile should initially consume the same contract rather than invent a parallel API surface.
- A mobile spike should focus on authentication/session strategy, streaming UX, and workspace/task/session views before deciding whether Flutter is the final client technology.
- If the spike continues, the next deliverable should likely be a small architecture note or prototype validating login, workspace listing, session detail, and streaming updates against the Next.js backend.

## References

- `docs/ARCHITECTURE.md`
- `docs/product-specs/FEATURE_TREE.md`
