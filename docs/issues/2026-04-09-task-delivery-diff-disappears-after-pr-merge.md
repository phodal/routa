---
title: "Task delivery diff disappears after PR, merge, or base-branch sync"
date: "2026-04-09"
status: open
severity: high
area: "kanban"
tags: ["kanban", "task-changes", "git", "pull-request", "delivery-evidence"]
reported_by: "human"
related_issues:
  - "docs/issues/2026-04-07-task-changes-api-performance.md"
  - "docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md"
---

# Task delivery diff disappears after PR, merge, or base-branch sync

## What Happened

The Kanban card detail `Changes` tab can correctly show committed task changes before delivery. In the observed card, the tab displayed:

- a committed implementation commit,
- 5 changed files,
- a committed-change summary relative to `origin/main`,
- and no local worktree changes.

After the implementation is submitted through PR, merged, fast-forwarded, or otherwise synchronized with the base branch, the same task can stop showing the changed files. The work appears to have "no diff" even though the task had a delivered commit and reviewable implementation.

## Expected Behavior

A completed or reviewable task should keep showing the code evidence that was delivered for that task.

The card should distinguish:

- **Task delivery changes**: the frozen commit / PR / base-to-head range that implemented the task.
- **Current worktree changes**: the live staged, unstaged, or ahead-of-base state of the task worktree.

Merging a PR or updating `origin/main` should not erase the task's delivery evidence from the card detail.

## Reproduction Context

- Environment: web / desktop
- Trigger:
  1. Move a task through development and commit the implementation on its worktree or feature branch.
  2. Open the card detail `Changes` tab and observe the committed changes list.
  3. Create / submit a PR, merge it, sync the base branch, fast-forward the worktree, or clean up the worktree.
  4. Reopen the same card detail.

Observed screenshot context on 2026-04-09:

- Card title: `[Sub-issue] 为 GATE-first 专家提示注入单次 trace 状态摘要`
- UI displayed committed commit `e3e5fe67`
- UI displayed 5 changed files before the concern was raised

## Why This Might Happen

The current task changes endpoint derives committed changes from the task's **current repository state**.

`GET /api/tasks/[taskId]/changes` builds delivery readiness, then asks Git for commits in the moving range:

```text
<deliveryReadiness.baseRef>..HEAD
```

This is appropriate for "is the branch currently ahead of base?", but it is not a stable delivery record.

Likely disappearing-diff paths:

- The task's implementation commit is merged to `origin/main`, so `origin/main..HEAD` becomes empty.
- The task worktree is reset, removed, switched, or fast-forwarded after PR work.
- `deliveryReadiness.baseRef` is resolved again after base has advanced to include the task's commit.
- The UI only has commit rows returned by the live `/changes` response, so it has no persisted commit SHA list to fall back to.
- The per-commit diff endpoint can still load `git show <sha>` when the SHA is known, but the card no longer lists that SHA after the live range goes empty.

## Proposed Product Direction

Persist a task-level delivery snapshot when a task enters review, reaches done, starts PR handoff, or successfully opens a PR.

The snapshot should use immutable Git identifiers, for example:

```ts
interface TaskDeliverySnapshot {
  baseRef?: string;
  baseSha: string;
  headSha: string;
  commitShas: string[];
  prUrl?: string;
  prNumber?: number;
  changedFiles?: Array<{
    path: string;
    previousPath?: string;
    status?: string;
    additions?: number;
    deletions?: number;
  }>;
  capturedAt: string;
}
```

The `Changes` tab should prefer the snapshot for the "Task delivery changes" section, then separately show the live worktree / staged / unstaged / ahead-of-base status.

## Relevant Files

- `src/app/api/tasks/[taskId]/changes/route.ts`
- `src/app/api/tasks/[taskId]/changes/commit/route.ts`
- `src/app/workspace/[workspaceId]/kanban/components/kanban-task-changes-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-diff-preview.tsx`
- `src/core/git/git-utils.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/models/task.ts`
- `src/app/workspace/[workspaceId]/types.ts`

## Observations

Relevant current implementation:

- `src/app/api/tasks/[taskId]/changes/route.ts` calls `buildTaskDeliveryReadiness(task, system)`.
- It returns committed changes only when `deliveryReadiness.hasCommitsSinceBase` and `deliveryReadiness.baseRef` are truthy.
- `src/core/git/git-utils.ts` implements `getRepoCommitChanges()` as `git log <baseRef>..HEAD`.
- `src/app/api/tasks/[taskId]/changes/commit/route.ts` loads a selected commit diff by explicit SHA.

This means the existing UI has enough machinery to render a stable commit if the card stores or can recover the SHA.

## References

- User report from dogfood screenshot on 2026-04-09.
