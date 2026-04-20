---
title: Git Workflow
---

# Git Workflow

Routa uses a strict baby-step commit model so changes stay reviewable and regressions stay
traceable.

## Commit Rules

- One commit should represent one concern: feature, fix, or refactor.
- Use Conventional Commits format.
- Do not mix unrelated changes into the same commit.
- Target a small blast radius: under `10` files and under `1000` changed lines per commit.
- Include the related GitHub issue ID when applicable.

## Working Rules

- Use a focused branch.
- Prefer issue-first work for non-trivial bugs or failures.
- Do not open a PR with unverified source changes.
- If public behavior, commands, or workflows change, update the docs in the same change set.
- If you also run a local self-hosted Routa with long-lived local patches, keep those patches in a dedicated overlay branch rather than in your default PR branch. See [Local Overlay And Upstream Sync](/developer-guide/local-overlay-sync).

## Pull Request Expectations

- Explain the user-visible change and the reasoning behind it.
- Include screenshots or recordings for UI changes.
- List the checks you ran.
- Link related issues when applicable.

## Where The Rules Come From

The canonical repository policy still lives in [AGENTS.md](https://github.com/phodal/routa/blob/main/AGENTS.md#git-discipline).
Use this page as the public summary and that file as the full rule source.
