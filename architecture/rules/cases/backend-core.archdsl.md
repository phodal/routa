---
schema: routa.archdsl.case/v1
case_id: backend_core_architecture_rules
target_dsl: architecture/rules/backend-core.archdsl.yaml
output_format: yaml
temperature_hint: low
---

# Goal

Generate a YAML architecture rule model for Routa's TypeScript backend core.

The response is consumed by an automated validator. Treat this as a fresh synthesis task and ignore repository state.
- Do not mention whether a file already exists.
- Do not mention validation, context, or explanations.
- The first line of the response must be exactly `schema: routa.archdsl/v1`.

## Context

- `src/core/**` contains shared backend domain and orchestration logic.
- `src/app/**` contains the Next.js app surface.
- `src/app/api/**` contains API route handlers.
- `src/client/**` contains browser-only code.
- The target DSL must be reusable by both TypeScript and Rust implementations.

## Selector Catalog

- `core_ts`: `src/core/**`
- `app_ts`: `src/app/**`
- `api_ts`: `src/app/api/**`
- `client_ts`: `src/client/**`

## Required Rules

1. `src/core/**` must not depend on `src/app/**`.
2. `src/core/**` must not depend on `src/client/**`.
3. `src/app/api/**` must not depend on `src/client/**`.
4. `src/core/**` must be acyclic.

## Constraints

- Use schema `routa.archdsl/v1`.
- Emit a single YAML document only.
- Reuse selectors instead of repeating globs inline in every rule.
- Use stable rule ids beginning with `ts_backend_core_`.
- Use `kind: dependency` for dependency boundaries.
- Use `kind: cycle` for acyclic scope checks.
- Use `severity: advisory`.
- Include `message_key` fields for future UI localization.
- Use `engine_hints: [archunitts]` for the current execution target.

## Required Top-Level Shape

- Top-level keys must be exactly:
  - `schema`
  - `model`
  - `defaults`
  - `selectors`
  - `rules`
- `model` must contain:
  - `id`
  - `title`
  - `description`
  - `owners`
- `defaults` must contain:
  - `root`
  - `exclude`
- Every selector must contain:
  - `kind: files`
  - `language: typescript`
  - `description`
  - `include`
- Every dependency rule must contain:
  - `id`
  - `title`
  - `message_key`
  - `kind: dependency`
  - `suite: boundaries`
  - `severity: advisory`
  - `from`
  - `relation: must_not_depend_on`
  - `to`
  - `engine_hints`
- Every cycle rule must contain:
  - `id`
  - `title`
  - `message_key`
  - `kind: cycle`
  - `suite: cycles`
  - `severity: advisory`
  - `scope`
  - `relation: must_be_acyclic`
  - `engine_hints`

## Forbidden Output

- Do not use top-level keys like `meta`.
- Do not rename `id` to `rule_id`.
- Do not rename `include` to `glob`.
- Do not use boolean fields such as `allowed`.
- Do not omit `title`, `suite`, or `relation`.
- Do not wrap the YAML in markdown fences.

## YAML Skeleton

```text
schema: routa.archdsl/v1
model:
  id: backend_core
  title: Backend Core Architecture
  description: ...
  owners:
    - fitness
    - backend
defaults:
  root: .
  exclude:
    - ...
selectors:
  core_ts:
    kind: files
    language: typescript
    description: ...
    include:
      - src/core/**
rules:
  - id: ts_backend_core_no_core_to_app
    title: ...
    message_key: ...
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: app_ts
    engine_hints:
      - archunitts
```

## Output Contract

- Output YAML only.
- The first response line must be exactly `schema: routa.archdsl/v1`.
- Do not wrap the YAML in markdown fences.
- Do not add explanations before or after the YAML.
- Do not say that the file already exists, already matches, or is unchanged.
- The generated file must validate in both the TypeScript and Rust architecture DSL paths.
