---
title: "Next.js ACP bridge leaves Codex permission requests unresolved and collapses prompt failures into Internal error"
date: "2026-04-08"
status: resolved
severity: high
area: acp
tags: ["acp", "codex", "nextjs", "permission", "parity", "observability"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/399"]
github_issue: 399
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/399"
resolved_at: "2026-04-08"
---

# Next.js ACP bridge leaves Codex permission requests unresolved and collapses prompt failures into Internal error

## What Happened

Codex-backed sessions in the Next.js runtime could accept a prompt, emit `session/request_permission`, and then fail the prompt with a generic `Internal error`.

Observed browser/runtime symptoms:

- `POST /api/acp` returned HTTP 200 after a long wait, but the JSON-RPC payload contained an error
- the frontend showed `AcpClientError` with `code: -32000` and `message: "Internal error"`
- logs showed `"[AcpProcess:Codex] Agent request: session/request_permission"` immediately before the prompt failed

## Expected Behavior

- Codex permission requests should be handled the same way in Next.js and Rust runtimes
- if the runtime auto-approves Codex permission requests in Rust, the web runtime should not stall or fail on the same request shape
- if the downstream adapter fails, the user-visible error should preserve the real cause instead of collapsing to `Internal error`

## Why This Happened

- The Rust ACP backend auto-approves `session/request_permission` for Codex-compatible sessions.
- The Next.js ACP bridge only auto-approves those requests when `autoApprovePermissions === true`.
- Normal web chat flows do not set that flag, so Codex permission requests become pending interactive requests instead of being resolved immediately.
- `codex-acp` then propagates a generic internal error back through the prompt path, and Routa further wraps it into a generic `-32000` response.

## Relevant Files

- `src/core/acp/acp-process.ts`
- `src/app/api/acp/acp-session-create.ts`
- `src/core/acp/session-prompt.ts`
- `crates/routa-core/src/acp/process.rs`
- `/Users/phodal/ai/codex-acp/src/thread.rs`

## Reproduction Context

1. Start the Next.js app locally.
2. Create or reuse a Codex ACP session in the web UI.
3. Send a prompt that causes Codex to request extra permissions.
4. Observe `session/request_permission` in server logs.
5. Observe the prompt fail with `Internal error` instead of continuing.

## Notes

- This is a web-vs-rust semantic parity bug, not just a Codex adapter bug.
- `codex-acp` also reduces internal failures to a generic `Internal error`, which makes the web symptom harder to diagnose.
