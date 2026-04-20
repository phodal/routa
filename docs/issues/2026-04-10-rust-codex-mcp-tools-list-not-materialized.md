---
title: "Rust desktop Codex MCP session initially appeared to expose no usable Routa tools"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "desktop"
tags: [rust, desktop, codex, mcp, kanban, protocol, tauri]
reported_by: "Codex"
related_issues:
  - "2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md"
---

# Rust desktop Codex MCP session initially appeared to expose no usable Routa tools

## What Happened

In the Rust desktop Kanban flow, Codex sessions can now start with the Routa MCP server configured, but the agent still behaves as if no Kanban planning tools are available.

Observed behavior:

- Codex conversation attempts generic MCP discovery calls such as `list_mcp_resources` and `list_mcp_resource_templates`.
- Codex then reports that tools like `create_card`, `decompose_tasks`, and `search_cards` are not exposed in the session.
- The Rust backend logs show that Codex did send MCP requests to Routa, including:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `resources/list`
  - `resources/templates/list`
- `codex app-server` runtime inspection shows the MCP server entry is present as `routa-coordination`, but its tool inventory is still empty from Codex's point of view.

At the time, this made it look like the failure had moved past configuration injection. Codex could see the MCP server, but appeared not to materialize the Routa tool list into the active session.

## Expected Behavior

- Rust desktop Codex sessions should expose the same Routa MCP tools that work in the Next.js flow.
- A Kanban planning session with `mcpProfile=kanban-planning` should surface `create_card`, `decompose_tasks`, `search_cards`, `list_cards_by_column`, `update_task`, `update_card`, `move_card`, `request_previous_lane_handoff`, and `submit_lane_handoff`.
- Codex should not fall back to "tooling gap" reasoning when the server has already received `tools/list`.

## Reproduction Context

- Environment: desktop
- Trigger: open a Rust/Tauri Kanban board, choose Codex, submit a planning request such as `create a js hello world`, then inspect the Codex session transcript and MCP server status.

## Why This Looked Broken

- The original working theory was that the Rust `/api/mcp` endpoint diverged from SDK streamable-HTTP semantics.
- That theory was directionally useful: the hand-written Rust MCP transport did differ from the official streamable-HTTP lifecycle in small but important ways.
- At the same time, one diagnostic signal was misleading: `codex app-server` `mcpServerStatus/list` could still show `tools: {}` even when the live end-to-end Kanban flow was closer to working than the probe suggested.
- In practice, this was a layered failure:
  - Codex launch needed reliable MCP injection.
  - The desktop MCP route needed to match official `rmcp` streamable-HTTP lifecycle semantics.
  - Single-point status probes were not enough to prove whether the real Kanban card-creation path was broken or healthy.

## Resolution

The final desktop recovery came from applying both layers together:

1. Routa stopped depending on the user's global Codex config and now injects Routa MCP through:
   - a Routa-private overlay file at `~/.routa/codex/config.toml`
   - CLI `-c key=value` overrides
   - ACP `mcpServers` payloads for `codex-acp`
2. Rust `/api/mcp` was migrated from a hand-written transport wrapper to the official `rmcp::transport::StreamableHttpService`.

After those changes, the original end-to-end requirement was verified again:

- On the desktop Kanban page, choosing `Codex` and sending a planning request can create a card through the live ACP/MCP session.

## What We Learned

- `mcpServerStatus/list` is an advisory signal, not a final verdict.
- A live Kanban ACP session is a better truth source than an isolated MCP status probe.
- If Codex starts and opens a session but the board does not change, always distinguish:
  - launch/config injection failures
  - MCP protocol/session lifecycle failures
  - UI refresh or board-state persistence failures

## Relevant Files

- `crates/routa-server/src/api/mcp_routes.rs`
- `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`
- `crates/routa-server/tests/rust_api_mcp_routes.rs`
- `src/app/api/mcp/route.ts`
- `crates/routa-core/src/acp/process.rs`
- `/Users/phodal/ai/codex/codex-rs/codex-mcp/src/mcp_connection_manager.rs`
- `/Users/phodal/ai/codex/codex-rs/rmcp-client/src/rmcp_client.rs`

## Key Observations

- `config/read` from `codex app-server` confirmed that `mcp_servers.routa-coordination` was active, with origin `sessionFlags`.
- `mcpServerStatus/list` from `codex app-server` reported `routa-coordination`, but `tools` stayed empty during diagnosis.
- A concrete protocol bug was identified in the Rust route: `notifications/initialized` incorrectly returned a JSON-RPC body.
- Rust `/api/mcp` was migrated to the official `rmcp` `StreamableHttpService`, and the Rust MCP contract tests passed with SSE initialize + initialized-notification flow.
- The user later verified that the original Kanban + Codex card-creation path works again, which means the earlier empty-tool probe was not sufficient to declare the end-to-end feature broken after the transport/config fixes landed.

## Recommended Debugging Order For Similar Failures

1. Confirm the real symptom first.
   Is the problem “Codex session fails to start”, “session starts but sees no tools”, or “session runs but board state does not change”?

2. Verify launch-time MCP injection.
   Check that Routa passes MCP through private overlay + CLI overrides + ACP `mcpServers`, without mutating `~/.codex/config.toml`.

3. Verify MCP lifecycle on the server.
   Confirm `initialize`, `notifications/initialized`, and `tools/list` are handled with official streamable-HTTP semantics.

4. Test the real user flow, not just probes.
   Use the Kanban page, select `Codex`, submit a planning request, and check whether a card is created.

5. Treat `codex app-server` status as supporting evidence only.
   If `mcpServerStatus/list` shows `tools: {}`, do not stop there. Compare it with live ACP session behavior and server logs.

6. If the session runs but no card appears, inspect both sides.
   Check the latest session in `/api/sessions` and the workspace task/card state to separate MCP/tool issues from UI refresh or persistence issues.

## References

- `docs/issues/2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md`
