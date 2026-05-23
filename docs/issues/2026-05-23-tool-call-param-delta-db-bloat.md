---
title: "ACP tool_call_params_delta persistence can bloat SQLite databases"
date: "2026-05-23"
status: resolved
severity: high
area: "storage"
tags: ["sqlite", "acp", "retention", "tool-call-streaming"]
reported_by: "local-operations"
---

# ACP tool_call_params_delta persistence can bloat SQLite databases

## Summary

Large ACP tool inputs were streamed as many `tool_call_params_delta` updates. Routa
persisted repeated `accumulatedJson` and `parsedInput` snapshots for each intermediate
delta, so large tools such as Kanban `update_card` could multiply database size during
long agent sessions.

## Impact

- `session_messages` can dominate the SQLite database size.
- `tool_call_params_delta` rows are much larger than assistant text chunks.
- Cleanup requires JSON compaction and a later SQLite `VACUUM` to physically shrink
  the database file.

## Resolution

- Compact `tool_call_params_delta` notifications before durable persistence.
- Preserve active-session in-memory streaming behavior for realtime UI consumers.
- Add a maintenance tool for dry-run/apply cleanup of existing `session_messages` and
  `acp_sessions.message_history` rows.
- Document the operational cleanup path in
  `docs/operational/runbooks/tool-call-param-delta-compaction.md`.
