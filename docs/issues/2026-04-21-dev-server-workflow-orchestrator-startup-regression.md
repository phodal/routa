---
title: "Dev server logs a workflow orchestrator startup TypeError during app bootstrap"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["runtime", "workflow-orchestrator", "scheduler", "validation", "feature-explorer"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md"
---

# Dev server logs a workflow orchestrator startup TypeError during app bootstrap

## What Happened

During local browser validation of `Feature Explorer` on the Next.js dev server, the app booted and served pages successfully, but the server log emitted a startup exception:

`TypeError: startWorkflowOrchestrator is not a function`

The error was thrown from:

- `src/core/routa-system.ts:357`
- when requiring `./kanban/workflow-orchestrator-singleton`
- while the scheduler was starting background services

The relevant stack from local validation:

1. `getRoutaSystem`
2. `src/core/scheduling/scheduler-service.ts`
3. `runWithSpan`
4. `startWorkflowOrchestrator(system)`

## Expected Behavior

Starting `npm run dev` should initialize the scheduler and Kanban workflow orchestrator without runtime exceptions.

Background services should either:

- start normally, or
- fail behind an explicit feature flag / compatibility guard

but they should not throw a bootstrap `TypeError`.

## Reproduction

1. Run `npm run dev` in `/Users/phodal/ai/routa-js`
2. Open `http://localhost:3000/workspace/default/feature-explorer`
3. Observe server logs during app bootstrap

Observed result:

- app pages render
- `Feature Explorer` works
- scheduler logs a `TypeError` for `startWorkflowOrchestrator`

## Why This Matters

- It indicates the dev runtime is booting with a broken orchestrator export or import contract.
- It can mask real regressions in validation runs because the page still renders.
- It risks leaving background automation partially initialized while appearing healthy.

## Initial Evidence

- Validation still succeeded for the new friction-profile flow:
  - `GET /api/feature-explorer/friction-profiles?...` returned `200`
  - `POST /api/feature-explorer/friction-profiles?...` returned `200`
- The failure appears orthogonal to the new `Task-Adaptive Harness` work and should be treated as a separate runtime issue.

## Relevant Files

- `src/core/routa-system.ts`
- `src/core/scheduling/scheduler-service.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/tools/kanban-tools.ts`

## Resolution

- 2026-04-21: fixed by normalizing `workflow-orchestrator-singleton` module interop in both `src/core/routa-system.ts` and `src/core/tools/kanban-tools.ts`
- the resolver now tolerates direct named exports as well as `default` / `module.exports` shapes during dev-runtime loading
- revalidated with:
  - `GET /api/feature-explorer/friction-profiles?workspaceId=default&repoPath=/Users/phodal/ai/routa-js` -> `200`
  - `POST /api/feature-explorer/friction-profiles?...` -> `200`
  - `entrix run --tier fast` -> `PASS`
