---
title: "Kanban should surface Task-Adaptive Harness in backlog refinement and card detail"
date: "2026-04-21"
kind: issue
status: closed
severity: medium
area: kanban
tags:
  - kanban
  - harness
  - backlog-refinement
  - card-detail
  - task-adaptive-harness
  - sessions
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
github_issue: 516
github_state: closed
github_url: "https://github.com/phodal/routa/issues/516"
---

# Kanban should surface Task-Adaptive Harness in backlog refinement and card detail

## What Happened

`Task-Adaptive Harness` now exists as an execution capability:

- ACP session creation can accept `taskAdaptiveHarness`
- Kanban prompt entry and move-blocked remediation already pass a task-adaptive context request
- MCP now exposes `assemble_task_adaptive_harness`

But the capability is still not productized in the two Kanban surfaces where users most need to see and trust it:

- backlog refinement, where a planner/refiner should load relevant prior task/session context before rewriting or decomposing a story
- card detail, where the operator should be able to see which history sessions and friction signals were selected, instead of receiving silent context injection

As a result, the feature currently behaves like hidden infrastructure rather than a visible Kanban workflow affordance.

## Expected Behavior

Kanban should treat `Task-Adaptive Harness` as a first-class refinement and inspection primitive.

Specifically:

- backlog refinement sessions should request task-adaptive hydration by default, especially for backlog-refiner / planning-oriented automation
- card detail should expose a compact harness summary, including matched history sessions, recovered files, and high-priority friction signals such as failed reads or repeated reads
- users should be able to understand why a planning/refinement session started with a specific historical context slice
- the detail surface should make it obvious whether the harness found strong matches, weak matches, or no relevant history

## Reproduction Context

- Environment: both
- Trigger:
  1. open Kanban and start or automate backlog/planning work
  2. observe that manual planning prompts and move-blocked remediation use `taskAdaptiveHarness`
  3. inspect backlog refinement and card detail flows
  4. note that the backlog refinement automation path is not yet clearly wired to the harness, and card detail does not show the compiled harness pack or confidence

## Why This Might Happen

- the current implementation prioritized session-start plumbing over Kanban UX surfacing
- backlog refinement has multiple entry paths, including automation and recovery, and not all of them currently pass task-adaptive inputs
- the compiled harness pack is injected into session startup but not yet stored or projected into a visible card-detail read model
- the current card detail panels focus on readiness, execution, evidence, and runs; they do not yet include a harness/context section

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/core/harness/task-adaptive.ts`
- `src/core/harness/task-adaptive-tool.ts`
- `src/app/api/acp/acp-session-create.ts`

## Observations

- the current Kanban prompt path already passes `taskAdaptiveHarness` from `kanban-tab.tsx`
- move-blocked remediation also passes task-adaptive inputs, which confirms the harness is relevant to planning-style repair flows
- automation and recovery paths still create sessions outside that explicit Kanban prompt path
- card detail already has tabs for readiness, execution, changes, evidence, and runs, so a harness/context panel can fit the existing information architecture without inventing a brand-new surface
- 2026-04-21 browser validation against `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839` confirms the `JIT CONTEXT` tab is rendered in card detail for task `8370421b-46fd-4cd3-bd98-89390b7c2006`
- the same validation also shows a card-detail interaction bug: clicking `JIT CONTEXT` repeatedly leaves the content pane on the `Overview` body instead of switching to the JIT panel
- this means the current empty-user-perception risk is not only retrieval quality; there is also a tab-switching/UI state problem in card detail that can hide working JIT data entirely
- 2026-04-21 follow-up validation against `http://localhost:3001` no longer reproduces the `JIT CONTEXT` tab-switching bug when driven through Playwright against real DOM roles/selectors
- 2026-04-21 end-to-end test now exists for this surface: create a Kanban card against the local `/Users/phodal/ai/routa-js` repo, open card detail, switch to `JIT Context`, and verify the matched feature/files render
- 2026-04-21 the remaining gap is no longer the card-detail UI shell; it is retrieval quality for weak or repo-root-only requests, which is tracked separately in issue `#517`
- 2026-04-22 backlog sessions no longer have to start from a blank planning prompt:
  - `session/new` now preloads `Relevant History Memory` from saved task memories in the same workspace/repo
  - `session/new` also preloads `Relevant Feature Tree Context` from the repo's feature surface index
  - backlog Kanban sessions now allow limited native read-only inspection via `Read`, `Grep`, and `Glob`
  - backlog/task prompts now explicitly instruct agents to consume history memory first, then write confirmed `featureCandidates` / `relatedFiles` back through `contextSearchSpec`
- 2026-04-22 task execution prompts now include `Saved History Memory` from the current card, so Todo/Dev/Review sessions can reuse prior summaries, top files, top sessions, and reusable prompts without opening card detail first
- 2026-04-22 MCP now also exposes `load_feature_tree_context`, so backlog/task specialists can drill into feature tree context on demand instead of relying only on preloaded prompt sections
- 2026-04-22 live validation on `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839` confirms the upgraded backlog planner is consuming the new preload path in behavior, not just configuration:
  - starting a new planning session with the story input `为 Kanban 增加 flow event 的查询与趋势摘要能力，优先复用现有事件持久化和读取契约`
  - produced ACP session `2f1f35f2-d7fe-48e5-8e1b-2d2581f52918`
  - created card `4d69f47a-371b-4191-81a0-7c89c06a028e`
  - persisted `contextSearchSpec.featureCandidates=["kanban-workflow"]`
  - persisted `contextSearchSpec.relatedFiles` with `crates/routa-server/src/api/kanban.rs`, `src/app/api/kanban/events/route.ts`, `src/app/api/kanban/boards/[boardId]/route.ts`, `src/app/api/kanban/boards/route.ts`, and `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
  - persisted `moduleHints` / `symptomHints` that explicitly preserve the `reuse existing event persistence / read contract` constraint
- 2026-04-22 a deeper Playwright DOM probe disproved the earlier tab regression report:
  - for task `8370421b-46fd-4cd3-bd98-89390b7c2006`, clicking `HISTORY MEMORY` changes `aria-selected` from `overview=true` / `jitContext=false` to `overview=false` / `jitContext=true`
  - the rendered panel text includes `SAVED HISTORY MEMORY`, saved summary content, top files, top sessions, reusable prompts, and the recovered history/process sections
  - the earlier `agent-browser` reading was a false negative caused by that tool's interaction/snapshot path, not a product bug in the card-detail tabs

## Resolution

- 2026-04-22: closed after live validation confirmed that both halves of this follow-up are now productized:
  - backlog refinement/planning sessions preload relevant history memory and feature tree context, and write the resulting high-signal hints back into `contextSearchSpec`
  - card detail exposes the saved `History Memory` result together with the process/retrieval view, including confidence, matched files, recovered sessions, warnings, failures, and reusable prompts
- Verified in the live app on `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839`:
  - creating a new backlog story persisted `featureCandidates` / `relatedFiles` / `moduleHints` / `symptomHints`
  - opening the existing flow-event card and switching to `HISTORY MEMORY` displayed the saved history memory and the recovered task-adaptive context

## References

- Local related issue: `docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- GitHub umbrella issue: `https://github.com/phodal/routa/issues/515`
