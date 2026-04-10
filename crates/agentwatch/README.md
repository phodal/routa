# AgentWatch

`agentwatch` is a Rust terminal tool for tracking multiple coding-agent sessions inside one git repository.

It is `TUI-first`: the main path is a live terminal view that answers:

- which sessions are active
- which files each session most likely touched
- which files are still dirty in the worktree
- what changed recently from hooks, git hooks, and watcher events

## Current Hook Setup

This repository already has a repo-local Codex hook config at [`.codex/hooks.json`](/Users/phodal/ai/routa-js/.codex/hooks.json).

It currently forwards:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

And the tool matcher includes:

- `Bash`
- `Read`
- `Write`
- `Edit`
- `MultiEdit`
- `LS`
- `Glob`
- `Grep`
- `Search`
- `WebSearch`

That means a session can stay visible even when it is only reading/searching, not just writing.

## Runtime Model

AgentWatch now supports three local runtime transport layers, in this order:

1. Unix domain socket
2. Localhost TCP
3. Append-only JSONL feed fallback

The current commands are:

- `agentwatch tui`
- `agentwatch serve`
- `agentwatch hook <client> <event>`
- `agentwatch git-hook <event>`

Recommended local flow:

```bash
cargo build -p agentwatch
target/debug/agentwatch --repo . serve
target/debug/agentwatch --repo . tui
```

If local socket/port binding is unavailable, hooks automatically fall back to the JSONL feed.

## TUI Layout

Example layout:

```text
 AgentWatch  repo:routa-js  branch:main  WATCH  files:BY SESSION  refreshed 0s ago
┌Sessions───────────────────┬Files──────────────────────────────┬Details─────────────────────┐
│ …hook-check  ACTIVE gpt-5 │ src/main.rs                      │ src/main.rs                │
│ pane %12  5s ago  3 files │ M +12 -4      5s  live-hook     │ last by live-hook-check    │
│ Unknown      UNKNOWN watch│ docs/design-docs/agentwatch.md   │ modified 03:54:00 (8s)     │
│ pane ?    0s ago  2 files │ A +23         2s  unknown       │ confidence inferred        │
│                           │ tests/session_watch.rs           │ lines 182  size 6.4 KB     │
│                           │ D -1          11s  unknown       │ git changes 14  state dirty│
├───────────────────────────┴───────────────────────────────────┴────────────────────────────┤
│ Event Stream (all)                                                                      │
│ 03:54:01 [hook]  session live-hook-check PostToolUse Read                               │
│ 03:54:02 [watch] watch modify src/main.rs                                               │
│ 03:54:04 [git]   post-commit main                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
 Tab focus  ↑↓ select  Enter file  D diff  T theme  1/2/3/4 log filter  r follow  q quit
```

Main regions:

- `Sessions`: active, idle, stopped, and synthetic `Unknown`
- `Files`: `BY SESSION`, `GLOBAL`, `UNKNOWN-CONFLICT`
- `Details`: selected file metadata + preview/diff
- `Event Stream`: hook / git / watch events

## Keybindings

- `Tab`: switch focus
- `j/k` or `↑/↓`: move selection
- `h/l` or `←/→`: switch file pager
- `Enter`: file preview
- `D`: diff view
- `s`: cycle file mode
- `T`: cycle theme
- `r`: follow mode on/off
- `1`: all events
- `2`: hook events
- `3`: git events
- `4`: watch events
- `[` / `]`: previous / next diff hunk
- `q`: quit

## Install Hooks

Build first:

```bash
cargo build -p agentwatch
```

Install templates:

```bash
AGENTWATCH_BIN=$PWD/target/debug/agentwatch ./crates/agentwatch/scripts/install-hooks.sh
```

This installs:

- `$HOME/.codex/hooks.json`
- `.git/hooks/post-commit`
- `.git/hooks/post-merge`
- `.git/hooks/post-checkout`

In this repository, the repo-local [`.codex/hooks.json`](/Users/phodal/ai/routa-js/.codex/hooks.json) is already present and is the one you should inspect first.

## Notes

- `agentwatch sessions`, `files`, `who`, and `watch` still exist as legacy/debug commands.
- The SQLite store is still present for fallback/debug paths, but the primary direction is realtime transport plus TUI.
- When multiple sessions touch the same worktree and attribution is ambiguous, AgentWatch intentionally shows `unknown/conflict` instead of faking certainty.
