---
title: "Kanban card detail lacked an explicit close action and stable return path"
date: "2026-04-14"
status: resolved
resolved_at: "2026-04-14"
severity: medium
area: "kanban"
tags: [kanban, card-detail, navigation, url-state, ui]
reported_by: "xpsuper"
github_issue: 445
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/445"
related_issues: [
  "docs/issues/2026-04-08-kanban-detail-information-architecture-and-session-pane-friction.md"
]
---

# Kanban card detail lacked an explicit close action and stable return path

## What Happened

Opening a Kanban card detail could trap the user inside the detail overlay:

1. There was no explicit close action in the detail header.
2. Closing relied mainly on `Escape`, which is not discoverable and is easy to miss.
3. The current card detail state was local UI state only, so browser back/forward did not reliably map to "return to board".
4. Board selection and task detail state were not deep-linkable together.

## Expected Behavior

- Card detail should expose a visible close action.
- Returning to the board should work through normal browser history semantics.
- Deep links should be able to restore the selected board and selected task together.

## Reproduction Context

- Environment: web / desktop
- Trigger: open `workspace/.../kanban`, open a card detail, then try to return to the board list without relying on keyboard-only shortcuts

## Why This Happened

- The close behavior existed only as parent component state reset in `kanban-tab.tsx`.
- The detail header did not receive an explicit `onClose` affordance.
- `activeTaskId` / `selectedBoardId` were managed locally and not reflected into URL state.

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-url-state.test.tsx`

## Resolution

This issue is resolved in the current codebase.

Implemented changes:

- Added an explicit `Close card detail` action to the card detail header.
- Synced card detail visibility with `taskId` in the URL query string.
- Synced board selection with `boardId` in the URL query string.
- Restored board/task detail state from deep links such as `?boardId=...&taskId=...`.
- Ensured switching boards clears task detail when the active card belongs to a different board.

## Verification

- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx'`
- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-url-state.test.tsx'`

## Sync Notes

- Fix commits pushed to `main`:
  - `46c5c610 fix(kanban): add explicit card detail close action (#445)`
  - `1713fbf9 fix(kanban): sync card detail with task url state (#445)`
  - `002305a5 fix(kanban): sync board selection with url state (#445)`
  - `b3300252 fix(kanban): correct url state helper typing (#445)`
