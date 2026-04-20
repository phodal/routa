# Harness Monitor

Harness Monitor is a terminal UI for watching what multiple coding agents are doing inside one repository.

Use it when you want to answer questions like:

- Which agent is still active?
- Which files changed recently?
- Who most likely changed each file?
- Are there unattributed or conflicting changes?
- Is the current worktree blocked by fitness or validation issues?

It is built for live local use while agents are coding, reviewing, or recovering from failed checks.

## Quick Start

Build and run it from the repo root:

```bash
cargo build -p harness-monitor
target/debug/harness-monitor --repo .
```

If you want the packaged wrapper instead of building from source:

```bash
npm install -g harness-monitor
harness-monitor --repo .
```

By default, Harness Monitor opens the TUI, starts or connects to its local runtime service, and begins reading live events.

## What You See

The current TUI is optimized for day-to-day operator visibility:

- `Runs`: active, idle, process-scan, and unattributed work
- `Git Status`: dirty files, likely ownership, and test/review hints
- `Run Details`: the selected run’s model, recent tool activity, recovery hints, and changed files
- `Preview`: file or diff view for the selected file
- `Fitness`: latest Entrix result and slow checks
- `Event Stream`: hook, git, watcher, and attribution events

In practice, this lets you keep one screen open and quickly spot:

- a run that stopped making progress
- dirty files with unclear ownership
- a repo that is blocked on hard gates
- a review or recovery loop that needs human attention

## Common Workflow

1. Start `harness-monitor --repo .`
2. Watch `Runs` to see which sessions are active, idle, or degraded
3. Move to `Git Status` to inspect dirty files and ownership confidence
4. Open `Preview` to inspect the file or diff
5. Check `Fitness` when you need to know whether the repo is blocked by validation

This is especially useful when several agents are working in parallel and you need a fast view of both activity and repo risk.

## Runtime Transport

Harness Monitor uses the first transport that works:

1. Unix domain socket
2. Localhost TCP
3. Append-only JSONL feed fallback

If socket or port binding is unavailable, hooks automatically fall back to the JSONL feed. The title bar shows the active mode as `rpc:socket`, `rpc:tcp`, or `rpc:feed`.

## Commands

- `harness-monitor`
- `harness-monitor tui`
- `harness-monitor serve`
- `harness-monitor hook <client> <event>`
- `harness-monitor git-hook <event>`

Legacy and debug-oriented commands such as `sessions`, `files`, `who`, and `watch` still exist.

## Keybindings

- `Tab`: switch focus
- `j/k` or `↑/↓`: move selection
- `h/l` or `←/→`: switch file pager
- `Enter`: open file preview
- `D`: switch to diff view
- `s`: cycle file mode
- `T`: cycle theme
- `/`: start search
- `Esc`: clear search or exit input mode
- `r`: toggle follow mode
- `1`: show all events
- `2`: show hook events
- `3`: show git events
- `4`: show watch events
- `[` / `]`: jump to previous or next diff hunk
- `q`: quit

## Hook Setup

Harness Monitor is most useful when agent hooks are installed, because that gives it high-quality session and tool activity data.

Build first:

```bash
cargo build -p harness-monitor
```

Install the hook templates:

```bash
HARNESS_MONITOR_BIN=$PWD/target/debug/harness-monitor ./crates/harness-monitor/scripts/install-hooks.sh
```

This installs:

- `$HOME/.codex/hooks.json`
- `.git/hooks/post-commit`
- `.git/hooks/post-merge`
- `.git/hooks/post-checkout`

In this repository, there is already a repo-local Codex hook file at [`.codex/hooks.json`](/Users/phodal/ai/routa-js/.codex/hooks.json).

It currently forwards:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

And the matcher includes common tools such as:

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

That means a session can stay visible even when it is mostly reading or searching, not just writing files.

## What Harness Monitor Does Well Today

Today it is strongest at:

- showing live agent activity in one repo
- attributing file changes to likely sessions
- surfacing unknown or conflicting ownership
- combining run activity with repo fitness signals
- giving you a practical live operator view while agents work

It is not yet a full story-level decision cockpit. The long-term direction is to evolve this run-level truth surface into a more decision-oriented operator layer, but this README intentionally describes the current user experience first.

## Notes

- When multiple sessions touch the same worktree and attribution is ambiguous, Harness Monitor intentionally shows `unknown` or `conflict` instead of pretending to be certain.
- SQLite is still present for fallback and debugging paths, but the main direction is realtime transport plus TUI.
- For architectural background, see [../../docs/harness/harness-monitor-run-centric-operator-model.md](../../docs/harness/harness-monitor-run-centric-operator-model.md).
