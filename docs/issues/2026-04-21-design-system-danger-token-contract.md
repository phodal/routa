---
title: "Design system danger token contract is missing between brand palette and shared components"
date: "2026-04-21"
kind: issue
status: open
severity: medium
area: "design-system"
tags:
  - design-system
  - tokens
  - button
  - desktop
  - ui
reported_by: "codex"
related_issues:
  - "2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md"
  - "2026-03-17-design-system-quality-gates.md"
github_issue: 514
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/514"
---

# Design system danger token contract is missing between brand palette and shared components

## What Happened

- The repo already defines a red brand palette in `src/app/globals.css` (`--brand-red-*` and `--brand-red`), and desktop theme wiring already exposes `--dt-brand-red`.
- However, shared UI components still commonly consume raw Tailwind `red-*` / `rose-*` palette classes instead of a semantic danger token contract.
- This makes the design system look incomplete from the usage side: the palette exists, but destructive/error UI does not consistently enter through one reusable token surface.
- The shared `Button` component is a concrete example: its `danger` variant currently hardcodes Tailwind red classes instead of consuming design-system variables.

## Expected Behavior

- Destructive and error UI should have a first-class semantic token contract, not just a raw brand-red palette.
- Shared components should consume that contract first, so downstream UI can inherit danger behavior without re-deciding raw red/rose values.
- Desktop theme and Storybook token documentation should expose the same contract clearly enough that future work can converge on it.

## Reproduction Context

- Environment: both web + desktop
- Trigger:
  - Inspect `src/app/globals.css` and observe that `--brand-red-*` already exists
  - Inspect shared components such as `src/client/components/button.tsx`
  - Observe that destructive/error states still use direct `bg-red-*` / `text-red-*` / `border-rose-*` utilities instead of semantic token variables

## Why This Might Happen

- Earlier design-system work established brand palettes and desktop shell tokens first, but did not finish a semantic danger layer for shared content components.
- Existing linting focuses on shell components and advisory scanning; it does not yet force every shared component onto semantic danger aliases.
- Red/rose utility classes are easy to reach for during feature work, so usage drift accumulates even when the palette is already present.

## Relevant Files

- `src/app/globals.css`
- `src/app/styles/desktop-theme.css`
- `src/client/components/button.tsx`
- `src/client/components/button.stories.tsx`
- `src/client/components/desktop-color-tokens.stories.tsx`
- `scripts/lint-design-system-css.mjs`
- `docs/fitness/design-system-quality-layers.md`

## Observations

- The current question is not whether the repo has any red values; it does.
- The actual gap is that `brand-red` is a palette token, while shared components still lack a stable semantic entrypoint such as `danger-solid`, `danger-border`, `danger-fg`, and related aliases.
- This issue should be addressed incrementally:
  - first by establishing the semantic contract,
  - then by migrating shared primitives,
  - and only after that by tightening stricter lint coverage.
- 2026-04-21 phase 1 work added semantic `--danger-*` aliases, mapped them into the desktop theme contract, and migrated the shared `Button` danger variant onto the new token surface.
- 2026-04-21 phase 2 work added a shared `src/client/components/color-system.ts` helper and migrated repeated danger surfaces / destructive affordances in `settings-panel-mcp-tab`, `repo-picker`, `schedule-panel`, and `github-webhook-panel` onto the semantic token contract.

## References

- `src/app/globals.css`
- `src/app/styles/desktop-theme.css`
- `docs/fitness/design-system-quality-layers.md`
