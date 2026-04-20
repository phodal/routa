---
title: "Dev lane ACP sessions can silently go idle or fail without watchdog detection or automatic recovery"
date: "2026-03-17"
status: resolved
severity: high
area: "acp"
tags: ["acp", "kanban", "dev-lane", "watchdog", "session", "recovery", "agent", "ralph-loop"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-13-gh-137-implement-automatic-agent-lifecycle-notifications-permission-delegation.md"
  - "docs/issues/2026-03-14-gh-148-feat-add-session-queueing-and-concurrency-limits-for-kanban-acp-automati.md"
  - "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
  - "https://github.com/phodal/routa/issues/185"
github_issue: 190
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/190"
---

# Dev lane ACP sessions can silently go idle or fail without watchdog detection or automatic recovery

## What Happened

When a story enters the `dev` lane and an ACP session is started for implementation work, the session can become inactive, disconnect, or fail without a clear system-level response. In that state, the story appears to be stuck in progress, but there is no reliable mechanism to detect that the agent has stopped making progress after a timeout window such as 10 minutes.

The current workflow leaves a gap between "session was created" and "session is still healthy and progressing". If the ACP provider disconnects, the worker crashes, or the session reaches a failed terminal state without being handled by the workflow coordinator, the lane can remain effectively stalled.

## Expected Behavior

When a `dev` lane ACP session is no longer active or is not making progress for a configured amount of time, Routa should be able to detect that condition and surface it explicitly.

Expected outcomes:

- A session that has been inactive beyond a configurable threshold should be marked as suspicious, idle, timed out, or failed instead of silently remaining "running".
- A watcher should be able to observe session health, not just session creation.
- The workflow layer should be able to decide whether to alert, retry, requeue, or create a replacement agent/session.
- Recovery should preserve the original task goal and completion criteria instead of restarting blindly.

## Reproduction Context

- Environment: web / kanban automation
- Trigger: a story enters `dev`, ACP session starts, then the provider session disconnects, hangs, or stops producing progress/events for an extended period

## Why This Might Happen

- Session lifecycle tracking appears to focus more on start/end events than on "lack of forward progress" during execution.
- The current automation model may not have a dedicated watchdog that checks heartbeat, event freshness, or last-activity timestamps for active ACP sessions.
- Recovery behavior is unclear when a session disappears mid-flight: the system may know how to launch an agent, but not how to supervise one continuously.
- Existing coordination primitives may depend on explicit reports from the worker, which means a dead or disconnected worker can fail silently.
- A reusable loop mechanism similar to Ralph Loop may be missing: a stop/exit interception layer that re-injects the original task and completion criteria when the agent stops prematurely.

## Relevant Files

- `src/core/acp/`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/core/events/event-bus.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/tasks/route.ts`

## Observations

- The desired mechanism is closer to supervision than simple queueing.
- The timeout threshold likely needs to be configurable, for example 10 minutes of no activity, rather than hard-coded.
- Current code context suggests a mismatch between where lifecycle information is produced and where Kanban automation waits for it:
  - `KanbanWorkflowOrchestrator` listens for `AGENT_COMPLETED`, `REPORT_SUBMITTED`, `AGENT_FAILED`, and `AGENT_TIMEOUT` on the global `EventBus`.
  - `HttpSessionStore` already receives normalized provider updates and emits semantic workspace events per session.
  - Session supervision still appears oriented toward start/end semantics, not "no forward progress for N minutes".
- There is already precedent in the codebase for tracking progress freshness:
  - `HttpSessionStore.pushNotification(...)` is the natural place to update `lastActivity` or heartbeat-style metadata.
  - Background task notes already discuss `lastActivity`, `currentActivity`, and tool-call-based progress tracking.
- The problem should be framed as an execution-loop design problem, not just a timeout flag.

## Design Principles

Based on the Ralph Loop article and current Routa architecture, the design should preserve these principles:

- Supervision must be external and deterministic. The worker should not be trusted to self-report completion or failure reliably.
- Progress state should be externalized as durable metadata such as `lastActivityAt`, `lastMeaningfulEventAt`, retry count, stop reason, and recovery policy.
- Completion must be machine-verifiable. The system should distinguish `session stopped` from `work actually satisfied completion conditions`.
- Recovery loops must be bounded. Any retry / recreate strategy needs max-iterations or retry budgets.
- The design should separate:
  - liveness detection
  - completion verification
  - recovery policy
  - lane/workflow transition

## Design Options

### Option A: Passive Watchdog Only

Add a lightweight inactivity watcher around ACP sessions:

- record `lastActivityAt` whenever a normalized ACP update arrives
- periodically scan active `dev` lane sessions
- if no activity is seen for a configured threshold such as 10 minutes, mark the session as `idle`, `timed_out`, or `unhealthy`
- notify the workflow/UI, but do not automatically recover

Pros:

- lowest implementation risk
- easy to introduce without changing agent semantics
- gives operators visibility into silent stalls

Cons:

- only detection, no recovery
- human/operator still has to decide what to do next
- does not solve "session exited before completion criteria were met"

### Option B: Watchdog + Policy-Based Auto-Recovery

Extend Option A with bounded recovery rules:

- on inactivity/failure, execute policy:
  - notify only
  - retry current session once
  - requeue lane work
  - create a new ACP session from the original lane prompt
- persist retry count / recovery attempts per story lane
- require max retry budget and cooldown window

Pros:

- pragmatic fit for current Routa architecture
- significantly improves unattended Kanban flow
- can reuse existing session creation path

Cons:

- risks duplicate work if completion checks are weak
- can still restart from a poor prompt or corrupted local state
- needs idempotency rules at story/lane level

### Option C: Ralph-Lite Supervisor Loop

Treat lane automation as a bounded external execution loop:

- define lane objective and completion condition explicitly
- persist loop state outside the agent session
- when a session stops, a supervisor evaluates:
  - completed
  - failed terminally
  - stopped without satisfying completion criteria
- if the third case happens, spawn a fresh agent/session with the original task, current external state, and bounded iteration count

This follows the Ralph Loop idea more directly:

- context is not trusted to accumulate forever
- the loop is driven by external state and machine checks
- stopping is intercepted by supervisor policy, not by agent self-judgment

Pros:

- stronger conceptual model than ad hoc retries
- better fit for flaky/disconnected session scenarios
- reduces reliance on long-lived in-session memory

Cons:

- needs explicit completion criteria per lane
- requires new persisted loop metadata
- more invasive than a simple watchdog

### Option D: Actor-Critic Recovery Loop

Build on Option C and add a verification/review phase before auto-advance or restart:

- Actor session attempts implementation
- Critic/reviewer session or verifier checks whether lane completion conditions are truly met
- only then mark lane complete; otherwise revise/retry/recreate

Pros:

- strongest protection against false positives
- aligns with article's cross-model review / deterministic validation direction
- reduces cases where a session "completes" but work is incomplete

Cons:

- highest complexity and cost
- likely overkill as a first step for the current bug
- depends on having clear review criteria and additional orchestration

## Recommended Path

Recommended sequencing instead of picking a single all-in design:

1. Implement Option A first as the minimum observability baseline.
2. Add Option B as the first production recovery policy for `dev` lane automation.
3. Design toward Option C as the durable architecture if unattended autonomous flow is a core product goal.
4. Keep Option D as a later evolution once completion criteria and reviewer semantics are stable.

This gives Routa multiple viable paths:

- short-term: detect stalled sessions
- medium-term: auto-recover stalled sessions safely
- long-term: adopt a bounded Ralph-style external loop architecture

## Open Questions

- What counts as "activity": any provider event, token output, tool call, plan update, or only meaningful progress events?
- Should watchdog metadata be persisted in `HttpSessionStore`, task lane history, or a dedicated lane execution record?
- Should recovery operate on `session`, `lane`, or `story` as the primary unit?
- How do we prevent duplicate dev sessions after transient disconnects?
- What completion condition should gate auto-recreate:
  - agent turn completion
  - explicit report
  - file change detected
  - tests passing
  - reviewer approval
- Should the first version support only `dev`, or all automated lanes?

## References

- Ralph Loop concept provided in user report on 2026-03-17
- Local article: `/Users/phodal/Downloads/Understanding Agent Execution Loops.md`
- GitHub issue: `phodal/routa#185`
- Related GitHub issue: `#137` lifecycle notifications and coordinator awareness
- Related GitHub issue: `#148` session queueing and concurrency limits

## Implementation Update (2026-03-18)

- Added/confirmed supervision modes and retry config in shared board metadata:
  - `mode`: `disabled | watchdog_retry | ralph_loop`
  - `inactivityTimeoutMinutes`
  - `maxRecoveryAttempts`
  - `completionRequirement` (used by Ralph Loop)
- Implemented bounded recovery trigger flow in workflow orchestrator:
  - `scanForInactiveSessions()` scans running dev automations for timeout/error,
  emits `AGENT_TIMEOUT`/`AGENT_FAILED`, and marks session terminal state.
  - `handleAgentCompletion()` branches to:
    - direct fail/complete behavior for non-loop modes,
    - bounded retry behavior for `watchdog_retry` and `ralph_loop`.
  - `recoverAutomation()` creates a fresh ACP session and preserves attempt metadata in task history.
- Added a targeted watchdog message prompt:
  - `hi，这里有一个 Agent（acp session id = ...）很久没动了，你看看怎么回事，要不要继续？`
  - sent via `send_prompt` before bounded recovery in modes that can retry.
- Added behavior for missing/stale session metadata:
  - if source session record is missing or already in error, skip user prompt and continue recovery path.
- Extended watchdog retry/rerun signaling path:
  - `workflow-orchestrator-singleton` now tries to deliver recovery prompts to the active ACP session's Routa agent via `read_agent_conversation` + `send_message_to_agent` first.
  - the same payload is reused as fallback through `session/prompt` when agent messaging is unavailable or fails.
- Added/updated tests:
  - `src/core/kanban/__tests__/workflow-orchestrator.test.ts`
  - `src/core/kanban/__tests__/board-session-supervision.test.ts`

## Validation Update (2026-03-18)

- Re-ran targeted orchestrator coverage:
  - `npm run test -- src/core/kanban/__tests__/workflow-orchestrator.test.ts src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts`
  - result: 9/9 tests passed
- Re-ran lint for the touched orchestration files and tests:
  - `npm run lint -- src/core/kanban/workflow-orchestrator.ts src/core/kanban/workflow-orchestrator-singleton.ts src/core/kanban/__tests__/workflow-orchestrator.test.ts src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts`
  - result: passed
- Verified the live dev board still exposes prior watchdog recovery evidence in the UI:
  - `/workspace/default/kanban` currently shows watchdog-related cards whose latest state includes
    `Dev automation recovered after session inactive too long. Attempt 2/2.`
- Captured manual UI evidence for the live watchdog recovery flow:
  - `docs/issues/assets/2026-03-18-watchdog-e2e/01-kanban-watchdog-board.png`
  - `docs/issues/assets/2026-03-18-watchdog-e2e/02-traces-session-list.png`
  - `docs/issues/assets/2026-03-18-watchdog-e2e/03-watchdog-session-detail.png`
- Based on current code, tests, and live board state, this issue is not reproducible as an unhandled silent-stall path anymore.
