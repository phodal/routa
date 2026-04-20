---
title: Common Workflows
---

# Common Workflows

These are the most common ways to use Routa once installation is done and one provider is
working.

## Understand A New Codebase

Use this path when you are entering an unfamiliar repository and want the fastest route to a
useful mental model.

1. Open a workspace and attach the repository.
2. Start with [Sessions](/use-routa/sessions).
3. Ask for a high-level overview before asking for implementation.
4. Move to [Core Concepts](/core-concepts/how-routa-works) if you need the product model, not
   just the repo structure.

Use this workflow when:

- you need orientation before changing code
- you want one recoverable thread
- the work is still exploratory

## Implement One Concrete Task

Use this path when the task is clear and does not need workflow stages yet.

1. Open a workspace.
2. Make one provider available.
3. Start a [Session](/use-routa/sessions).
4. Give Routa one concrete implementation request.
5. Review the result, then either keep iterating in the same session or start a fresh one.

This is the default path for:

- feature implementation
- bug fixing
- docs updates
- short codebase refactors

## Move Work Through Delivery Stages

Use this path when the work benefits from explicit backlog, dev, review, and done boundaries.

1. Open the workspace board.
2. Create or refine tasks.
3. Move cards through [Kanban](/use-routa/kanban) lanes.
4. Let stage transitions and lane policy drive the next execution step.

This is the right workflow when:

- multiple tasks share one delivery model
- you want review and done to behave like real gates
- handoff visibility matters more than one-thread convenience

## Coordinate Multi-Specialist Work

Use this path when the coordination problem is itself first-class.

1. Start [Team](/use-routa/team).
2. Pick the repo or workspace context carefully.
3. Let the lead delegate to specialists.
4. Review progress as coordinated child work rather than as one thread.

This is the best fit when:

- frontend, backend, QA, or operations concerns need separation
- multiple code areas need to move in parallel
- one main session would become too overloaded

## Adjust Setup Without Losing Momentum

Use this path when Routa is installed, but execution is blocked by configuration.

1. Open [Configuration](/configuration).
2. Make one provider available.
3. Add one model path only if your provider requires it.
4. Return to your workspace and continue with `Session`, `Kanban`, or `Team`.

Do not treat setup as a prerequisite checklist for every provider. One working path is enough.

## Read Next

- [Best Practices](/use-routa/best-practices)
- [Platforms](/platforms)
- [Reference](/reference)
