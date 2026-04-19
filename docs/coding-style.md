---
title: Coding Style
---

# Coding Style

## Core philosophy
- Think in domain objects first, not helper functions first.
- Prefer a thin shell + thick core structure: CLI/API/UI should mainly dispatch, while real logic lives in core/usecases.
- Optimize for explicitness, readability, and shipping value over clever abstractions.
- Preserve stable data/file/output contracts even if that requires manual serialization or explicit conversion code.

## Project organization
- Organize modules by domain responsibilities such as `entry`, `usecases`, `parser`, `transflow`, `server`, `cli`, `helper`.
- Use nouns for modules and data structures; use verbs for functions.
- Keep entrypoints thin and move reusable logic downward.

## Rust style
- Prefer simple structs/enums with clear fields and strong domain names.
- Use `Serialize/Deserialize/Debug/Clone/Default` freely for domain models when helpful.
- Prefer `PathBuf`, ordered maps, and explicit helper types when filesystem structure or field order matters.
- Prefer straightforward `for`, `if`, and `match` over clever iterator chains when readability would suffer.
- Return `Result` on public boundaries and use custom business errors for domain failures.
- Manual formatting/parsing is acceptable when the text format itself is part of the product contract.
- Small and medium functions are preferred, but larger orchestration/codegen functions are acceptable when they keep the workflow readable in one place.

## Error handling
- Be pragmatic: preserve errors at the boundary, but do not over-engineer every internal branch.
- Use fail-fast assumptions internally only when the invariant is genuinely strong.
- Avoid ornamental error plumbing that obscures the business flow.

## Testing
- Prefer behavior-driven tests around real workflows, fixtures, file IO, parsing, and generated output.
- Test end-to-end slices of functionality, not only isolated pure functions.
- Test names should describe behavior clearly, e.g. `should_create_*`, `parse_*`, `update_*`, `crud_*`.

## TypeScript / frontend style
- Prefer pragmatic component code that integrates well with the browser and libraries.
- Use hooks or component state directly; keep logic close to the component unless reuse is real.
- Tolerate imperative DOM/event integration at framework boundaries.
- Prefer readable local helpers over premature abstraction.
- Use styled-components or similarly local styling when it keeps the component self-contained.

## Naming
- Use domain-heavy names like `create_entry`, `update_entry_properties`, `feed_entry`, `parse_action`, `gen_transform`.
- Name things by what they mean in the business/workflow, not by generic technical labels.

## Avoid
- Do not introduce abstraction layers unless they clearly reduce domain complexity.
- Do not optimize for language cleverness at the cost of obvious control flow.
- Do not hide important data transformations behind magical helpers.
- Do not overfit to legacy artifacts such as excessive `any`, `@ts-ignore`, or noisy `unwrap/expect`.
