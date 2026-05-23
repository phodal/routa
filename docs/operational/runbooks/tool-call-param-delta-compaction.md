# Tool Call Parameter Delta Compaction

## Problem

ACP provider streams can emit many `tool_call_params_delta` notifications while a tool
input JSON object is still being assembled. Persisting the whole accumulated JSON and
the parsed input on every streamed delta creates near-quadratic storage growth for
large tool inputs such as Kanban `update_card` payloads.

The runtime UI may still need the full in-memory stream while a session is active, but
durable storage only needs compact replay metadata for these intermediate deltas.

## What Is Compacted

For persisted `tool_call_params_delta` notifications, Routa now keeps:

- `sessionUpdate`
- tool identity fields such as `toolCallId`, `toolName`, `name`, `kind`, `title`
- a truncated `partialJson` preview
- `partialJsonBytes`
- `accumulatedJsonBytes`
- `parsedInputKeys`
- `compacted: true`
- `compactionReason: "tool_call_params_delta_persistence"`

Routa does not persist repeated full `accumulatedJson` or full `parsedInput` for these
intermediate deltas.

## Historical Cleanup

Always stop the Routa process or make a database backup before applying cleanup.

Dry-run:

```bash
npm run db:compact:tool-deltas -- --db routa.db
```

Apply JSON compaction:

```bash
npm run db:compact:tool-deltas -- --db routa.db --apply
```

Apply and physically shrink the SQLite file:

```bash
npm run db:compact:tool-deltas -- --db routa.db --apply --vacuum
```

`VACUUM` is required for SQLite to return reclaimed pages to the filesystem. Without
it, row payloads are smaller but the `.db` file may remain large.

## Safety Notes

- Dry-run is the default.
- `--vacuum` is rejected unless `--apply` is also present.
- Invalid JSON rows are skipped and counted in the output.
- The tool compacts both `session_messages.payload` and the legacy snapshot stored in
  `acp_sessions.message_history`.
