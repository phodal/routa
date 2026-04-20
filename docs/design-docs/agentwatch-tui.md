---
title: AgentWatch TUI
---

# AgentWatch TUI

AgentWatch is a TUI-first local runtime for multi-agent coding attribution inside one repository.

This document is the canonical design note for the TUI information architecture and runtime model.

## Product Shape

The primary entrypoint is:

```bash
agentwatch tui
```

The TUI answers two questions in realtime:

- who is changing which files
- where the current uncommitted work has progressed to

The product is session-centric, not diff-centric.

## Runtime Model

AgentWatch is a long-lived local process with three inputs:

- Codex hooks
- Git hooks
- periodic repository scans from `git status --porcelain`

The process keeps the active state in memory. Hook commands do not query the UI state directly. They append structured events into a repo-scoped runtime feed:

- `/tmp/agentwatch/runtime/<repo-hash>.jsonl`

This feed is intentionally simple:

- append-only
- local-only
- one writer pattern per hook invocation
- no daemon networking requirement

The TUI tails the feed and folds events into an in-memory state tree.
On startup it begins at the current end of the feed, so the default live view represents "from now on" rather than replaying stale demo data.

## Information Architecture

Default screen layout uses four regions:

1. `Sessions`
   - active / idle / stopped
   - model
   - touched file count
   - tmux pane when available
   - last activity timestamp

2. `Files`
   - selected-session view or global view
   - dirty state
   - attribution confidence
   - last attributed session
   - conflict marker when multiple sessions touched the file

3. `Detail`
   - selected file or session details
   - recent event summary
   - confidence and conflict status
   - current runtime feed path

4. `Event Log`
   - hook and git events in reverse chronological order
   - intended as an operator timeline, not a full audit log

## State Model

The TUI folds events into three state buckets:

### Sessions

- `session_id`
- `cwd`
- `model`
- `client`
- `started_at_ms`
- `last_seen_at_ms`
- `status`
- `tmux_pane`
- `touched_files`
- `last_turn_id`

### Files

- `rel_path`
- `dirty`
- `state_code`
- `last_modified_at_ms`
- `last_session_id`
- `confidence`
- `conflicted`
- `touched_by`
- `recent_events`

### Event Log

- `observed_at_ms`
- `message`

## State Transitions

### Hook Event

- upsert session
- refresh `last_seen_at_ms`
- mark stopped when the event is a stop lifecycle event
- if file paths are present, mark file as dirty and attribute it to the session
- if another session previously owned the file, mark the file as conflicted
- push one condensed event-log line

### Git Event

- push one event-log line
- on `post-commit`, `post-checkout`, `post-merge`, clear dirty markers until the next scan repopulates them

### Repo Scan Tick

- run `git status --porcelain --untracked-files=all`
- refresh dirty file set
- update per-file mtime when available
- move sessions from `active` to `idle` after the inference window expires

## Keybindings

Current V0 bindings:

| Key | Action |
|---|---|
| `Tab` | Cycle focus across Sessions, Files, Detail |
| `j` / `Down` | Move selection down |
| `k` / `Up` | Move selection up |
| `s` | Toggle grouped-by-session vs global file view |
| `d` | Toggle summary vs diff view in the detail pane |
| `r` | Toggle follow mode |
| `q` | Quit |

Planned next bindings:

| Key | Planned Action |
|---|---|
| `/` | Search sessions/files |
| `f` | File filter mode |
| `t` | Sort by last modified time |
| `d` | Show diff summary |
| `e` | Open current file in `$EDITOR` |
| `g` | Jump to git diff view |
| `Enter` | Expand detail mode |

## Design Constraints

- The product must surface `unknown` and `conflicted` explicitly.
- Realtime state is primary; the SQLite store is secondary compatibility/debug infrastructure.
- The TUI should remain useful even if hooks arrive out of order or the live process starts after some files are already dirty.
- Runtime transport must work in local tmux environments without requiring external services.
