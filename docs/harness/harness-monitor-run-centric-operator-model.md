---
status: active
purpose: Run-centric operator semantics for harness-monitor, including the shared application-layer assessment between domain records and CLI/TUI surfaces.
---

# Harness Monitor Run-Centric Operator Model

## Review Judgment

The original refactor note is directionally correct, but the key architectural move is not "promote ten planes into ten peer runtime entities".

The stable first-class objects should remain:

- `Task`
- `Run`
- `Workspace`
- `EvalSnapshot`
- `PolicyDecision`
- `Evidence`
- related domain events

The plane taxonomy is still valuable, but as an application-layer semantic view over those records.

## Layered Shape

`harness-monitor` should read from left to right like this:

```text
Adapters / Raw Signals
  observe.rs, detect.rs, hooks.rs, ipc.rs, state_events.rs

Domain Records
  domain/run.rs, domain/task.rs, domain/workspace.rs,
  domain/eval.rs, domain/policy.rs, domain/evidence.rs

Application Semantics
  application/run_assessment.rs

Presentation
  cli_operator.rs
  tui_render.rs + tui_panels.rs
```

The application layer is where run meaning is derived. CLI and TUI should consume that layer instead of independently reconstructing operator state.

## Plane Model

The current shared run assessment keeps the following planes explicit:

### Implemented / Emerging

- `Observe`: hook-backed sessions, process-scan fallbacks, attribution-review bucket
- `Attribute`: exact / inferred / unknown file ownership and ambiguity visibility
- `Evaluate`: fast/full evaluation status, hard-gate and score-gate outcomes
- `Orchestrate`: workspace attachment, unmanaged fallback visibility, run handoff hints
- `Constrain`: effect classes, policy decision, approval requirements
- `Validate`: whether verification is blocked or waiting on evidence
- `Evidence`: required artifacts and missing evidence summaries

### Explicit Roadmap Planes

- `Contextualize`: context-pack assembly from `AGENTS.md`, architecture rules, product/task intent
- `Operate`: PR / merge / deploy / rollback controls
- `Reflect`: runtime learning loop, drift detection, follow-up feedback

These roadmap planes are represented as `roadmap` status in the assessment model so they stay explicit without forcing premature implementation.

## Phase 1 Code Boundary

Phase 1 introduces a single shared semantic path:

- `RunAssessmentInput` collects raw run/workspace/eval facts
- `assess_run(...)` derives:
  - role
  - mode / origin
  - operator state
  - workspace state
  - policy / evidence / next action
  - semantic plane statuses
- CLI and TUI both render from that result

In concrete code:

- `crates/harness-monitor/src/application/run_assessment.rs` is the semantic aggregation layer
- `crates/harness-monitor/src/operator_guardrails.rs` remains the lower-level constrain/evidence engine
- `crates/harness-monitor/src/cli_operator.rs` no longer owns a parallel run-state heuristic
- `crates/harness-monitor/src/tui_panels.rs` and `crates/harness-monitor/src/tui_render.rs` no longer derive role/origin/state independently

## Naming Guidance

The naming rule for this slice is:

- domain layer uses nouns: `run`, `task`, `workspace`, `policy`, `evidence`, `eval`
- application layer uses semantic capability names: `run_assessment`
- presentation keeps surface names: `cli`, `tui`, `render`, `panels`

This is why the first extraction is `application/run_assessment.rs`, not a new top-level crate for every plane.

## Scope Boundaries

This refactor deliberately does not implement:

- managed run launch / stop orchestration
- full context-pack assembly
- PR / deploy / rollback control surfaces
- reflective learning loops over historical runs

Those remain valid next steps, but they should build on the shared run assessment instead of bypassing it.

## Verification Criteria

The refactor is considered successful when:

- CLI and TUI share one run assessment path
- unmanaged fallback runs remain visible
- unknown/conflict attribution remains explicit
- workspace and handoff meaning are attached to runs
- roadmap planes stay visible without being over-implemented
