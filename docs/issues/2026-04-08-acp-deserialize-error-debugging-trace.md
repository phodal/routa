---
title: "ACP failed to deserialize response during Codex permission flow was caused by terminal response schema drift"
date: "2026-04-08"
status: resolved
severity: high
area: acp
tags: ["acp", "codex", "debugging", "terminal", "schema", "observability"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/399", "https://github.com/phodal/routa/issues/401"]
resolved_at: "2026-04-08"
---

# ACP failed to deserialize response during Codex permission flow was caused by terminal response schema drift

## What Happened

After the earlier permission-request fixes landed, Codex sessions no longer failed with a generic app-side `Internal error`.

The visible failure changed to an ACP-side deserialize error:

```text
POST /api/acp 200 in 12.9s
[browser] Failed to send prompt {
  code: -32000,
  data: {
    code: -32603,
    data: "failed to deserialize response",
    source: "acp"
  },
  message: "Internal error"
}
```

The timing pattern was stable:

1. `session/request_permission` arrived from `codex-acp`
2. the permission response returned quickly
3. the original `session/prompt` stayed open for 10s+
4. the prompt then failed with `source: "acp"` and `failed to deserialize response`

## Why This Was Confusing

The first working theory was that the permission response shape was still wrong.

That was plausible because:

- earlier builds returned non-standard permission payloads
- `codex-acp` expects ACP-standard `RequestPermissionResponse`
- the failing turn always contained a permission request before the final error

However, once the permission response was normalized to ACP `selected/cancelled`, the deserialize error still reproduced.

That meant the malformed response was likely a later client RPC response, not the permission response itself.

## Debugging Trace

### Phase 1: Remove generic wrappers

The initial symptom was just:

- `code: -32000`
- `message: "Internal error"`
- `source: "app"`

Observability was improved so the frontend preserved nested ACP error payloads and surfaced `acp_status:error` updates in the chat transcript.

This changed the error from a generic app failure into:

- `source: "acp"`
- `code: -32603`
- `data: "failed to deserialize response"`

### Phase 2: Verify permission response schema

`codex-acp` and the ACP schema were inspected directly:

- `/Users/phodal/ai/codex-acp/src/thread.rs`
- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

Confirmed expected response shape:

```json
{
  "outcome": {
    "outcome": "selected",
    "optionId": "approved"
  }
}
```

and cancellation:

```json
{
  "outcome": {
    "outcome": "cancelled"
  }
}
```

Routa was updated so all `session/request_permission` responses used this shape.

The deserialize error still remained.

### Phase 3: Re-evaluate what happens after approval

The remaining clue was the timing:

- permission response completed almost immediately
- the prompt failed only after more agent work happened

That strongly suggested the bad payload belonged to a later ACP client method such as:

- `terminal/create`
- `terminal/output`
- `terminal/wait_for_exit`
- `fs/*`

### Phase 4: Compare terminal response shapes against ACP schema

The ACP schema for terminal methods was checked in:

- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

Relevant findings:

- `CreateTerminalResponse` requires `terminalId`
- `TerminalOutputResponse` requires `output`, `truncated`, optional `exitStatus`
- `WaitForTerminalExitResponse` flattens `exitCode` and `signal`

Routa's implementation in `src/core/acp/terminal-manager.ts` was returning simplified structures:

- `terminal/output` returned only `{ output }`
- `terminal/wait_for_exit` returned only `{ exitCode }`

Those are valid for Routa's internal consumers but invalid for ACP's generated Rust types.

## Root Cause

The remaining Codex failure was caused by ACP terminal response schema drift, not by the permission response itself.

After a permission was granted, `codex-acp` continued its turn and hit terminal RPCs whose responses did not match ACP schema. The Rust client then failed to deserialize the JSON-RPC `result` and surfaced:

```text
failed to deserialize response
```

## Fix

`src/core/acp/terminal-manager.ts` was updated so ACP terminal responses match schema:

- `getOutput()` now returns `output`, `truncated`, and `exitStatus` when available
- `waitForExit()` now returns `exitCode` and `signal`
- terminal exit state now tracks both exit code and signal
- ACP-style `env: [{ name, value }]` arrays are normalized before spawning the process

Regression coverage was added in:

- `src/core/acp/__tests__/terminal-manager.test.ts`

## Relevant Files

- `src/core/acp/terminal-manager.ts`
- `src/core/acp/__tests__/terminal-manager.test.ts`
- `src/core/acp/acp-process.ts`
- `src/client/hooks/use-acp.ts`
- `src/client/components/chat-panel/hooks/message-processor.ts`
- `/Users/phodal/ai/codex-acp/src/thread.rs`
- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

## Why This Matters

This incident was not a single bug. It was a layered ACP integration failure:

1. permission handling parity differed between Next.js and Rust
2. UI rendering hid the actual permission payload
3. error propagation collapsed the downstream failure into `Internal error`
4. the remaining protocol mismatch lived in terminal RPC responses

Without preserving intermediate ACP error details, the terminal schema bug would keep masquerading as a permission failure.

## Additional Finding: stale embedded sessions were being silently recreated

Later reproduction on the Kanban card `chore(deps): update sha2 requirement from 0.10 to 0.11` exposed a second failure mode that made the earlier debugging noisier:

- `GET /api/acp` correctly rejected stale embedded sessions with lease / owner errors
- `POST /api/acp` for `session/prompt` could still fall through into prompt auto-create if the in-memory process was gone
- that recreated a fresh Codex process for the same `sessionId`
- the recreated process could run with recovered or fallback metadata that no longer matched the original live execution context

Observed effect:

- the same `sessionId` appeared to "keep failing" even though the underlying process had changed
- prompt retries could drift from a worktree-bound context back to the repo root
- transcript history mixed old failure evidence with new process events, which made protocol diagnosis appear inconsistent

This means there were two distinct classes of problems during the investigation:

1. real ACP response-shape bugs
2. stale embedded session recovery gaps that silently recreated sessions instead of surfacing a hard ownership error

The prompt auto-create path now needs the same embedded ownership guard as the SSE attach path, otherwise cross-instance restarts will continue to produce misleading reproductions.

## UI Impact Observed During Reproduction

The same reproduction also exposed a transcript ergonomics problem:

- completed permission requests were collapsed into visually large cards
- the collapsed state often showed only `Request permissions`
- the useful MCP / command context was hidden entirely unless the original pending payload stayed visible

This made stale-session and protocol debugging harder because finished approvals looked like blank placeholders.

The UI direction for completed permission requests is now:

- render as a compact one-line summary by default
- keep the result chip visible (`Allow`, `Allow for this session`, etc.)
- provide click-to-expand details instead of consuming full transcript height
