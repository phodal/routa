---
title: "Kanban lacks flow observability, controllability, and optimization primitives"
date: "2026-03-19"
status: open
labels:
  - Agent
  - kanban
  - observability
  - enhancement
---

# Kanban lacks flow observability, controllability, and optimization primitives

## What happened

Routa's Kanban is already strong at agent-native workflow execution:

- column transitions are interpreted by the system, not just rendered in the UI
- cards can trigger specialist automation
- tasks preserve lane session history and handoff history
- cards can bind to codebases, sessions, and git worktrees

However, compared with established Kanban practice for SDLC flow management, the board is still missing the operational primitives needed to understand and improve delivery flow.

The current implementation behaves more like an agent execution control plane than a flow-management system.

## Why this matters

Without explicit flow metrics and control mechanisms, the system can execute work but cannot reliably answer:

- where work is piling up
- which columns are overloaded
- which tasks are aging beyond expectation
- how much time is spent blocked
- whether delivery is becoming more or less predictable

That leaves a gap between "workflow is computable" and "workflow is governable and optimizable".

## Observed gaps

### 1. Missing first-class flow metrics

The task and board models do not expose first-class Kanban flow primitives such as:

- WIP by column / lane / board
- throughput by time window
- cycle time
- lead time
- work item age
- blocked time
- SLE attainment

### 2. Missing explicit control surfaces

The board supports automation and artifact requirements, but lacks explicit operational constraints such as:

- WIP limits per column
- lane-level capacity policies
- service classes
- age-based escalation rules
- SLE targets per work type or lane

### 3. Blocked state is not structured enough

Blocked transitions exist, but blocked work is not modeled with structured fields that support analysis and governance, such as:

- blocked reason
- blocked category
- blocked owner
- blocked since / unblocked at
- resolution summary

### 4. Gates are mostly presence checks

Current gate behavior mainly verifies artifact existence. It does not consistently enforce policy-level judgments such as whether verification actually passed.

### 5. UI lacks a flow dashboard

The workspace Kanban UI is strong for execution context and worktree/session operations, but it does not provide a dedicated flow view for:

- WIP vs limit
- aging items
- blocked distribution
- throughput trend
- cycle/lead time distribution
- cumulative flow
- SLE compliance

## Product impact

This limits Routa's positioning.

Today the product can credibly say:

- "the board is executable"
- "the workflow is agent-aware"

But it cannot yet fully say:

- "the flow is measurable"
- "the system can enforce pull discipline"
- "the board can show bottlenecks and predictability"

## Suggested direction

The next Kanban milestone should focus on adding:

1. a durable flow event model for board transitions and blocked/unblocked periods
2. explicit board/column control primitives such as WIP limits and SLE policies
3. structured blocked-state data
4. policy-based gates, not only artifact existence checks
5. a flow observability dashboard in the workspace UI

