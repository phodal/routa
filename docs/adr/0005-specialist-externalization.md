# ADR 0005: Specialist Externalization

- Status: accepted
- Date: 2026-02-16
- Derived from: [issue #1](https://github.com/phodal/routa/issues/1)

## Context

Specialists define agent roles (ROUTA, CRAFTER, GATE, DEVELOPER, etc.) with behavior instructions, model tier preferences, and role reminders. Initially these were hardcoded in TypeScript.

Hardcoded specialists prevented:
- user customization without code changes
- workspace-specific role configuration
- version-controlled specialist evolution independent of releases

## Decision

Specialists are externalized as Markdown files with YAML frontmatter. Loading follows a priority chain:

1. **Database user specialists** (highest priority) — per-workspace overrides
2. **User filesystem** (`~/.routa/specialists/*.md`) — user-level defaults
3. **Bundled resources** (`resources/specialists/*.md`) — shipped with the app
4. **Hardcoded fallbacks** — last resort

Each specialist file contains:
```yaml
---
name: developer
description: Implements code changes
modelTier: standard
role: developer
roleReminder: Focus on clean, tested implementation
---
# Behavior instructions in Markdown body
```

## Consequences

- New specialist roles are added by creating a `.md` file in `resources/specialists/`, not by editing TypeScript.
- Users can override any bundled specialist by creating a same-named file in their workspace settings or `~/.routa/specialists/`.
- The priority chain means agent behavior is deterministic: DB wins over filesystem wins over bundled.
- Both TypeScript (`src/core/specialists/`) and Rust (`crates/routa-core/src/store/`) implement the loading chain.
- Specialist definitions are workspace-scoped when loaded from DB.

## Code References

- `resources/specialists/*.md` — bundled specialist definitions
- `src/core/specialists/specialist-db-loader.ts` — priority loading logic
- `src/core/models/specialist.ts` — specialist model with YAML frontmatter
- `crates/routa-core/src/store/specialist*.rs` — Rust specialist store
