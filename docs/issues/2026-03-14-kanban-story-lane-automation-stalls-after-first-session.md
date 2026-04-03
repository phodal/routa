---
title: "Kanban story/lane automation stalls after the first ACP session and lacks story-level workflow state"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-15"
severity: high
area: "kanban"
tags: ["kanban", "automation", "session", "workflow", "story", "lane", "acp"]
reported_by: "codex"
github_issue: 163
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/163"
related_issues:
  - "docs/issues/2026-03-12-gh-124-kanban-column-automation-does-not-start-sessions-manual-issue-modal-cras.md"
  - "docs/issues/2026-03-14-kanban-session-concurrency-queue.md"
  - "https://github.com/phodal/routa/issues/163"
---

# Kanban story/lane automation stalls after the first ACP session and lacks story-level workflow state

## What Happened

On `http://localhost:3000/workspace/default/kanban`, the KanbanTask input can open an ACP session on the right side and start backlog planning work. The default board is currently configured with automation on every lane, including:

- `backlog` => `Issue Enricher`, `transitionType: entry`, `autoAdvanceOnSuccess: true`
- `todo` => auto-enabled, `transitionType: entry`, `autoAdvanceOnSuccess: true`
- `dev`, `review`, `blocked`, `done` => also auto-enabled

Observed behavior during investigation:

- Typing `create a hello world` in the input opens a planning ACP session immediately.
- The current default board API shows automation enabled on every workflow lane:
  - `backlog` => `Issue Enricher` (`providerId: claude`, `role: DEVELOPER`, `specialistId: issue-enricher`)
  - `todo` => `providerId: codex`, `role: ROUTA`
  - `dev` => `providerId: claude`, `specialistId: pr-reviewer`
  - `review` => `providerId: claude`, `role: GATE`, `specialistId: desk-check`
  - `blocked` => `providerId: codex`, `specialistId: claude-code`
  - `done` => `providerId: codex`, `role: GATE`, `specialistId: gate`
- Existing backlog cards can already hold a `triggerSessionId`, which confirms that a lane session can be created for at least the first transition.
- A task already sitting in `todo` can remain without `triggerSessionId`, which means lane entry does not reliably lead to a new session even when `todo` automation is enabled.
- The automation chain does not continue through the configured lanes after the first session finishes.

The implementation currently models automation as "one ACP session per column transition" and stores only a single `triggerSessionId` on the task. There is no durable story-level execution record that represents a story progressing through multiple lane sessions.

## Expected Behavior

- KanbanTask input should create the planning session, and after planning completes it should create or refine the corresponding story card.
- When backlog automation is enabled, a backlog story should advance into the next workflow state and start the assigned lane automation.
- When a lane session completes successfully and `autoAdvanceOnSuccess` is enabled, the card should advance to the next lane and start that lane's session.
- A story should be able to accumulate multiple lane sessions across backlog, todo, dev, review, blocked, and done instead of overloading a single `triggerSessionId`.

## Reproduction Context

- Environment: web
- Trigger: open `/workspace/default/kanban`, submit `create a hello world`, wait for the planning session to run, then observe that the workflow does not continue across automated lanes

Additional runtime context captured during investigation:

- Board id: `d63b96f5-b40b-4a77-a4fd-84978fd316c0`
- Board session concurrency limit: `3`
- Current queue snapshot already shows lane-level running state, but not story-level workflow state

## Why This Might Happen

- Kanban automation startup and Kanban automation completion appear to depend on different event channels. Column entry is driven by `COLUMN_TRANSITION` on the global `EventBus`, but session completion is first converted into `WorkspaceAgentEvent` inside `HttpSessionStore` and is not obviously bridged back into the global `EventBus` for ordinary Kanban task sessions.
- `KanbanWorkflowOrchestrator` and `KanbanSessionQueue` both wait for `AGENT_COMPLETED` / `REPORT_SUBMITTED` / `AGENT_FAILED` / `AGENT_TIMEOUT` on the global `EventBus`, but ordinary Kanban ACP sessions appear to be tracked mainly by per-session state in `HttpSessionStore`.
- `HttpSessionStore.subscribeToAgentEvents()` exists, but the current code search shows no Kanban-side subscriber that converts per-session `agent_completed` / `agent_failed` semantic events back into `EventBus.AgentEventType.AGENT_COMPLETED` or related events.
- `Task.triggerSessionId` represents only one session, which does not match the intended model where one story should progress through multiple lane sessions, and possibly rollback/retry branches.
- The current data model is lane-oriented rather than story-oriented: lane transition triggers session creation, but there is no durable workflow graph or lane-session history attached to the story.

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-agent-input.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/core/kanban/column-transition.ts`
- `src/core/kanban/agent-trigger.ts`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/core/events/event-bus.ts`

## Observations

- `src/app/api/tasks/route.ts` emits `COLUMN_TRANSITION` immediately after task creation when the target column has automation enabled.
- `src/app/api/tasks/[taskId]/route.ts` also emits `COLUMN_TRANSITION` after a card move, but direct ACP triggering outside the orchestrator is still special-cased for `dev` / retry logic.
- `src/core/kanban/workflow-orchestrator.ts` auto-advances only after receiving lifecycle events from the global `EventBus`.
- `src/core/acp/http-session-store.ts` converts provider updates to `WorkspaceAgentEvent` and dispatches them only to per-session subscribers via `subscribeToAgentEvents()`.
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts` does produce `agent_completed` / `agent_failed` semantic events, but those are not the same objects as `EventBus` `AgentEventType.AGENT_COMPLETED` / `AGENT_FAILED`.
- `src/core/kanban/workflow-orchestrator-singleton.ts` and `src/core/kanban/kanban-session-queue.ts` both short-circuit on `task.triggerSessionId`, so once a task retains a prior session id there is no built-in representation for “the next lane session” beyond clearing and overwriting that single field.
- Current task data in `default` workspace shows mixed states: some backlog cards have `triggerSessionId`, another card in `todo` has no `triggerSessionId`, and the new KanbanTask input session can run without producing a durable multi-lane workflow state.

## Current Analysis

This looks like two separate issues that compound each other:

1. Immediate execution bug:
   lane automation starts from `COLUMN_TRANSITION`, but completion/queue-drain logic waits on global lifecycle events that ordinary Kanban ACP sessions do not clearly emit back into the same `EventBus`. That explains why the first lane can start but the workflow stalls instead of auto-advancing.

2. Underlying model bug:
   the task schema only has one `triggerSessionId`, so even if the lifecycle bridge is fixed, the current model still cannot represent a single story accumulating backlog/todo/dev/review/done sessions or rollback branches. It can only overwrite or reuse one session pointer.

The user hypothesis that "each Todo/Backend lane creates one session and then can no longer auto-run" is directionally correct, but the stronger conclusion is:

- creating one session per lane is not inherently wrong;
- the current implementation lacks both a reliable lifecycle bridge and a story-level session/workflow record, so the lane-per-session design cannot run end-to-end safely.

## References

- GitHub issue: `phodal/routa#163`
- User report on 2026-03-14 describing expected flow: input -> ACP session -> story creation -> backlog automation -> todo automation -> continued lane progression
- `docs/issues/2026-03-12-gh-124-kanban-column-automation-does-not-start-sessions-manual-issue-modal-cras.md`
- `docs/issues/2026-03-14-kanban-session-concurrency-queue.md`

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/core/acp/http-session-store.ts` now bridges ACP semantic lifecycle
  events back into the global `EventBus`, emitting `AGENT_COMPLETED` and
  `AGENT_FAILED` for Kanban-tracked sessions.
- `src/core/models/task.ts` now persists durable story-level lane execution
  state via `sessionIds`, `laneSessions`, and `laneHandoffs` instead of relying
  only on a single `triggerSessionId`.
- `src/core/kanban/workflow-orchestrator-singleton.ts` records each triggered
  lane session with `upsertTaskLaneSession(...)`, and
  `src/core/kanban/workflow-orchestrator.ts` marks lane session status,
  advances within multi-step automation, and auto-advances cards into the next
  automated lane when `autoAdvanceOnSuccess` is enabled.
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-helpers.tsx` and related
  Kanban detail surfaces now prefer the latest `laneSessions` entry when
  resolving the active run instead of assuming one durable session pointer.
- `src/core/kanban/__tests__/workflow-orchestrator.test.ts` contains focused
  chained-lane regression cases such as
  `clears the previous lane session before auto-advancing into the next automation`
  and
  `does not let the previous lane cleanup timer delete the next lane automation`.
