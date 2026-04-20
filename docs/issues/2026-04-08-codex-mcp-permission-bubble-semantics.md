---
title: "Codex MCP approval requests render as generic command-permission cards instead of option-driven MCP approvals"
date: "2026-04-08"
status: investigating
severity: medium
area: ui
tags: ["acp", "codex", "mcp", "permission", "ui", "kanban"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/401"]
---

# Codex MCP approval requests render as generic command-permission cards instead of option-driven MCP approvals

## What Happened

Codex MCP approval requests are currently displayed through the generic `PermissionRequestBubble` flow.

Observed payload shape:

- `toolCall.title = "Approve MCP tool call"`
- `toolCall.rawInput.server_name = "routa-coordination"`
- `toolCall.rawInput.request._meta.codex_approval_kind = "mcp_tool_call"`
- `options = ["approved", "approved-for-session", "approved-always", "cancel"]`

The UI still renders this as if it were a command-prefix permission:

- generic title and reason-heavy layout
- scope selector plus allow/deny buttons
- oversized technical details block
- no first-class rendering of MCP server, tool name, tool description, or formatted arguments
- no way to directly choose the explicit `approved-always` option

## Expected Behavior

- render MCP approval requests from the `options[]` contract directly
- show the MCP server and tool identity as the primary title
- show tool description and formatted arguments compactly
- render each explicit option as its own action button
- avoid overloading MCP approvals with the exec-permission scope selector UI

## Why This Happened

`PermissionRequestBubble` assumes all ACP permission requests are variants of the same internal model:

- approve vs deny
- turn vs session
- optional exec-policy amendment details

That assumption holds for command execution approvals but not for Codex MCP elicitation approvals, which are already normalized by `codex-acp` into a discrete option list.

## Relevant Files

- `src/client/components/message-bubble.tsx`
- `src/client/components/__tests__/message-bubble-permissions.test.tsx`
- `/Users/phodal/ai/codex-acp/src/thread.rs`

## Notes

- This issue is separate from the remaining `failed to deserialize response` ACP bug.
- Even when the backend flow succeeds, this UI currently misrepresents the approval semantics sent by Codex.

## Follow-up Resolution Direction

The UI should converge on a two-state pattern instead of rendering every permission request as a large card:

- `waiting`: full interactive approval card with explicit option buttons and key MCP/tool details
- `completed` / `failed`: compact single-line summary row that preserves the decision outcome, with click-to-expand details for debugging

This keeps the transcript scannable while still allowing inspection of:

- MCP server and tool identity
- command / reason for exec-style approvals
- formatted argument details
- raw requested permission payload when needed
