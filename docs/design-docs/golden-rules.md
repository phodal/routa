---
title: Golden Rules
---

# Golden Rules

These rules define the minimum repository hygiene expected for agent-first development in Routa.js.

## Documentation Rules

1. Put durable knowledge in `docs/`, not in chat transcripts or oversized `AGENTS.md` prose.
2. Keep one canonical home for each type of knowledge.
3. Update indexes when creating a new durable documentation area.
4. Prefer short, stable documents over sprawling mixed-purpose notes.
5. When migrating older material, preserve provenance and avoid parallel copies.

## Architecture Rules

1. Treat `docs/ARCHITECTURE.md` as the top-level architecture contract unless a narrower canonical doc supersedes a subsection.
2. Preserve dual-backend semantic parity unless an intentional divergence is documented.
3. Favor explicit system boundaries and contracts over implicit behavior.
4. Encode recurring architectural constraints in code checks when possible.

## Delivery Rules

1. Break broad epics into implementation-sized plans before coding.
2. Record failures in `docs/issues/` before or alongside fixes when the issue is non-trivial.
3. Keep execution plans short-lived and move them to `completed/` when shipped.
4. Prefer baby-step changes that reduce drift rather than large speculative reorganizations.

## Agent Readability Rules

1. Use descriptive filenames and direct paths.
2. Use headings that describe intent, not vague themes.
3. Put actionable constraints near the top of the document.
4. Avoid mixing normative guidance, brainstorming, and historical notes in the same file unless sections are clearly separated.

## Enforcement Direction

Some rules are social today and should become mechanical over time.

Candidate follow-up checks:
- detect missing `docs/` index links for new durable doc areas
- detect stale references to moved canonical documents
- detect legacy `.kiro/specs/` copies that were duplicated into `docs/` without provenance
- score doc freshness and architecture coverage as part of fitness
