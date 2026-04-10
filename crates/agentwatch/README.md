# AgentWatch

`agentwatch` is a local Rust CLI for attributing file changes across concurrent coding agents in one git repo.

## Scope (MVP)

- Session register via hook payload (Codex/Claude-first).
- Real-time and on-demand file change observation from `git status`.
- Group current dirty files by session.
- Query who changed a file last and with what confidence.
- Emit a continuous watch stream (`agentwatch watch`).
- Git boundary reset events from `post-commit`, `post-checkout`, `post-merge`.

## Commands

- `agentwatch sessions`
  - Show active sessions in this repo (active means touched within the last inference window, default 15 minutes), ordered by recent activity.
- `agentwatch files --by-session`
  - Show current dirty files. Optional grouping by session.
- `agentwatch who <path>`
  - Show latest attribution result for a file.
- `agentwatch watch`
  - Poll and print file/state updates continuously.
- `agentwatch hook <client> <event>`
  - Read hook payload from stdin.
  - Stores session, turns, and explicit file hints from the event payload.
- `agentwatch git-hook <event>`
  - Internal command for Git hook integration. Not intended as user-facing.

## Database

By default, the DB is placed under the git directory:

- `<repo>/.git/agentwatch/agentwatch.db`

If that path is not writable (for example in read-only working trees), AgentWatch automatically falls back to:

- `AGENTWATCH_DB_DIR/agentwatch/repos/<repo-hash>/agentwatch.db`
- otherwise `/tmp/agentwatch/repos/<repo-hash>/agentwatch.db`

You can force a specific location with:

- `AGENTWATCH_DB_PATH`

### Tables

- `sessions`
  - `session_id`, `repo_root`, `client`, `cwd`, `model`, `started_at_ms`,
    `last_seen_at_ms`, `ended_at_ms`, `status`, `tmux_session`, `tmux_window`,
    `tmux_pane`, `metadata_json`.
- `turns`
  - `session_id`, `repo_root`, `turn_id`, `client`, `event_name`, `tool_name`,
    `tool_command`, `observed_at_ms`, `payload_json`.
- `file_events`
  - `repo_root`, `rel_path`, `event_kind`, `observed_at_ms`, `session_id`, `turn_id`,
    `confidence` (`exact|inferred|unknown`), `source`, `metadata_json`.
- `git_events`
  - `repo_root`, `event_name`, `head_commit`, `branch`, `observed_at_ms`,
    `metadata_json`.
- `file_state`
  - `repo_root`, `rel_path`, `is_dirty`, `state_code`, `mtime_ms`, `size_bytes`,
    `last_seen_ms`, `session_id`, `turn_id`, `confidence`, `source`.

## Hook payload shapes (MVP parsing)

`agentwatch` uses best-effort JSON extraction to stay tolerant.

### Codex examples

Common fields read from payload:

- `session_id`, `turn_id`, `cwd`, `model`
- `hook_event_name`
- `tool_name`, `tool_input`

Event mappings expected by `agentwatch hook`:

- `SessionStart`
- `PreToolUse`
- `PostToolUse`
- `UserPromptSubmit`
- `Stop`
- `Edit`
- `Write`

> `Edit` and `Write` are supported as both top-level event names and as `tool_name` values.
> When your hook provider emits `PreToolUse/PostToolUse` with `tool_name=Edit` or `tool_name=Write`,
> the same event path is still handled.

```json
{
  "session_id": "thread-abc",
  "turn_id": "turn-9",
  "cwd": "/Users/me/repos/project",
  "model": "gpt-5",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/main.rs\n@@\n }\n"
  }
}
```

### Edit|Write focused example

`agentwatch` also accepts editor-style payloads with `tool_name` set to `Edit`/`Write`.

```json
{
  "session_id": "thread-abc",
  "turn_id": "turn-9",
  "cwd": "/Users/me/repos/project",
  "hook_event_name": "Edit",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "src/main.rs"
  }
}
```

### Claude-style examples

`agentwatch` accepts snake_case fields too:

- `sessionId`, `turnId`, `hookEventName`, `toolName`, `toolInput`
  - `toolName` is commonly `Edit` / `Write` for direct edit hooks.

```json
{
  "sessionId": "thread-abc",
  "turnId": "turn-9",
  "cwd": "/Users/me/repos/project",
  "hookEventName": "PostToolUse",
  "toolName": "Edit",
  "toolInput": {
    "command": "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/main.rs\n@@\n }\n"
  }
}
```

## Hook installation sample

`~/.codex/hooks.json` example:

```json
{
  "hooks": [
    {
      "event": "SessionStart",
      "command": "agentwatch hook codex session-start"
    },
    {
      "event": "PreToolUse",
      "command": "agentwatch hook codex pre-tool-use"
    },
    {
      "event": "PostToolUse",
      "command": "agentwatch hook codex post-tool-use"
    },
    {
      "event": "Stop",
      "command": "agentwatch hook codex stop"
    },
    {
      "event": "Edit",
      "command": "agentwatch hook codex edit"
    },
    {
      "event": "Write",
      "command": "agentwatch hook codex write"
    }
  ]
}
```

Git hooks (`.git/hooks/post-commit`, etc) should call:

```bash
agentwatch git-hook post-commit
```

`post-commit` and `post-checkout` are enough for the MVP boundary reset behavior
(`post-merge` is included for safety in one-click install).

## One-click install

Use the installer script in this crate:

```bash
cd /Users/phodal/ai/routa-js
cargo build -p agentwatch
AGENTWATCH_BIN=$PWD/target/debug/agentwatch ./crates/agentwatch/scripts/install-hooks.sh
```

Templates written by the installer:

- `$HOME/.codex/hooks.json`
- `.git/hooks/post-commit`
- `.git/hooks/post-merge`
- `.git/hooks/post-checkout`

For a repo-local override, export a custom binary path before running:

```bash
AGENTWATCH_BIN=/absolute/path/to/agentwatch ./crates/agentwatch/scripts/install-hooks.sh
```

All installed hook scripts read `AGENTWATCH_BIN`, and if not set they fall back to `agentwatch` in `PATH`.

## File attribution behavior

Attribution is written in three levels:

- `exact`: explicit path hints were found in the hook payload (`path`, `paths`,
  `file`, `filepath`, patch block header).
- `inferred`: no explicit hint, inferred from active sessions in the same repo
  within default 15m window.
- `unknown`: no reliable attribution.

## Quick integration

Codex hook command sample:

```bash
agentwatch hook codex "$event" < /path/to/payload.json
```

Git hook sample (`post-commit`, `post-merge`, `post-checkout`) can call:

```bash
agentwatch git-hook post-commit
```

## Local smoke test (current repo)

You can validate hook ingestion and git integration in one repo with:

```bash
cd /Users/phodal/ai/routa-js
DB=/tmp/agentwatch-local-test.db

cargo run -p agentwatch -- --repo . --db "$DB" hook codex SessionStart <<'JSON'
{"session_id":"smoke-1","turn_id":"turn-1","cwd":"."}
JSON

cargo run -p agentwatch -- --repo . --db "$DB" hook codex PostToolUse <<'JSON'
{"session_id":"smoke-1","turn_id":"turn-2","tool_input":{"path":"README.md","command":"echo smoke > /tmp/not-in-repo.txt"}}
JSON

cargo run -p agentwatch -- --repo . --db "$DB" who README.md
cargo run -p agentwatch -- --repo . --db "$DB" files --by-session

# Simulate a dirty file in repo then refresh file state from git status.
touch .agentwatch_smoke_tmp
cargo run -p agentwatch -- --repo . --db "$DB" git-hook post-commit --
cargo run -p agentwatch -- --repo . --db "$DB" who .agentwatch_smoke_tmp
rm -f .agentwatch_smoke_tmp
cargo run -p agentwatch -- --repo . --db "$DB" git-hook post-commit --
```

Expected:

- `who README.md` prints a concrete `session=smoke-1`.
- `files --by-session` contains dirty entries after `git-hook`.
- `git-hook` exits successfully and updates `file_state` records used by `who`.
