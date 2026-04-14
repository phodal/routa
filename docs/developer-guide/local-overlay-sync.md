---
title: Local Overlay And Upstream Sync
---

# Local Overlay And Upstream Sync

This guide is for teams or agents who run Routa locally, need a few local-only fixes or
operating tweaks, and still want upstream updates to remain easy.

The goal is simple:

- keep `upstream/main` as the clean source of truth
- keep local-only behavior in one thin overlay branch
- keep one clean working copy for daily pulls, checks, and comparisons

This avoids the common failure mode where a long-lived feature branch, several temporary
worktrees, and uncommitted local changes all become mixed into the same "real" environment.

## When To Use This Pattern

Use this pattern when all of the following are true:

- you run Routa in your own environment
- you need local behavior that is not yet in upstream
- you still plan to keep pulling upstream updates
- agents or operators may open local fixes and upstream PRs from the same machine

Do **not** use this pattern for one-off throwaway experiments. It is for local deployments that
need to stay upgradeable.

## Recommended Branch Model

Use three lanes with clear roles:

1. `upstream/main`
   - fetch only
   - never carry local-only edits
2. `local/routa-overlay-*`
   - the only long-lived branch for local-only behavior
   - rebased onto `upstream/main` when upstream changes
3. temporary issue or PR branches
   - used for isolated bugfixes, experiments, or upstream contributions
   - deleted after merge or rejection

The important rule is that local-only behavior should not live in your default daily branch and
should not stay uncommitted in the main worktree.

## Recommended Working Copy Layout

Keep two persistent working copies:

- one **clean main worktree** pinned to the latest `upstream/main`
- one **overlay worktree** for `local/routa-overlay-*`

Use the clean worktree for:

- pulling upstream
- checking whether upstream already fixed a bug
- reproducing behavior without local patches
- preparing upstream-facing PRs

Use the overlay worktree for:

- local runtime fixes
- local operator workflow changes
- environment-specific behavior you intentionally keep outside upstream

Temporary PR branches can live in short-lived worktrees and should be removed after use.

## How To Capture Local Changes

When you discover local changes that must survive future updates:

1. stop adding more uncommitted edits to the default worktree
2. classify the changes:
   - upstreamable fix
   - local-only runtime behavior
   - local machine state that should not be committed
3. move only the local-only code or docs into `local/routa-overlay-*`
4. commit them in small, reviewable commits

Do not commit:

- databases
- logs
- caches
- runtime state
- secrets
- `.env` files
- machine-local temporary directories

If a change is upstreamable, prefer opening a separate PR branch instead of folding it into the
overlay.

## How To Sync With Upstream

Use this flow every time upstream changes:

```bash
git fetch upstream
git switch main
git reset --hard upstream/main
git switch local/routa-overlay-YYYY-MM-DD
git rebase upstream/main
```

After the rebase:

- resolve only overlay-specific conflicts
- rerun the checks needed for the rebased overlay
- shrink or drop overlay commits when upstream has absorbed them

If upstream already contains the same fix, do not keep a duplicate local patch just because it was
created earlier.

## How To Prepare An Upstream PR

When a local fix should go upstream:

1. start from the clean `upstream/main` worktree
2. create a temporary branch for the fix
3. keep the PR scope minimal
4. verify only the checks needed for that scope
5. push to your fork
6. open the PR

Before opening the PR, check whether upstream already solved the same problem:

```bash
git fetch upstream
git log --oneline upstream/main..HEAD
gh api repos/<upstream-owner>/<repo>/compare/main...<your-fork-owner>:<branch>
```

If compare says there are no meaningful commits to contribute, do not open a duplicate PR.

## Agent Operator Checklist

If you use agents to manage the local Routa checkout, keep these rules explicit:

- one clean upstream worktree must always exist
- one overlay branch must be the only long-lived local patch layer
- PR work must happen on temporary branches, not on the overlay branch
- machine-local state must never be included in a PR
- before opening a PR, agents must check whether upstream already fixed the issue
- after upstream accepts a fix, agents should remove or shrink the matching overlay patch

This keeps local self-hosted usage and upstream collaboration compatible instead of competing with
each other.
