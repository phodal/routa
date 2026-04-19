---
title: Execution Modes
---

# Execution Modes

Durable design note for how Routa's three primary execution modes differ in behavior, orchestration boundary, and delivery model.

This document is intentionally code-backed. It describes what the repository currently implements, not an aspirational product story.

## Purpose

Routa exposes three first-class execution modes:

- Sessions
- Kanban
- Team

All three are agent-first entry surfaces. The difference is not "simple vs advanced". The real difference is where orchestration begins:

- Sessions: start from one recoverable conversation thread
- Kanban: start from workflow state and lane automation
- Team: start from a coordinating lead that dispatches real child sessions

## Mode Matrix

| Mode | Primary unit | Entry shape | Multi-agent boundary | Quality control shape | Best fit |
|---|---|---|---|---|---|
| Sessions | one session thread | direct launcher | ROUTA can delegate inside the session when needed | flexible, task-specific, not pre-wired to a lane policy | general-purpose implementation, exploration, recovery |
| Kanban | one task card in a lane | board + lane transition | lane automation creates sessions from card movement | server-enforced artifacts, contract rules, delivery gates | delivery pipelines, repeatable execution, visible flow control |
| Team | one team-led run | shared team launcher | Team lead dispatches real child sessions in waves | mandatory delegation + verification culture at the lead layer | complex work spanning multiple specialties and code areas |

## Sessions Mode

### What the code does

- The Sessions launcher uses `HomeInput` with `defaultAgentRole: "ROUTA"`, while still allowing role switch and custom specialists. That means the default entry is ROUTA, but the mode is not hard-locked to one role. See `src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx` and `src/client/components/home-input.tsx`.
- `HomeInput` creates exactly one session first, then sends or stores the prompt for that session. It does not pre-create a fixed worker graph. See `src/client/components/home-input.tsx`.
- Inside a session, the built-in role selector still exposes `CRAFTER`, `ROUTA`, `GATE`, and `DEVELOPER`. See `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`.
- The ROUTA specialist is explicitly coordinator-only: it delegates implementation to CRAFTER and verification to GATE instead of editing code itself. See `docs/specialists/core/routa.md`.
- The session detail UI restores child CRAFTER sessions under a parent ROUTA session and visualizes them in the crafter panel. See `src/app/workspace/[workspaceId]/sessions/[sessionId]/use-session-crafters.ts`.

### Product meaning

Sessions is the default general-purpose mode.

The important nuance is that Sessions is not "plain chat". It is a single-session entry surface with optional orchestration. The run begins in one recoverable thread, and ROUTA can spin out specialist work only when the task actually needs it.

That makes Sessions the lowest-friction multi-agent entry:

- one main thread to recover later
- no lane policy to satisfy up front
- no mandatory team wave management
- no pre-committed workflow graph

Because it does not front-load board automation or a team roster, it is usually the most token-efficient agent-first starting mode.

### Copy guidance

Describe Sessions as:

- the default mode
- one-session-first
- ROUTA-first by default
- capable of pulling in CRAFTER/GATE only when needed

Do not describe Sessions as:

- plain single-agent chat
- a fixed ROUTA -> CRAFTER -> GATE pipeline

## Kanban Mode

### What the code does

- Kanban is an active automation surface, not just a board view. Column transitions emit workflow events that can trigger sessions. See ADR 0004 and `src/core/kanban/workflow-orchestrator.ts`.
- Default columns are `backlog`, `todo`, `dev`, `review`, `done`, `blocked`, and each stage can carry recommended automation. See `src/core/models/kanban.ts` and `src/core/kanban/boards.ts`.
- Recommended lane defaults are specialist-driven:
  - `backlog`, `todo`, `dev`, `blocked` default to CRAFTER specialists
  - `review` and `done` default to GATE specialists
- `review` requires artifacts and delivery readiness by default.
- `done` requires committed changes, clean worktree, and PR-ready branch by default.
- Board automation is queued per board with concurrency limits, so card movement does not stampede the runtime. See `src/core/kanban/kanban-session-queue.ts`.
- Dev-lane sessions can be supervised and recovered via watchdog or Ralph-loop policies. See `src/core/kanban/board-session-supervision.ts` and `src/core/kanban/workflow-orchestrator.ts`.
- Delivery rules are enforced as column policy across UI, REST, and MCP, not left to prompt discipline alone. See ADR 0007 and `src/core/kanban/task-delivery-readiness.ts`.

### Product meaning

Kanban is the process-driven mode.

The key distinction is that orchestration begins from workflow state, not from one freeform conversation. Moving a card into a lane can create the next agent session automatically, and the lane policy can enforce artifacts, delivery gates, and sequencing.

This is the strongest mode for delivery control because it gives the system a stable workflow boundary:

- card state is the trigger
- lanes define who runs next
- review/done carry explicit quality gates
- queueing keeps board execution bounded

### Precision note

Do not say "every lane is a GATE".

That is not what the code does.

The accurate statement is:

- every lane can be an automation boundary
- lanes are specialist/role/policy driven
- review and done are the default GATE checkpoints

## Team Mode

### What the code does

- Team mode launches through `HomeInput`, but the mode is hard-wired to `team-agent-lead`. Role switching and custom specialist selection are disabled. Repo selection is required before launch. See `src/app/workspace/[workspaceId]/team/team-page-client.tsx`.
- The team lead is a ROUTA-role specialist, but distinct from the generic core ROUTA specialist. Its prompt is explicitly about planning, delegating, coordinating, verifying, and never implementing. See `docs/specialists/team/team-agent-lead.md` and `resources/specialists/team/agent-lead.yaml`.
- The team lead uses real child sessions for delegation, not lightweight hidden delegation paths. The prompt explicitly requires `delegate_task_to_agent` so work is visible in Team UI.
- The lead is instructed to keep small active waves, isolate overlapping scopes, and re-verify before completion.
- The Team page models top-level runs and descendant counts, which reflects that Team mode is fundamentally session-tree oriented rather than single-thread oriented.

### Product meaning

Team is the organization-driven mode.

The run starts with a lead, not with a freeform implementation session and not with a board lane. The lead decides who should work, in what wave, and with what verification loop.

This makes Team the right mode when the coordination problem is itself first-class:

- multiple specialties need to work together
- work can benefit from parallel waves
- frontend/backend/QA/review separation matters
- the task spans multiple subsystems or code areas

### Multi-codebase note

Team is the best fit for multi-codebase work inside one workspace, but that statement needs nuance.

What the code guarantees today:

- a workspace can hold multiple codebases
- Team mode uses a lead that can delegate across specialists
- the Team launcher requires an initial repo selection before kickoff

What follows as a product inference:

- Team is the most natural mode for cross-codebase or cross-repository coordination because it starts from delegation and wave management rather than from a single lane or a single main thread

What should not be claimed:

- that Team already exposes a dedicated multi-repo launcher UI at entry time

## Recommended Homepage Wording

Use wording that reflects orchestration boundary rather than user seniority:

- Sessions: default, single-thread entry, ROUTA-first, dynamic specialist expansion, lowest-friction recovery
- Kanban: workflow-driven, lane automation, review/done quality gates, strongest delivery control
- Team: lead-driven, real child-session delegation, best for complex cross-specialty work, strongest coordination model

For homepage presentation, use two text layers instead of one overloaded paragraph:

- Primary copy: user-facing selection guidance, focused on when to choose the mode
- Secondary copy: smaller technical detail, focused on how agent orchestration works under the hood

Recommended split:

- Sessions primary: default entry, one recoverable thread, good for starting and resuming work
- Sessions secondary: ROUTA-first, dynamic CRAFTER/GATE expansion, usually the most token-efficient path
- Kanban primary: delivery-process mode with explicit stages and acceptance boundaries
- Kanban secondary: lane automation, specialist-by-stage execution, GATE checkpoints in review/done
- Team primary: team-orchestration mode for complex cross-specialty or multi-codebase work
- Team secondary: team-agent-lead kickoff, real child sessions, wave-based delegation, explicit verification

Avoid these phrases:

- "Team is advanced mode"
- "Kanban is just a classic board"
- "Sessions is just normal chat"

## Code References

- `src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx`
- `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`
- `src/app/workspace/[workspaceId]/sessions/[sessionId]/use-session-crafters.ts`
- `src/client/components/home-input.tsx`
- `src/app/workspace/[workspaceId]/team/team-page-client.tsx`
- `docs/specialists/core/routa.md`
- `docs/specialists/team/team-agent-lead.md`
- `resources/specialists/team/agent-lead.yaml`
- `src/core/models/kanban.ts`
- `src/core/kanban/boards.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/kanban/board-session-supervision.ts`
- `docs/adr/0004-kanban-driven-automation.md`
- `docs/adr/0007-kanban-delivery-transition-policies.md`
