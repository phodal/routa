---
title: "Backlog refiner should confirm feature-tree context before persisting retrieval hints"
date: "2026-04-23"
kind: issue
status: resolved
resolved_at: "2026-04-23"
severity: medium
area: kanban
tags:
  - backlog-refiner
  - feature-tree
  - context-search
  - canonical-story
reported_by: "codex"
related_issues:
  - "2026-04-22-history-memory-search-pattern-evidence.md"
  - "2026-04-22-backlog-history-memory-should-not-persist-before-refinement.md"
github_issue: 526
github_state: closed
github_url: "https://github.com/phodal/routa/issues/526"
---

# Backlog refiner should confirm feature-tree context before persisting retrieval hints

## What Happened

Backlog refinement recently stopped persisting speculative `contextSearchSpec` before repo inspection, but the current refinement flow still leaves too much normalization work to the agent:

- `load_feature_tree_context` returns raw feature candidates
- the agent has to manually infer which candidate should become the canonical task/feature binding
- the canonical story YAML does not yet have an explicit `feature_tree` section for confirmed feature context
- the same feature confirmation logic is repeated across `create_card`, `decompose_tasks`, and `update_task`

This keeps backlog refinement dependent on ad-hoc `Grep` / `Glob` usage even when feature-tree evidence is already stronger and more structured.

## Expected Behavior

Backlog refinement should have a dedicated feature-tree confirmation path:

1. The agent can call a focused MCP tool to confirm the best feature-tree match for a story/query.
2. The tool returns:
   - the selected feature
   - a normalized `contextSearchSpec`
   - a prompt-ready `feature_tree` YAML block
3. If `taskId` is provided, the tool may persist the confirmed feature/file hints onto the task.
4. Canonical backlog story YAML may include an optional `feature_tree` section after confirmation, so downstream lanes can see which feature the story was anchored to.

## Why This Matters

- Feature-tree confirmation is more reliable than broad `*.ts` / `*.rs` globs for early story scoping.
- The task should carry a durable feature anchor once refinement has confirmed it.
- The canonical YAML should expose that feature anchor to downstream specialists instead of forcing them to reconstruct it later.

## Relevant Files

- `src/core/kanban/context-preload.ts`
- `src/core/harness/task-adaptive-tool.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `src/core/tools/agent-tools.ts`
- `resources/specialists/workflows/kanban/prompts/templates.json`
- `resources/specialists/workflows/kanban/backlog-refiner.yaml`

## Verification Targets

- `confirm_feature_tree_story_context` returns a normalized feature-tree selection for a query/feature hint
- backlog prompts instruct agents to prefer feature-tree confirmation before broad repo scanning
- confirmed feature context can be persisted to a task when refining an existing backlog card
- canonical YAML examples and prompts allow an optional `feature_tree` block without breaking downstream parsing

## Resolution Notes

- Added a dedicated MCP tool, `confirm_feature_tree_story_context`, that wraps feature-tree retrieval into a single prompt-ready result:
  - selected feature
  - normalized `contextSearchSpec`
  - optional `feature_tree` YAML block for canonical backlog stories
- Backlog prompts now explicitly tell the refiner to prefer feature-tree confirmation before broader `Grep`/`Glob` scanning, and only persist `contextSearchSpec` after confirmation or concrete repo inspection.
- Existing backlog confirmation gating now treats `confirm_feature_tree_story_context` as a confirmation step, so fresh backlog cards still avoid speculative context persistence.
- PR #529 merged on 2026-04-23 and closed GitHub issue #526.

## Verification Notes

- `npx vitest run src/core/mcp/__tests__/mcp-tool-executor.test.ts src/core/mcp/__tests__/routa-mcp-tool-manager.test.ts src/core/kanban/__tests__/backlog-context-confirmation.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-agent-input.test.ts' src/core/kanban/__tests__/agent-trigger.test.ts`
  - PASS (`41 passed`, `2 skipped`)
- `npx eslint ...` on changed files
  - PASS
- `npx tsc --noEmit`
  - PASS
- Live smoke on the existing backlog card `5f27533f-cc82-4c91-89b0-bb62427bd8db`
  - `contextSearchSpec` remains `null`
  - no speculative task-owned history context was persisted
