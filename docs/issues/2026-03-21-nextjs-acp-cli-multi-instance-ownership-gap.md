---
title: "Next.js ACP CLI sessions are bound to a single web instance"
date: "2026-03-21"
status: investigating
severity: high
area: "acp"
tags: ["acp", "nextjs", "multi-instance", "session-routing", "sse"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/222"]
---

# Next.js ACP CLI sessions are bound to a single web instance

## What Happened

ACP CLI sessions created from the Next.js runtime depend on process-local state for both execution and live updates. The spawned ACP process is stored in the in-memory `AcpProcessManager`, and the browser SSE stream is attached to the in-memory `HttpSessionStore`.

When a later request for the same session lands on a different Next.js instance, the second instance can load the session metadata from persistence but does not own the live CLI process or the original SSE controller state. This creates a split between durable session metadata and non-durable live execution state.

## Expected Behavior

ACP CLI sessions should remain routable and observable regardless of which Next.js instance receives a later request. Session ownership should be explicit and renewable, and live updates should not depend on a single web instance keeping process-local maps alive.

## Reproduction Context

- Environment: web
- Trigger: create an ACP CLI session on one Next.js instance, then send prompt or attach SSE from another instance

## Why This Might Happen

- Session execution is embedded inside the Next.js API runtime rather than isolated behind a dedicated execution service.
- Session metadata is persisted, but live process ownership and SSE delivery are tracked only in process-local memory.
- The current API contract does not persist explicit owner or lease metadata that would let later requests decide whether to proxy or reject work.

## Relevant Files

- `src/app/api/acp/route.ts`
- `src/core/acp/acp-process-manager.ts`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/session-db-persister.ts`
- `src/core/db/schema.ts`
- `src/core/db/sqlite-schema.ts`

## Observations

- `getAcpProcessManager()` and `getHttpSessionStore()` both use `globalThis`, which survives HMR but remains process-local.
- Serverless-specific adapter recreation exists for SDK providers, but the generic CLI process path still assumes local ownership.
- Session metadata can survive restart, but live CLI routing cannot.

## References

- `docs/ARCHITECTURE.md`
