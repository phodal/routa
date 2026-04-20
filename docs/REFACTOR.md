# Refactor Playbook

This document defines refactor rules for large-file and hotspot cleanup in Routa.js.

## Core Rules

1. Start every refactor with `entrix` analysis, then decide scope from evidence instead of intuition.
2. Prioritize files that exceed budget first. In-budget files are secondary unless tied to an active bug or feature.
3. For oversized files, extract logic out of the source file instead of adding more branching inside it.
4. Use concept boundaries and workflow clustering for extraction; do not split by arbitrary line ranges.
5. Write tests for the target extracted module first, then move logic. No move before behavior is covered.
6. Prefer the highest-ROI, lowest-risk split first: extract only one or two high-coupling modules per pass before considering broader decomposition.

## Analysis-First Workflow

Run these before changing code:

```bash
entrix analyze long-file --json
entrix hook file-length --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
entrix hook file-length --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" --overrides-only
```

Triage order:

1. Files with budget violations.
2. Among violators, prefer larger over-budget deltas.
3. If still tied, prefer higher-change files from `entrix analyze long-file` history signals (for example `commitCount`).

## Test-First Extraction Rule

Before moving any block out of a long file:

1. Create or extend characterization tests that lock current behavior of the block being extracted.
2. Place tests around the new target module boundary, not only the old monolithic file.
3. Confirm tests fail when behavior changes and pass for the current behavior baseline.

Only after those checks pass, move logic into the new file.

## Concept Clustering Strategy

When choosing what to extract, group by concept and lifecycle:

- One workflow boundary at a time (for example bootstrap, navigation, session orchestration, streaming sync).
- Keep top-level route/page files as orchestration shells.
- Avoid creating generic `utils` buckets when the real complexity is a concrete branch or workflow.
- Prefer one cohesive extraction per commit over broad mixed rewrites.

## Move Sequence (Default)

1. Identify one over-budget file and one cluster to extract.
2. Add target-module tests first.
3. Create destination module with explicit interfaces.
4. Move one cohesive logic cluster.
5. Keep entry file behavior and API shape stable.
6. Remove dead code and re-run tests/lint/fitness checks.

## Done Criteria

A refactor is done only when all are true:

1. Extracted behavior is covered by tests at the new boundary.
2. No regression in existing behavior.
3. File budget pressure is reduced (or at minimum not worsened for legacy frozen hotspots).
4. The top-level file is simpler as an orchestration shell, not just redistributed complexity.
