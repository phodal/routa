---
title: How Routa Works
---

# How Routa Works

Routa is a workspace-first coordination layer for software delivery. It does not treat the
product as a single long-running chat. Instead, it keeps execution attached to explicit
product objects and workflow boundaries.

## The Core Loop

At a high level, Routa works like this:

1. You enter a workspace.
2. You make one provider available.
3. You attach a repository or codebase.
4. You start work through `Session`, `Kanban`, or `Team`.
5. Routa records execution state, delegates to specialists when needed, and keeps the work
   recoverable.

## The Main Product Objects

- `Workspace`: the top-level scope for codebases, sessions, tasks, notes, and automation
- `Provider`: the runtime that can execute work
- `Session`: the default single-thread-first execution mode
- `Kanban`: the workflow-driven mode with lane automation and quality gates
- `Team`: the lead-driven mode for multi-specialist coordination
- `Specialist`: a role-focused agent profile used by the system

## What Makes Routa Different

Routa starts orchestration from product structure rather than from one universal chat window:

- `Sessions` start from one recoverable execution thread
- `Kanban` starts from workflow state and lane transitions
- `Team` starts from a coordinating lead that dispatches child work

That means the product can preserve context, state, and execution intent in a way that is more
operable than freeform prompting alone.

## Read Next

- [Execution Modes](/design-docs/execution-modes)
- [Use Routa](/use-routa)
- [Architecture](/ARCHITECTURE)
