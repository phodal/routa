---
title: "History Analysis should save a minimal task-adaptive history memory result instead of relying on generic update_task"
date: "2026-04-22"
kind: issue
status: closed
severity: medium
area: "kanban"
tags: ["jit-context", "history-analysis", "mcp", "kanban"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md"
github_issue: 519
github_state: closed
github_url: "https://github.com/phodal/routa/issues/519"
---

# History Analysis should save a minimal task-adaptive history memory result instead of relying on generic update_task

## What Happened

`Open History Analysis` can launch a dedicated analyst session, but the resulting structured analysis often never appears back on the card detail.

Current behavior shows:

- card detail continues to render retrieval/process data from `JIT Context`
- saved analysis UI is only populated if `task.jitContextSnapshot.analysis` exists
- the current history analyst prompt asks the model to call the generic `update_task` tool with a large `jitContextAnalysis` payload
- in practice, launched analysis sessions can remain in planning mode or never persist the final result

As a consequence, users can see the analysis session page, but reopening the card does not reliably show a saved structured result.

## Expected Behavior

History Analysis should have a dedicated save path:

- analyst reads existing retrieval/process context from the card
- analyst produces only the reusable result fields
- analyst calls a focused `save_history_memory_context` MCP tool
- reopening the card shows the saved result immediately

The saved payload should stay intentionally small and optimized for reuse in later planning/implementation sessions.

## Reproduction Context

- Environment: web
- Trigger: open a Kanban card, open `JIT Context`, launch `Open History Analysis`, then reopen the card detail

Observed local state during validation:

- `jitContextSnapshot` was present for multiple demo cards
- `jitContextSnapshot.analysis` remained empty
- launched history-analysis sessions did not reliably write the final result back to the task

## Why This Might Happen

- `update_task` is too generic and does not strongly signal that saving the final JIT result is mandatory
- the current analysis schema is too large and mixes reusable result fields with process-oriented reasoning details already shown in the UI
- specialist prompt complexity may increase the chance that the model keeps reasoning without calling the save path

## Refined Direction

Introduce a dedicated MCP tool `save_history_memory_context` that only persists the minimal reusable result for a specific task.

Suggested saved shape:

- `summary`
- `topFiles`
- `topSessions`
- `recommendedContextSearchSpec`
- `reusablePrompts`
- optional `updatedAt`

Process-oriented data such as matched files, warnings, failures, and history summaries should continue to come from the existing `JIT Context` retrieval UI and should not be duplicated in saved analysis.

## Relevant Files

- `src/core/models/task.ts`
- `src/core/tools/agent-tools.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `src/core/mcp/mcp-server-profiles.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `resources/specialists/tools/history-summary-analyst.yaml`
- `resources/specialists/locales/en/tools/history-summary-analyst.yaml`
- `resources/specialists/locales/zh-CN/tools/history-summary-analyst.yaml`

## Observations

- The UI already has enough process data to explain how context was recovered.
- The missing piece is a reliable result-only save path that survives card reopen and can be reused by later sessions.
- Existing saved-analysis rendering can be simplified once only the minimal reusable fields remain.

## Verification

- 2026-04-22: verified on `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839&taskId=bc897ba8-b85f-49ce-9564-81acde182001`
- `JIT Context -> Open History Analysis` opened a new session page at `/workspace/default/sessions/24bcb54f-bd07-46ec-8509-4f5f42b822bd`
- session history confirmed a real `save_history_memory_context` MCP tool call
- `GET /api/tasks/bc897ba8-b85f-49ce-9564-81acde182001` then showed `task.jitContextSnapshot.analysis` persisted with `summary`, `topFiles`, `topSessions`, `reusablePrompts`, and `recommendedContextSearchSpec`
- reopening the card detail and expanding `JIT Context` showed `Saved History Analysis` in the UI, including the saved summary, top files, top sessions, and reusable prompts
- 2026-04-22: follow-up prompt audit found that `Open History Analysis` still embedded a full JSON example in the generated prompt, which pulled the analyst back toward echoing payloads in chat instead of treating `save_history_memory_context` as the primary save path
- fixed by simplifying the generated prompt to:
  - require the tool call explicitly
  - name the tool fields that matter
  - forbid dumping the payload back into chat
- regression coverage:
  - `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`
  - `npx tsc --noEmit`
  - `npx eslint 'src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx' 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`

## References

- `docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md`

## Resolution

- 2026-04-22: closed after live verification confirmed the dedicated minimal save path is working.
- Verified on the live app with:
  - task `bc897ba8-b85f-49ce-9564-81acde182001`
  - history-analysis session `24bcb54f-bd07-46ec-8509-4f5f42b822bd`
- Evidence:
  - the session transcript contains a real `save_history_memory_context` MCP tool call
  - the saved payload persists back to `task.jitContextSnapshot.analysis`
  - the stored result contains the intended minimal reusable shape (`summary`, `topFiles`, `topSessions`, `reusablePrompts`, `recommendedContextSearchSpec`)
- Any remaining card-detail visibility problems now belong to the Kanban surface issue `#516`, not to the save path itself.
