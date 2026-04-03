---
title: "Kanban ACP sessions do not support browser-embedded interactive terminal control"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-19"
severity: medium
area: "kanban"
tags: ["kanban", "acp", "terminal", "xterm", "web", "session-ui"]
reported_by: "codex"
github_issue: 156
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/156"
related_issues:
  - "docs/issues/2026-03-07-opencode-bridge-terminal-requests.md"
  - "docs/issues/2026-03-06-session-layout-and-sidebar-friction.md"
  - "https://github.com/phodal/routa/issues/156"
---

# Kanban ACP sessions do not support browser-embedded interactive terminal control

## What Happened

The `/workspace/[workspaceId]/kanban` experience can open ACP sessions inside the board UI, but the session area is still a chat-centric panel. Terminal output from ACP agent operations can already be rendered in xterm.js, yet the web UI does not provide a way to enable a real interactive terminal and send keyboard input back into a running shell from the browser.

## Expected Behavior

Kanban should be able to offer an explicit browser-side interactive terminal mode for ACP sessions when the provider and runtime support it, so users can inspect or continue work directly in the same modal/panel instead of switching to a separate session page or desktop-only PTY flow.

## Reproduction Context

- Environment: web
- Trigger:
  1. Open `/workspace/<workspaceId>/kanban`
  2. Start or open an ACP session from a Kanban card or the KanbanTask Agent panel
  3. Observe that the session UI embeds `ChatPanel`
  4. Observe that terminal rendering is output-only and there is no browser control path for shell stdin

## Why This Might Happen

- The Kanban UI currently reuses the existing session `ChatPanel` and does not define a terminal-first interaction mode.
- The web terminal renderer is intentionally read-only, while the only interactive terminal component is tied to desktop PTY commands.
- ACP terminal support on the server is designed for agent-initiated terminal lifecycles (`terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`) rather than user-driven shell input.
- The browser ACP client and `/api/acp` route expose prompt and cancellation flows, but not a dedicated browser-to-terminal input API.

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/client/hooks/use-acp.ts`
- `src/client/acp-client.ts`
- `src/client/components/message-bubble.tsx`
- `src/client/components/terminal/terminal-bubble.tsx`
- `src/client/components/terminal/pty-terminal.tsx`
- `src/core/acp/acp-process.ts`
- `src/core/acp/terminal-manager.ts`
- `src/app/api/acp/route.ts`

## Observations

- `kanban-page-client.tsx` creates ACP sessions and immediately sends prompts, which makes Kanban session launch path straightforward but chat-oriented.
- `kanban-tab.tsx` renders ACP sessions in-place through `ChatPanel` both for the KanbanTask Agent side panel and the task detail modal.
- `terminal-bubble.tsx` already uses xterm.js, but sets `disableStdin: true`, so browser users cannot type into it.
- `pty-terminal.tsx` is interactive, but only for Tauri and only through desktop bridge commands such as `pty_create` and `pty_write`.
- `terminal-manager.ts` already manages long-lived server-side shell processes and streams output over ACP `session/update`, so part of the backend foundation exists.
- `/api/acp` currently handles `session/new`, `session/prompt`, `session/respond_user_input`, and `session/cancel`, but not a user-facing terminal input channel for browser sessions.

## References

- `resources/specialists/issue-enricher.md`

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx` renders ACP
  task sessions through `ChatPanel`, so the Kanban session pane now reuses the
  same browser terminal interaction path as the main session UI.
- `src/client/components/message-bubble.tsx` passes
  `interactive={Boolean(message.terminalInteractive) ...}` into
  `TerminalBubble`, together with `onInput` and `onResize` handlers.
- `src/client/components/terminal/terminal-bubble.tsx` enables browser stdin
  when `interactive` is true, wires `terminal.onData(...)` and
  `terminal.onResize(...)`, and no longer behaves as output-only in that mode.
- `src/client/hooks/use-acp.ts` exposes `writeTerminal(...)` and
  `resizeTerminal(...)`, `src/client/components/chat-panel.tsx` calls those
  hooks, and `src/app/api/acp/route.ts` implements the `terminal/write` and
  `terminal/resize` RPC methods.

Current scope note:

- This browser-interactive terminal path is available for ACP chat/session
  panes. A2A task panes still use a different metadata-oriented surface, so the
  interactive terminal capability is not universal across every Kanban session
  transport.
