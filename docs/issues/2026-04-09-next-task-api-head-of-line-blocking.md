---
title: "Next.js task APIs suffer head-of-line blocking from heavy task list serialization"
date: "2026-04-09"
status: open
severity: high
area: "kanban"
tags: [api, kanban, performance, nextjs, fitness-candidate]
github_issue: 406
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/406"
related_issues:
  - "docs/issues/2026-04-07-task-changes-api-performance.md"
  - "docs/issues/2026-03-19-kanban-initial-refresh-storm.md"
  - "docs/issues/2026-04-09-rust-tasks-api-performance-analysis.md"
fitness_tracking:
  dimension: "performance"
  rulebook: "docs/fitness/runtime/performance.md"
  proposed_metric: "task_api_latency_probe"
---

# Next.js task APIs suffer head-of-line blocking from heavy task list serialization

## What Happened

Dogfood on the local Next.js dev server showed `GET /api/tasks/{taskId}/changes` taking tens of seconds.

The slow user-visible request was:

```text
http://localhost:3000/api/tasks/0e6a0433-543d-454b-b136-67bde25f37cc/changes
```

The first suspicion was ACP provider blocking, but route inspection and timing showed a broader Next.js API queueing problem.

## Measurements

Local measurements on 2026-04-09:

| Request | Backend | Observed time |
|---|---:|---:|
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | `1.55s` to `2.71s` when mostly isolated |
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | `15.91s` when issued beside task list refresh |
| `GET /api/tasks?workspaceId=default` | Next.js `localhost:3000` | `14.32s` to `15.42s` |
| `GET /api/tasks/{id}` | Next.js `localhost:3000` | `14.76s` while cold or queued; `0.59s` warm |
| `GET /api/tasks/{id}/changes` | Rust/Axum `127.0.0.1:3210` | `0.12s` warm |
| `GET /api/tasks?workspaceId=default` | Rust/Axum `127.0.0.1:3210` | `0.067s` |
| `git status --porcelain -uall` in the task worktree | local git | `0.03s` |

The Next.js task list response was approximately `840KB`. The sampled workspace had 21 serialized tasks with `deliveryReadiness` and 12 task worktrees.

## Current Diagnosis

`/api/tasks/{taskId}/changes` is not directly calling ACP.

The immediate route work is:

1. read task
2. read worktree
3. read codebase
4. run local git summary
5. call `buildTaskDeliveryReadiness(task, system)`, which resolves worktree/codebase again and runs delivery git status
6. optionally list committed changes since base

For the sampled task, local git commands were tens of milliseconds, so the worktree itself was not the dominant bottleneck.

The larger blocker is `GET /api/tasks?workspaceId=default` in the Next.js runtime:

1. `src/app/api/tasks/route.ts` lists workspace tasks.
2. It serializes every task with `serializeTask(task, system)`.
3. Each serialization builds evidence summary, story readiness, INVEST validation, and delivery readiness.
4. Those summaries perform per-task artifact/board/worktree/codebase reads and local git checks.
5. In the dogfood environment, Next.js was configured with a remote `DATABASE_URL` for Neon/Postgres, so N+1 store reads are network-sensitive.
6. Node/Next route code also uses synchronous git execution (`execSync` through `gitExecSync`), so CPU or git work can block the server worker event loop.

When the Kanban page refreshes task list, a simultaneous `/changes` request waits behind that heavier request and inherits the visible latency.

## Why This Matters

The file changes tab can look broken even when the changes endpoint and git repository are healthy.

This also obscures root cause: the browser network waterfall points at `/api/tasks/{id}/changes`, while the actual pressure may come from a neighboring Kanban refresh or task-list hydration request on the same Next.js dev server.

## Deduplication Note

The narrower Rust-side analysis record has been merged into this issue as a
supporting backend parity note. The authoritative active tracker for this task
API performance family is this file plus GitHub issue `#406`.

## Proposed Fix

- Keep `GET /api/tasks?workspaceId=...` on a lean list path; use explicit expansion or task detail for expensive fields.
- Do not compute `deliveryReadiness` for every task in the list hot path by default.
- Batch board, artifact, worktree, and codebase reads used by task-derived summaries.
- Cache codebase/worktree context inside a single `/changes` request instead of resolving it and then resolving it again inside `buildTaskDeliveryReadiness`.
- Prefer async process execution or an isolated worker boundary for git probes that can run on hot HTTP paths.
- Consider using the Rust/Axum backend for local-first Kanban APIs during development, or keep Next.js on a local DB when dogfooding queue-sensitive flows.

## 2026-04-09 Local Mitigation

Applied a minimal compatibility-preserving mitigation on the Next.js task list path:

- `GET /api/tasks?workspaceId=default` no longer computes `deliveryReadiness` by default.
- Callers can still request the legacy expanded behavior with `?expand=deliveryReadiness`.
- Single-task detail, status transition guards, ready-task APIs, and task changes APIs still compute delivery readiness.
- Task list serialization now uses a request-scoped view of codebases, worktrees, boards, and artifacts.
- Artifact stores now expose `listByWorkspace(workspaceId)` so the task-list path can summarize task artifacts without one query per card.

Hot-reloaded local measurement on the same Next dev server:

| Request | Observed time after mitigation |
|---|---:|
| `GET /api/tasks?workspaceId=default` | `0.033s` to `0.112s` |
| `GET /api/tasks?workspaceId=default&expand=deliveryReadiness` | `14.89s` |
| `GET /api/tasks/{id}/changes`, with no expanded task-list request ahead of it | `1.83s` |

That confirms delivery-readiness fan-out was the task-list head-of-line blocker in the sampled workspace.

## 2026-04-09 Slow API Sensor

Added route-level timing to the affected Next.js task APIs:

- `GET /api/tasks`
- `GET /api/tasks/{taskId}`
- `GET /api/tasks/{taskId}/changes`

Each response now includes `Server-Timing: routa-route;dur=...`, `x-routa-route`, and `x-routa-route-duration-ms`.

Requests slower than `ROUTA_SLOW_API_THRESHOLD_MS` are recorded to:

```text
~/.routa/projects/<project-slug>/runtime/slow-api-requests.jsonl
```

The default threshold is `1000ms`. Set `ROUTA_API_TIMING_LOG_ALL=1` while dogfooding to record every monitored task API request.

## Fitness Follow-Up

Existing performance fitness lives in `docs/fitness/runtime/performance.md`, but the current `web_route_performance_smoke` is a page/navigation smoke. It does not assert task API latency or task-list payload/derivation budgets.

Add a `task_api_latency_probe` after the API shape is fixed. Suggested advisory budgets:

| Probe | Target budget |
|---|---:|
| `GET /api/tasks?workspaceId=<fixture>` lean list | p95 `< 1000ms` on local fixture |
| `GET /api/tasks/{id}` detail hydration | p95 `< 1000ms` on local fixture |
| `GET /api/tasks/{id}/changes` with one small committed change | p95 `< 1000ms` on local fixture |
| Task list payload for 25 cards | `< 250KB` unless explicitly expanded |

The probe should run against deterministic fixture data instead of the developer's real remote Neon database.

## Relevant Files

- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/tasks/[taskId]/changes/route.ts`
- `src/core/kanban/task-derived-summary.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/git/git-utils.ts`
- `docs/fitness/runtime/performance.md`
