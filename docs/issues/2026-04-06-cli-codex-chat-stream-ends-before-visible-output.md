---
title: "CLI chat and team flows can end streaming before Codex emits visible output"
date: "2026-04-06"
status: resolved
severity: high
area: cli
tags: ["cli", "chat", "team", "acp", "codex", "streaming", "timeout"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/363"]
github_issue: 363
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/363"
resolved_at: "2026-04-07"
---

# CLI chat and team flows can end streaming before Codex emits visible output

## What Happened

`routa chat --provider codex` could create a Codex ACP session successfully, accept user input, and still return to the CLI prompt before any assistant text became visible.

The hidden failure mode was:

1. `codex-acp` started and initialized correctly.
2. The user prompt was submitted successfully.
3. Codex emitted many internal `process_output` log lines before its first user-visible `agent_message_chunk`.
4. The CLI treated those background logs as activity and then applied a short idle timeout.
5. `routa chat` returned to `>` before the first visible token arrived, even though the session history later contained the full assistant reply.

The same structural problem also applied to `routa team`, which used the same stream-drain pattern after `prompt()`.

## Expected Behavior

- `routa chat --provider codex` should keep streaming until one of these happens:
  - a visible assistant/tool update arrives and the turn later goes idle,
  - a `turn_complete` event is observed,
  - the underlying process exits, or
  - an explicit long timeout is hit.
- Hidden provider logs should not cause the CLI to conclude that a user-visible turn has already started.
- `routa team` should use the same robust streaming behavior.

## Reproduction Context

- Environment: local CLI on Linux
- Trigger:
  1. Install a working `codex-acp` adapter.
  2. Run `routa chat --provider codex`.
  3. Send a simple prompt such as `hello, please reply with exactly: ROUTA CODEX CHAT OK`.
  4. Observe the CLI return to `>` before any visible assistant output appears.
  5. Inspect persisted session history and confirm that the assistant eventually replied.

## Why This Happened

- `chat.rs` awaited `state.acp_manager.prompt(...)` and only then drained the broadcast stream, which is a poor fit for slower providers whose visible output arrives late.
- The idle policy used a short post-activity timeout without distinguishing visible output from filtered provider logs.
- `tui.rs` correctly hid Codex internal logs from the terminal, but `chat.rs` / `team.rs` still allowed those hidden events to influence idle-state decisions.

## Relevant Files

- `crates/routa-cli/src/commands/chat.rs`
- `crates/routa-cli/src/commands/team.rs`
- `crates/routa-cli/src/commands/tui.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-core/src/acp/process.rs`

## Observations

- A persisted session created from `routa chat --provider codex` showed:
  - successful ACP session creation,
  - submitted prompt logs,
  - many `process_output` entries from Codex internals,
  - later `agent_message_chunk` entries,
  - final assistant text `ROUTA CODEX CHAT OK`.
- The user-visible CLI returned to the prompt before those `agent_message_chunk` entries were rendered.
- A local candidate fix was able to reproduce the expected visible output once streaming switched to concurrent prompt+update handling and only visible terminal activity reset the short idle budget.
