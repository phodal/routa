# Architecture Rule DSL

## Purpose

Routa now has a working TypeScript architecture fitness surface, but the rule set is still embedded inside `scripts/fitness/check-backend-architecture.ts`. That keeps the first ArchUnitTS integration moving, but it blocks three follow-up goals:

- reusing the same rule intent across TypeScript and Rust backends
- generating or editing rules with LLMs without touching executable code
- feeding a stable, structured rule model into fitness, UI, and future graph-based executors

This document defines a small, engine-neutral Architecture Rule DSL for those goals.

## Goals

- Keep one machine-readable rule model that TypeScript and Rust can both parse.
- Preserve the current ArchUnitTS boundary and cycle rules without changing their user-visible meaning.
- Separate rule intent from executor code.
- Make the DSL simple enough for LLM generation and review.
- Leave room for future executors such as Rust graph analysis, dep-tree adapters, or repository-wide topology checks.

## Non-Goals

- This is not a full architecture language in the first iteration.
- This does not yet execute Rust dependency rules against crate graphs.
- This does not replace `dependency-cruiser`, `entrix`, or the current architecture API response shape.
- This does not move UI i18n into the executor. The DSL carries stable ids and optional display metadata only.

## Design Principles

- One file should describe one coherent rule model.
- Selectors should be reusable across rules.
- Rule semantics should not depend on one executor implementation.
- Unsupported rules must fail validation explicitly instead of being silently ignored.
- LLMs should be able to emit valid files with low prompt complexity.

## File Format

The canonical format is YAML.

Recommended file extension:

- `*.archdsl.yaml`

Schema id:

- `routa.archdsl/v1`

Recommended location:

- `architecture/rules/`

## Core Model

Each DSL file contains:

1. `schema`
2. `model`
3. `defaults`
4. `selectors`
5. `rules`

### `model`

`model` identifies the rule pack as a durable unit.

Fields:

- `id`: stable machine id
- `title`: human-readable label
- `description`: short scope summary
- `owners`: optional logical owners such as `fitness`, `backend`, or `platform`

### `defaults`

Shared filesystem defaults.

Fields:

- `root`: optional root, default `.`
- `exclude`: optional ignore globs

### `selectors`

Selectors name reusable file scopes.

Current selector kind:

- `files`

Current selector fields:

- `kind`
- `language`: `typescript`, `rust`, or future values
- `include`: glob list
- `exclude`: optional glob list
- `description`: optional short intent note

Example:

```yaml
selectors:
  core_ts:
    kind: files
    language: typescript
    include:
      - src/core/**
```

### `rules`

Rules describe engine-neutral intent.

Shared rule fields:

- `id`: stable machine id
- `title`: readable label for CLI/debug output
- `message_key`: optional future i18n lookup key
- `kind`: current values `dependency` or `cycle`
- `suite`: current values `boundaries` or `cycles`
- `severity`: current value `advisory`, future values may add `warning` or `error`
- `engine_hints`: optional executor hints such as `archunitts`

#### Dependency Rule

Fields:

- `from`: selector id
- `relation`: currently `must_not_depend_on`
- `to`: selector id

Example:

```yaml
- id: ts_backend_core_no_core_to_client
  title: src/core must not depend on src/client
  kind: dependency
  suite: boundaries
  severity: advisory
  from: core_ts
  relation: must_not_depend_on
  to: client_ts
  engine_hints:
    - archunitts
```

#### Cycle Rule

Fields:

- `scope`: selector id
- `relation`: currently `must_be_acyclic`

Example:

```yaml
- id: ts_backend_core_no_cycles
  title: src/core should be cycle free
  kind: cycle
  suite: cycles
  severity: advisory
  scope: core_ts
  relation: must_be_acyclic
  engine_hints:
    - archunitts
```

## Why YAML

YAML is the recommended canonical syntax because it is already a common configuration format in the repository and is supported well on both implementation paths:

- TypeScript: `js-yaml` for parsing and `zod` for validation
- Rust: `serde_yaml` with typed enums/structs

That keeps the DSL inspectable by humans, easy for LLMs to emit, and stable for future toolchains.

## TypeScript Implementation Strategy

Recommended approach:

1. Parse YAML with `js-yaml`.
2. Validate the raw document with `zod`.
3. Compile the normalized model into the current ArchUnitTS `ArchitectureRuleDefinition[]`.
4. Keep the current JSON report shape so existing API/UI consumers remain stable.

Why this approach:

- It reuses the existing `scripts/fitness/check-backend-architecture.ts` execution path.
- It keeps the POC close to the current working behavior.
- It makes rule execution a pure compilation step from DSL to ArchUnitTS builders.

Current POC scope:

- `files` selectors
- `dependency` + `must_not_depend_on`
- `cycle` + `must_be_acyclic`
- `boundaries` and `cycles` suites

## Rust Implementation Strategy

Recommended approach:

1. Add a new `routa-cli fitness arch-dsl-poc` command.
2. Parse YAML into typed structs with `serde` + `serde_yaml`.
3. Run semantic validation:
   - schema id is supported
   - selector ids are unique
   - rules reference existing selectors
   - `kind`, `relation`, and selector language combinations are supported
4. Emit a normalized execution plan as text or JSON.

Why this approach:

- It proves the DSL is not coupled to the TypeScript runtime.
- It gives Routa a second parser and validator immediately.
- It creates a clean handoff point for future Rust-backed architecture executors.

POC boundary:

- Rust validates and normalizes the DSL.
- Rust does not yet execute dependency graph analysis.

## Normalized Semantic Contract

Both implementations should converge on the same semantic assumptions:

- selector ids are globally unique within one file
- rule ids are globally unique within one file
- every rule references existing selectors
- `dependency` rules require `from` and `to`
- `cycle` rules require `scope`
- TypeScript ArchUnitTS compilation currently only supports `language: typescript`
- unsupported combinations must produce explicit validation errors

## LLM-Friendly Case Format

The LLM authoring format should be Markdown with YAML frontmatter and predictable sections.

Recommended directory:

- `architecture/rules/cases/`

Recommended file extension:

- `*.archdsl.md`

Required frontmatter:

- `schema`
- `case_id`
- `target_dsl`
- `output_format`
- `temperature_hint`

Recommended sections:

1. `# Goal`
2. `## Context`
3. `## Selector Catalog`
4. `## Required Rules`
5. `## Constraints`
6. `## Output Contract`

Why this format:

- frontmatter carries stable routing metadata
- headings give LLMs consistent anchors
- the file stays diff-friendly and reviewable
- the output contract can insist on YAML-only emission

## Validation Workflow

1. Author or update the Markdown case.
2. Ask an LLM to emit YAML only for the target DSL.
3. Validate the emitted YAML with the TypeScript compiler path.
4. Validate the same YAML with the Rust parser path.
5. Promote successful output into `architecture/rules/*.archdsl.yaml`.

This makes the Markdown case an input contract for generation, not the source of truth for execution.

## POC Layout

The initial POC uses these files:

- `architecture/rules/backend-core.archdsl.yaml`
- `architecture/rules/cases/backend-core.archdsl.md`
- `scripts/fitness/architecture-rule-dsl.ts`
- `scripts/fitness/check-backend-architecture.ts`
- `crates/routa-cli/src/commands/fitness/arch_dsl_poc.rs`

## Future Extensions

Expected next rule families after the first POC:

- layered rules
- slice isolation rules
- crate or package dependency rules
- forbidden symbol/provider leak rules
- graph-backed selectors and quantums integration

The `v1` schema is intentionally small so those extensions can be added without retrofitting the first four backend-core rules.
