---
title: "Kanban columns are not first-class configurable and manual lanes lack a clear product boundary"
date: "2026-03-21"
status: resolved
resolved_at: "2026-03-22"
severity: high
area: "kanban"
tags: ["kanban", "columns", "ux", "automation", "workflow"]
reported_by: "OpenAI Codex"
github_issue: 219
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/219"
related_issues:
  - "2026-03-19-kanban-flow-observability-and-control-gaps.md"
  - "https://github.com/phodal/routa/issues/219"
---

# Kanban columns are not first-class configurable and manual lanes lack a clear product boundary

## What Happened

Reviewing the live Kanban board at `http://localhost:3000/workspace/default/kanban` shows that columns behave more like fixed presentation slots than configurable workflow objects.

Observed characteristics:

- board columns use a fixed width layout, so the board alternates between wide unused whitespace and mandatory horizontal scrolling depending on how many columns are visible
- the visible column controls expose only visibility and automation toggles, not broader column-level configuration
- the main board header for each column only surfaces name, card count, and a truncated automation summary
- the settings experience is centered on automation setup, which makes "configure column" feel almost identical to "configure agent automation"

This also exposes an important product-boundary problem: some columns, especially `blocked`, are intentionally manual lanes and should not be treated as incomplete automation lanes.

## Expected Behavior

Kanban columns should behave as first-class configurable workflow units.

That means the product should clearly distinguish between:

- structural column settings such as visibility, order, width or density, lane role, and presentation
- optional automation settings for columns that should trigger ACP behavior
- explicitly manual columns, including lanes like `blocked`, where non-automation is the intended behavior rather than a missing configuration

## Reproduction Context

- Environment: web
- Trigger: Open `http://localhost:3000/workspace/default/kanban`, inspect the visible board layout, then open the board `Settings` modal and review the left-side `Stages` map and right-side stage configuration workspace

## Why This Might Happen

- The current column model stores only a narrow set of properties (`id`, `name`, `color`, `position`, `stage`, optional `visible`, optional `automation`), so the UI has little room to represent richer column behavior.
- The current settings IA is optimized around lane automation, which makes structural column design feel secondary.
- The product model appears to conflate "column can have automation" with "column should be automation-aware", which weakens the distinction between normal execution lanes and intentionally manual lanes such as `blocked`.

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/core/models/kanban.ts`
- `src/app/workspace/[workspaceId]/types.ts`
- `crates/routa-core/src/models/kanban.rs`

## Observations

- Browser review was performed against the live local page at `http://localhost:3000/workspace/default/kanban`.
- The current board implementation fixes each column at `18rem` width and derives board minimum width from visible column count.
- The current settings modal treats stage configuration primarily as automation configuration.
- A column such as `blocked` needs to remain a valid, first-class column even when it is entirely non-automated.

## References

- Local browser screenshot captured during review: `/tmp/kanban-review-fresh.png`
- GitHub issue: `https://github.com/phodal/routa/issues/219`

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/core/models/kanban.ts` now models columns with structural properties
  including `visible` and `width`, in addition to automation.
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx` defines
  `MANUAL_ONLY_STAGES`, treats `blocked` as a manual-only lane, and separates
  workflow mode from automation state.
- The same settings modal now exposes column-level controls for stage, width,
  board visibility, and a manual-only badge for `blocked`, instead of treating
  the surface as automation-only configuration.
- `crates/routa-core/src/models/kanban.rs` carries matching structural fields
  for Rust-side board data, including `visible` and `width`.
