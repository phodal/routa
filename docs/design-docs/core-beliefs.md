---
title: Core Beliefs
---

# Core Beliefs

These are the operating beliefs behind Routa's repository-as-system-of-record direction.

## 1. The Repository Holds the Working Knowledge

If an agent cannot discover a decision from the repository at run time, that knowledge is operationally missing.

Practical consequence:
- durable product, architecture, and quality knowledge belongs in `docs/`
- chat history, oral tradition, and private notes are not treated as canonical

## 2. `AGENTS.md` Is a Routing Layer

`AGENTS.md` should stay compact. It should tell agents where to look, what rules they must follow, and which verification loop applies.

Practical consequence:
- keep detailed explanations out of `AGENTS.md`
- add pointers to the correct `docs/` location instead of expanding local instructions indefinitely

## 3. One Canonical Home Per Kind of Knowledge

Every long-lived fact should have one obvious home.

Practical consequence:
- product surface lives in `docs/product-specs/`
- architecture lives in `docs/ARCHITECTURE.md`
- design intent lives in `docs/design-docs/`
- work-in-progress plans live in `docs/exec-plans/`
- failures and regressions live in `docs/issues/`

## 4. Optimize For Agent Readability First

Documents should be easy for agents to scan, quote, and act on.

Practical consequence:
- prefer explicit headings, short sections, and stable filenames
- avoid burying key rules inside long narrative documents
- use direct filenames and paths when referencing source material

## 5. Prefer Durable Rules Over Prompt Folklore

If a behavior matters repeatedly, encode it in repository structure, checks, or documented invariants.

Practical consequence:
- move repeated expectations into linters, tests, fitness functions, or golden rules when possible
- do not rely only on agent memory or issue comments for critical constraints

## 6. Migrate By Normalizing, Not By Copying

Historical design docs are useful input, not automatically canonical output.

Practical consequence:
- `.kiro/specs/` can remain as provenance while content is reviewed
- migrate summary, invariants, and decisions first
- avoid creating duplicate documents that drift apart

## 7. Feedback Must Enter The Record

Bugs, regressions, and quality failures should produce repository artifacts that later agents can use.

Practical consequence:
- capture incidents in `docs/issues/`
- link issue records, plans, tests, and implementation work together
- treat postmortem evidence as a first-class part of delivery
