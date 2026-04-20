---
title: Architecture Quality
---

# Architecture Quality

Routa provides real-time architecture quality monitoring for TypeScript and Rust backend code through a unified Architecture DSL and multiple execution backends.

## Overview

The Architecture Quality system helps you:

- **Enforce boundaries** between core modules, API surface, and client code
- **Detect cycles** in backend dependency graphs
- **Track violations** over time with snapshot comparison
- **Define rules once** and execute across TypeScript (ArchUnitTS) and Rust (graph-based) backends

## Quick Start

### View Architecture Quality in UI

1. Open **Settings → Harness**
2. Select your workspace and repository
3. Click the **Architecture** tab
4. Click **Run Architecture Scan**

The scan covers:
- Backend boundary leaks across core and API modules
- Cycle hotspots inside the backend core graph
- Snapshot comparison after each successful scan

### Run from Command Line

```bash
# Run all architecture checks
npm run test:arch:backend-core

# Run only boundary checks
npm run test:arch:backend-core -- --suite boundaries

# Run only cycle checks
npm run test:arch:backend-core -- --suite cycles

# Get JSON output
npm run test:arch:backend-core -- --json
```

### Rust CLI

```bash
# Validate and inspect DSL rules
cargo run -p routa-cli -- fitness arch-dsl --json

# Parse and execute graph-backed rules
cargo run -p routa-cli -- graph analyze --dir src/core --lang typescript
```

## Architecture Rules

Rules are defined in `architecture/rules/backend-core.archdsl.yaml` using the Routa Architecture DSL.

### Current Rules

#### Boundary Rules

1. **No Core → App dependencies**
   - `src/core/**` must not depend on `src/app/**`
   - Prevents domain logic from coupling to framework code

2. **No Core → Client dependencies**
   - `src/core/**` must not depend on `src/client/**`
   - Keeps backend logic isolated from browser code

3. **No API → Client dependencies**
   - `src/app/api/**` must not depend on `src/client/**`
   - Prevents server routes from importing UI components

#### Cycle Rules

4. **Core modules must be acyclic**
   - `src/core/**` should have no circular dependencies
   - Ensures clean layering and testability

## DSL Format

Rules are written in YAML with a stable schema (`routa.archdsl/v1`):

```yaml
schema: routa.archdsl/v1

model:
  id: backend_core
  title: Backend Core Architecture
  owners: [fitness, backend]

selectors:
  core_ts:
    kind: files
    language: typescript
    include: [src/core/**]

rules:
  - id: ts_backend_core_no_core_to_app
    title: src/core must not depend on src/app
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: app_ts
    engine_hints: [archunitts, graph]
```

### Key Concepts

- **Selectors**: Reusable file scopes (e.g., `core_ts`, `api_ts`)
- **Rules**: Constraints on dependencies or cycles
- **Suites**: Logical grouping (e.g., `boundaries`, `cycles`)
- **Engine hints**: Which backends support this rule (`archunitts`, `graph`)

## UI Features

### Multiple Views

- **Summary**: Overview of pass/fail status and violation counts
- **Boundary Leaks**: Failed boundary rules with source → target details
- **Cycle Hotspots**: Circular dependency paths
- **Violations**: All violations grouped by rule

### Snapshot Comparison

After each scan, results are saved to `docs/fitness/reports/backend-architecture-latest.json`. The UI automatically compares with the previous scan to show:

- New failing rules
- Resolved rules
- Violation deltas

### Drilldown

Click any failed rule to see:
- Specific source and target files
- Number of dependency edges
- Full violation paths for cycles

## Integration with Fitness

Architecture Quality is registered as an independent fitness dimension:

- **Dimension**: `architecture_quality`
- **Weight**: 0 (advisory mode, does not affect total score)
- **Tier**: normal
- **Execution scope**: local (does not run in CI by default)

### Metrics

- `ts_backend_core_arch_boundaries`: TypeScript backend boundary constraints
- `ts_backend_core_arch_cycles`: TypeScript backend cycle detection

## Multi-Language Support

The UI is fully localized:

- **English**: Complete translations for all labels and messages
- **中文**: 完整的中文界面支持

Translation keys are in `src/i18n/locales/{en,zh}.ts` under `settings.harness.architectureQuality`.

## Known Limitations

1. **Advisory mode only**: Currently runs as local check, not enforced in CI
2. **ArchUnitTS cycle detection**: May hit stack overflow on very large codebases
3. **TypeScript backend only**: Rust backend rules are defined but not yet fully integrated
4. **Local ArchUnitTS required**: Expects source at `~/test/ArchUnitTS` (or set `ROUTA_ARCHUNITTS_PATH`)

## Next Steps

- Gradually increase rule weight as violations are fixed
- Expand coverage to more fine-grained slice/layer rules
- Integrate Rust backend architecture rules
- Add rule authoring UI for custom constraints

## Related Documentation

- [Architecture Rule DSL Design](../design-docs/architecture-rule-dsl.md) - Full DSL specification and implementation details
- [Issue #286](https://github.com/phodal/routa/issues/286) - Original feature proposal

### Internal References (Not in Docusaurus)

These files are part of the internal fitness framework and not published to the docs site:

- `docs/fitness/README.md` - Overall fitness framework
- `docs/fitness/backend-architecture.md` - Fitness dimension definition with metric configuration
