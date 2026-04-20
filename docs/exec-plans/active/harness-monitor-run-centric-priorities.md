# Harness Monitor Run-Centric Priorities

## Goal

Turn `crates/harness-monitor` from a repo-local observer into a run-centric operator console that matches the near-term direction in `Routa Harness Architecture v1`.

This plan is intentionally not a full Harness Core roadmap. It focuses on the subset of capabilities that should evolve into `harness-monitor` first.

## Why This Plan Exists

The architecture draft in `/Users/phodal/Downloads/routa-harness-architecture-v1.md` makes a clear distinction:

- `Harness Monitor` is the live operator console
- `Routa Harness Core` is the control plane

Today `harness-monitor` is already strong at:

- observation via hooks, process detection, and dirty-file scans
- file attribution and unknown/conflict surfacing
- maintainability evaluation via Entrix-oriented fitness panels

But the current product shape is still closer to a session/file monitor than a run-centric harness console. If we continue to optimize `Agents View` in isolation, we will improve visibility without improving control.

The near-term priority is therefore:

1. make `Runs` the primary unit of operation
2. treat `Agents` as one signal source for runs, not the main product object
3. attach evaluation, approval, and evidence to runs
4. expose worktree and orchestration state in the same operator flow

## Source Inputs

- `/Users/phodal/Downloads/routa-harness-architecture-v1.md`
- [docs/ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/fitness/README.md](../../fitness/README.md)
- [docs/fitness/harness-fluency.profile.agent_orchestrator.yaml](../../fitness/harness-fluency.profile.agent_orchestrator.yaml)
- [docs/design-docs/agentwatch-tui.md](../../design-docs/agentwatch-tui.md)

Relevant in-repo domain scaffolding already exists in:

- [crates/harness-monitor/src/domain/task.rs](../../../crates/harness-monitor/src/domain/task.rs)
- [crates/harness-monitor/src/domain/run.rs](../../../crates/harness-monitor/src/domain/run.rs)
- [crates/harness-monitor/src/domain/workspace.rs](../../../crates/harness-monitor/src/domain/workspace.rs)
- [crates/harness-monitor/src/domain/evidence.rs](../../../crates/harness-monitor/src/domain/evidence.rs)
- [crates/harness-monitor/src/domain/policy.rs](../../../crates/harness-monitor/src/domain/policy.rs)
- [crates/harness-monitor/src/domain/eval.rs](../../../crates/harness-monitor/src/domain/eval.rs)
- [crates/harness-monitor/src/domain/events.rs](../../../crates/harness-monitor/src/domain/events.rs)

## Priority Judgment

### P0: Run-Centric Operator Model

This is the main priority for the next iterations.

In scope:

- make `Run / Task / Workspace / Evidence` the visible runtime model in the TUI
- stabilize unmanaged runs so external `codex` / `claude` / `cursor` processes appear as runs even when hook coverage is partial
- attach worktree and repo-local workspace state to each run
- show run status as an operator state machine instead of only `active / idle / unknown`

Why this is first:

- the architecture draft defines these as first-class objects
- the repo already started modeling them in `crates/harness-monitor/src/domain/`
- without this shift, policy, evidence, evaluation, and orchestration have nowhere coherent to attach

### P0: Unmanaged Attach As First-Class Capability

This is the most important execution-mode requirement right now.

In scope:

- attach repo-local detected agents to runs when hooks are missing or incomplete
- synthesize fallback unmanaged runs from process detection when attribution confidence is insufficient
- distinguish real hook-backed runs from synthetic fallback runs in the UI
- keep unknown/conflicted ownership visible instead of hiding ambiguity behind false certainty

Why this is first:

- current user workflow already depends on externally launched agents
- `Routa Harness Architecture v1` explicitly treats unmanaged mode as a valid long-term mode
- a managed runner can come later, but the console must already explain what is happening now

### P0: Run-Scoped Evaluation, Evidence, And Approval

This is the key step from monitor to harness console.

In scope:

- show fast/full eval state as part of run details rather than an isolated fitness-only surface
- represent evidence required for a run to proceed
- expose blocking policy decisions and approval checkpoints in run details
- show whether a run is blocked by hard gate failure, missing evidence, or explicit approval

Why this is first:

- the architecture draft treats `Policy Plane` and `Evaluation Plane` as the differentiators between monitor and harness
- `docs/fitness/README.md` already defines the evidence-driven validation rulebook
- the domain model already includes `EffectClass`, `PolicyDecisionKind`, `EvidenceRequirement`, and `EvalSnapshot`

### P1: Workspace / Worktree Lifecycle

This should follow immediately after the run model is stable.

In scope:

- show which workspace or worktree a run owns or attaches to
- surface workspace states such as `provisioning`, `ready`, `dirty`, `validated`, `archived`
- display drift, integrity warnings, and recovery hints in run details
- allow operators to understand whether a run is safe to continue, replay, or discard

Why this is next:

- Routa is workspace-first across web and desktop
- worktree lifecycle is part of the architecture invariant, not a UI-only concern
- managed mode cannot be legible without a visible workspace model

### P1: Multi-Agent Role And Handoff Visibility

This is more important than a richer standalone agents panel.

In scope:

- show run role using the existing `Role` model: `planner`, `builder`, `reviewer`, `fixer`, `release`, `caretaker`
- show handoff summary between runs
- surface unresolved questions and recommended next actions
- group related runs by task or execution chain when possible

Why this matters:

- the architecture draft defines orchestration as role-based flow, not simply concurrent sessions
- the next useful operator question is not "how many agents exist?" but "who owns the next step?"

### P2: Managed Execution Envelope

This belongs in the roadmap, but not as the first `harness-monitor` delivery target.

In scope later:

- run launch from the monitor
- isolated env, secret scope, tool allowlist, network policy, and time/token budget
- pause, resume, replay, and preflight policy evaluation

Why this is not first:

- the current user value gap is not the absence of a launcher, but the absence of a coherent run console for already-running agents
- unmanaged mode must be trustworthy before managed mode becomes operationally useful

### P2: Delivery Loop And Runtime Remediation

This is important, but depends on earlier control-plane work.

In scope later:

- PR open, merge, deploy, rollback, and runtime watch integration
- red-fix and entropy-reduction loops
- runtime anomaly surfaces that open follow-up tasks or cleanup actions

Why this is later:

- these actions require mature policy, evidence, and run identity
- otherwise they become isolated buttons without reliable state semantics

## What This Means For The UI

The recommended information hierarchy is:

1. `Runs` as the primary navigation list
2. `Run Details` as the main operator pane
3. `Files` as a subordinate evidence and attribution view
4. `Agents` as a supporting signal and diagnostics view
5. `Fitness` as a run-scoped evidence status, not a detached scorecard

Practical implication:

- do not treat `Agents View` as the main place to add value
- move more operational context into `Runs`
- use the agents panel to explain provenance, process health, and matching ambiguity

## Near-Term Implementation Steps

### Step 1: Finish Unmanaged Run Fallback

Goal:
- ensure repo-local detected agents show up in `Runs` even when there is no matching hook-backed session

Implementation focus:
- synthetic fallback run items from unmatched detected agents
- clear UI labels for `hook-backed` vs `process-scan` origin
- no false attribution when matching is ambiguous

Verification:
- state tests for unmatched agent fallback
- TUI snapshot coverage for runs list and run details

### Step 2: Expand Run Details Into Operator State

Goal:
- make run details the place where an operator understands current status, source, last action, workspace, and block reason

Implementation focus:
- source, mode, role, workspace/worktree path, last tool/event, and blocking reason
- summary labels for `executing`, `evaluating`, `awaiting_approval`, `failed`, `replayed`

Verification:
- snapshot tests for compact/full layouts
- state tests for status mapping and sort/filter behavior

### Step 3: Attach Eval And Evidence To Runs

Goal:
- show what evidence exists and what is still missing before a run can proceed

Implementation focus:
- `EvalSnapshot` summary in run details
- evidence requirement list
- blocked state for hard gates, score gates, or missing artifacts

Verification:
- unit tests for blocked/ready logic
- snapshot tests for healthy and blocked runs

### Step 4: Surface Policy And Approval Checkpoints

Goal:
- make side-effect constraints visible in the operator flow

Implementation focus:
- show effect classes
- show current policy decision
- show whether approval is required, granted, or blocking

Verification:
- unit tests around policy decision rendering and blocking semantics

### Step 5: Add Workspace And Handoff Views

Goal:
- connect run execution to workspace lifecycle and multi-agent flow

Implementation focus:
- workspace summary in run details
- handoff summary between related runs
- unresolved question list and next-action list

Verification:
- unit tests for workspace state summaries
- snapshot coverage for handoff-rich runs

## Explicit Non-Goals For This Plan

- redesigning the entire TUI around a full managed runtime from day one
- implementing the whole `ContextPack` and repo-memory system inside `harness-monitor`
- replacing Entrix with a new evaluation engine before the run model is stable
- turning the agents panel into the main product surface

## Exit Criteria

This plan is successful when:

- `Runs` reliably represent both hook-backed and repo-local unmanaged execution
- operators can tell why a run is blocked, risky, or ready to proceed
- worktree and evaluation state are visible from the run flow
- the agents panel becomes a supporting diagnostic view rather than the primary control surface
- future managed-mode work can attach to an already legible run/task/workspace/evidence model
