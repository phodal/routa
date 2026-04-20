# Feature Explorer mock

This bundle is a standalone UI mock for a **new workspace-level page**:

`/workspace/[workspaceId]/feature-explorer`

It is intentionally **peer-level with** existing workspace routes such as `sessions`, `kanban`, and `team`.

## Files

- `page.tsx`
- `feature-explorer-page-client.tsx`
- `mock-data.ts`

## What this mock demonstrates

- A VS Code-like independent explorer page
- Left column: feature list
- Middle column: **feature-scoped file explorer**
- Right column: **Context / Screenshot / API(Postman-style)** inspector
- Bottom action bar: continue with selected files

## Notes

- This is a **UI mock**, not a full backend integration.
- The right-side API panel supports:
  - `Run mock`
  - `Try live request` using `fetch(...)`
- Screenshot cards are visual placeholders, ready to be replaced by real snapshot metadata.
- You can later wire the "Continue with selected files" button into session creation / session restoration flows.

## Suggested next integration step

1. Add a nav entry to `/workspace/[workspaceId]/feature-explorer`
2. Replace `mock-data.ts` with real feature/file aggregation data
3. Wire the API inspector presets to real endpoints
4. Persist file selection into session context / continue payload
