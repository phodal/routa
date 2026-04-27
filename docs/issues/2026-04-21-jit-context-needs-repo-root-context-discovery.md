---
title: "JIT Context stays empty for repo-root-only requests even when history sessions exist"
date: "2026-04-21"
kind: issue
status: closed
severity: medium
area: "kanban"
tags: ["jit-context", "task-adaptive-harness", "feature-explorer", "history-session", "kanban"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
github_issue: 517
github_state: closed
github_url: "https://github.com/phodal/routa/issues/517"
---

# JIT Context stays empty for repo-root-only requests even when history sessions exist

## What Happened

`JIT Context` can render as empty even in `/Users/phodal/ai/routa-js`, where local Codex history clearly contains matching transcripts and recoverable context.

Real probes against the current repository showed:

- `~/.codex/sessions` currently contains `1767` transcript files.
- `collectMatchingTranscriptSessions("/Users/phodal/ai/routa-js")` returns `200` matched transcripts for this repo.
- `assembleTaskAdaptiveHarness("/Users/phodal/ai/routa-js", { taskLabel: "Repo-root only", taskType: "analysis" })` returns:
  - `selectedFiles: []`
  - `matchedSessionIds: []`
  - warning: `No task-adaptive files could be resolved from the current request.`

At the same time, probing a concrete Kanban file shows that the data is present:

- `assembleTaskAdaptiveHarness(..., { filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"] })` returns:
  - `5` matched sessions
  - high-signal failure messages such as missing file/path reads
  - repeated read hotspot for `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `Feature Explorer` maps that same file to:
  - page route: `/workspace/:workspaceId/kanban`
  - feature: `kanban-workflow`
  - file stats: `changes=5`, `sessions=5`, `updatedAt=2026-04-21T09:15:36`

This means the empty state is not caused by a lack of history. It is caused by the current request shape not being strong enough to resolve candidate files/features.

## Expected Behavior

When `JIT Context` receives only repo/workspace context, it should still recover useful history-session context by deriving one or more of:

- candidate files from the current card/task surface
- candidate features from `Feature Explorer`
- recent/high-signal history sessions for the current repo

The empty state should be reserved for truly history-free cards, not for repo-root-only requests with abundant local transcript evidence.

## Reproduction Context

- Environment: web
- Trigger: open Kanban card detail and request `JIT Context` for a card that does not pass strong `filePaths`, `featureId`, or `historySessionIds`

Local diagnostic commands run against `/Users/phodal/ai/routa-js`:

1. Count local transcript files under `~/.codex/sessions`
2. Call `collectMatchingTranscriptSessions(repoRoot)`
3. Call `assembleTaskAdaptiveHarness(repoRoot, { taskLabel, taskType })`
4. Call `assembleTaskAdaptiveHarness(repoRoot, { filePaths: [...] })`
5. Call `Feature Explorer` helpers to map the same file to feature/page/session stats

## Why This Might Happen

- `Task-Adaptive Harness` currently requires one of `filePaths`, `featureId`, or `historySessionIds` to recover `selectedFiles`; repo-root-only requests do not infer a starting surface.
- `JIT Context` is wired to `task-adaptive` retrieval, but not yet to `Feature Explorer` feature/page/file attribution as a fallback discovery step.
- The current empty-state logic treats “no selected files resolved” as “no context”, even when `collectMatchingTranscriptSessions(repoRoot)` already proves repo-scoped history exists.
- Current UI/task wiring may not always pass the strongest possible history inputs from the card, especially for cards with weak or incomplete lane/session metadata.

## Refined Direction

Use a task-level `contextSearchSpec` as the first-pass retrieval contract for `JIT Context`.

Instead of waiting for later implementation traces to recover files, backlog refinement should write structured retrieval hints directly onto the card/task, for example:

- `query`
- `featureCandidates`
- `relatedFiles`
- `routeCandidates`
- `apiCandidates`
- `moduleHints`
- `symptomHints`

That gives `Task-Adaptive Harness` a just-in-time seed even before the first implementation session has produced transcript evidence.

## Planned Wiring

1. `backlog refiner` should emit `contextSearchSpec` while creating or refining cards
2. task persistence should store `contextSearchSpec` across web/desktop backends
3. `buildKanbanTaskAdaptiveHarnessOptions()` should forward:
   - `relatedFiles -> filePaths`
   - `featureCandidates -> featureIds`
4. `Task-Adaptive Harness` should merge `featureIds + filePaths + historySessionIds`
5. `JIT Context` should consume those hints on first open, then later refine using real session traces

## Progress Notes

- 2026-04-21: validated that repo-root-only requests stay empty while file-scoped requests immediately recover sessions and friction signals
- 2026-04-21: confirmed `Feature Explorer` can already map files to `feature/page/session` evidence and should be treated as the structural fallback
- 2026-04-21: implementation started for task-level `contextSearchSpec` persistence and Kanban/tooling propagation
- 2026-04-21: `Task-Adaptive Harness` now seeds file/feature inference from `query`, `routeCandidates`, `apiCandidates`, `moduleHints`, and `symptomHints` via the feature surface index
- 2026-04-21: Kanban task-adaptive wiring now falls back to the card title as an implicit query when older cards do not yet have an explicit `contextSearchSpec.query`
- 2026-04-21: re-validated against `http://localhost:3001/api/harness/task-adaptive` that repo-root-only requests are still empty, even after the hint-backed retrieval work shipped
- 2026-04-21: confirmed the contrast case: when `featureIds/routeCandidates/moduleHints` are present, the same repository returns high-confidence matches, recovered files, reusable friction profiles, and relevant history sessions
- 2026-04-21: verified that the current Kanban/JIT product path is usable for hint-backed cards, but the original repo-root-only fallback gap remains unresolved and keeps this issue open
- 2026-04-21: added `historySummary` to `Task-Adaptive Harness` so linked history session seeds are compressed into an overview plus top seed sessions, instead of only exposing final recovered sessions
- 2026-04-21: added MCP tool `summarize_task_history_context` and new read-only specialist `history-summary-analyst` so future analysis can start from compressed seed evidence rather than rereading all linked transcripts
- 2026-04-21: `JIT Context` now exposes `Open History Analysis`, which starts a dedicated `history-summary-analyst` session from the card detail instead of forcing users to inject raw linked sessions into the current implementation session
- 2026-04-21: `Open History Analysis` was adjusted again to launch a separate session page instead of hijacking the current Kanban session pane, so history analysis no longer interferes with the active execution chat
- 2026-04-21: repo-root-only fallback is no longer empty. Re-validating `assembleTaskAdaptiveHarness("/Users/phodal/ai/routa-js", { taskLabel: "为 Kanban 建立可持久化的流动事件模型", taskType: "implementation", locale: "zh-CN" })` now returns `featureId=kanban-workflow`, `selectedFiles=17`, `matchedSessionIds=6`, and no longer emits `No task-adaptive files could be resolved from the current request.`
- 2026-04-21: the issue is now primarily a verification problem rather than a missing retrieval primitive; the next pass should dogfood multiple hotspot features and compare `JIT Context` / `History Analysis` quality across strong vs weak hints.
- 2026-04-21: hotspot validation exposed a ranking bug in `Task-Adaptive Harness`: explicit `featureIds` were merged with inferred feature candidates via `uniqueSorted(...)`, which reordered `["feature-explorer", "a2a"]` into `["a2a", "feature-explorer"]` and let unrelated fallback features become the primary feature.
- 2026-04-21: file ranking also drifted because `inferredSeed.filePaths` was merged ahead of explicit feature files, so even when `featureId` was corrected, `selectedFiles` still started with unrelated fallback files.
- 2026-04-21: after preserving explicit feature order and prioritizing explicit feature files, re-validating hotspot cases against `/Users/phodal/ai/routa-js` returned the expected primary features for `feature-explorer`, `tasks`, `mcp`, and `spec`.
- 2026-04-21: post-fix API validation snapshot:
  - `feature-explorer -> featureId=feature-explorer, selectedFiles=16, matchedSessions=6`
  - `tasks -> featureId=tasks, selectedFiles=8, matchedSessions=6`
  - `mcp -> featureId=mcp, selectedFiles=16, matchedSessions=6`
  - `spec -> featureId=spec, selectedFiles=8, matchedSessions=6`

## Verification Shortlist

Use `Feature Explorer` friction profiles as the first-pass validation queue instead of picking arbitrary cards.

Top hotspot features in the current local snapshot `.routa/feature-explorer/friction-profiles.json`:

1. `kanban-workflow`
   - `matchedSessions=6`, `selectedFiles=8`, `failures=8`, `repeatedReads=5`
   - Best primary validation target because it is the exact product surface for `JIT Context` and `History Analysis`
   - Representative recovered sessions:
     - `019daf46-1a5b-7001-8a17-df4a7053ace0`
     - `019da9f5-4a31-7bf0-9ac0-f836f2307537`
     - `019daf30-4f25-78f2-bb4f-1dabbd464cc5`

2. `tasks`
   - `matchedSessions=6`, `selectedFiles=8`, `failures=8`, `repeatedReads=5`
   - Good secondary validation target because it overlaps with the same Rust/TS backend surfaces as Kanban but exercises task APIs rather than board UI

3. `feature-explorer`
   - `matchedSessions=6`, `selectedFiles=7`, `failures=6`, `repeatedReads=4`
   - Best cross-check target for evaluating whether `History Analysis` prompt structure now approaches the quality of the existing file/session analysis flow
   - Representative recovered sessions:
     - `019daf79-02ec-71a2-832d-8e87b62e060a`
     - `019da5f2-e28c-7361-8978-11dfde7f2c4f`
     - `019da900-d2f6-7f03-a752-15a4feae8ec3`

4. `spec`
   - `matchedSessions=6`, `selectedFiles=4`, `failures=2`, `repeatedReads=4`
   - Useful lower-noise target to see whether the same retrieval pipeline behaves better on a smaller, more structured surface

5. `mcp`
   - `matchedSessions=4`, `selectedFiles=8`, `failures=8`, `repeatedReads=6`
   - Useful stress case because it has dense backend hotspots and many path-resolution failures

Cross-feature sessions that are high-volume but noisier:

- `019dad6c-1d0f-7781-81ad-1cdbceac12e2`
  - appears in `7` feature profiles (`kanban-workflow`, `acp`, `codebases`, `health`, `mcp`, `traces`, `workspaces`)
  - likely useful as weak/noisy evidence, but not ideal as the first verification target because it spans too many surfaces

- `019daf46-1a5b-7001-8a17-df4a7053ace0`
  - appears in `3` focused feature profiles (`kanban-workflow`, `mcp`, `tasks`)
  - better candidate for hotspot validation because it is still shared, but much more anchored to the current Kanban/task backend cluster

Recommended verification order:

1. `kanban-workflow`
2. `feature-explorer`
3. `tasks`
4. `mcp`
5. `spec`

## Relevant Files

- `src/core/harness/task-adaptive.ts`
- `src/core/harness/transcript-sessions.ts`
- `src/app/api/feature-explorer/shared.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-task-adaptive.ts`
- `src/core/kanban/task-adaptive.ts`

## Observations

- For `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`, recovered sessions include current JIT/Task-Adaptive Harness work from `2026-04-21`.
- Recovered failure signals are useful product data, not just debug noise. Examples include:
  - wrong path reads
  - shell glob failures around `[]` paths
  - repeated attempts to read the same file
- `Feature Explorer` already exposes context categories that `JIT Context` does not yet surface:
  - feature links
  - page links
  - file stats
  - file signals with prompt/tool/diagnostics summaries
  - top features by session count

## References

- `docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- `docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md`

## Resolution

- 2026-04-22: closed after re-validating the live `POST /api/harness/task-adaptive` path with repo-root-only input.
- Validation request:
  - `workspaceId=default`
  - `repoPath=/Users/phodal/ai/routa-js/.routa/repos/phodal--routa`
  - `taskLabel=为 Kanban 建立可持久化的流动事件模型`
  - `taskType=implementation`
- Validation result:
  - `featureId=kanban-workflow`
  - `selectedFiles=16`
  - `matchedSessionIds=6`
  - no longer returns the old `No task-adaptive files could be resolved from the current request.` empty-state failure
- Remaining visible Kanban UX issues are tracked separately in `#516`; this repo-root fallback gap itself is no longer open.
