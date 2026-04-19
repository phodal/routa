# ADR 0008: Optional Auto-Merge Step in Done Lane

- Status: accepted
- Date: 2026-04-19
- Derived from: analysis report "看板阶段是否应增加自动合并代码并推送远端的阶段"

## Context

PR Publisher currently creates PRs/MRs in the Done lane but explicitly delegates the merge decision to humans (`pr-publisher.yaml:116-118` — "Do NOT auto-merge the PR. Merge is a human decision"). For high-trust teams with robust CI, this manual step adds friction without meaningful safety gains.

Three alternatives were evaluated:

| Option | Description | Verdict |
|--------|-------------|---------|
| **A** (chosen) | Add optional auto-merge step in Done lane | Minimal impact, backward-compatible |
| B | New independent `merge` KanbanColumnStage | Breaks TS/Rust/UI contracts across 18+ files |
| C | Keep status quo | Zero cost but no automation option |

## Decision

Add an **optional** auto-merge specialist step (`kanban-auto-merger`) in the Done lane, positioned between PR Publisher and Done Reporter. Activation is controlled by two new `KanbanDeliveryRules` fields:

- `autoMergeAfterPR?: boolean` — defaults to `false` (human merge)
- `mergeStrategy?: "merge_commit" | "squash" | "rebase"` — defaults to `"squash"`

### Specialist behavior

1. **Activation gate**: check `autoMergeAfterPR === true`; if not, skip immediately
2. **Pre-merge checks**: PR exists, CI green, no conflicts, branch protection satisfied
3. **Merge**: use platform CLI (`gh` / `glab`) with the configured strategy
4. **Failure handling**: log blocker to card comment, do NOT retry, do NOT block workflow

### Files changed

| File | Change |
|------|--------|
| `src/core/models/kanban.ts` | Add `KanbanMergeStrategy` type, extend `KanbanDeliveryRules` |
| `src/core/kanban/boards.ts` | Insert auto-merger step in Done lane, register specialist ID |
| `src/core/kanban/task-delivery-readiness.ts` | Include `autoMergeAfterPR` in `hasDeliveryRules` |
| `src/core/kanban/agent-trigger.ts` | Display auto-merge status in delivery rules formatting |
| `resources/specialists/workflows/kanban/auto-merger.yaml` | New specialist definition |
| `src/core/kanban/__tests__/boards.test.ts` | Updated assertions for new step |

## Consequences

- **Positive**: Teams can opt into automatic merging per board; default remains human merge
- **Positive**: No `KanbanColumnStage` type change — zero impact on Rust, UI, or happy-path logic
- **Risk**: Auto-merge may execute while CI is still running if the CI check polling interval is too coarse
- **Mitigation**: The specialist performs explicit CI status checks before attempting merge
