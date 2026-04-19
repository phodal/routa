---
title: Product IA Visualization
---

# Product IA Visualization

## Purpose

This document proposes a clear visual model for Routa.js product structure.
It is intended to make three things visible at the same time:

- what users can navigate to
- which product concepts are primary versus supporting
- how workspace-scoped coordination flows through the system

The diagrams below are aligned with the current workspace-first architecture and the generated route inventory in `docs/product-specs/FEATURE_TREE.md`.

## Design Principle

The visualization should not be a flat sitemap.
Routa.js is better explained as:

1. a workspace-first product
2. with a small set of stable navigation surfaces
3. backed by a richer coordination domain model

That means the best presentation is a layered view:

- Layer 1: navigation tree
- Layer 2: workspace information architecture
- Layer 3: key user journeys

## 1. Product Feature Tree

Use this diagram when explaining "what the product contains" at a glance.

```mermaid
mindmap
  root((Routa.js))
    Home
    Workspace
      Overview
      Sessions
        Session Detail
        Trace Context
        RepoSlide Result
      Kanban
        Boards
        Task Detail
        Agent Run
        Git Changes
        Workflow Actions
      Team
        Team Runs
        Team Session Detail
      Spec
        Issue Relations
        Local Tracker View
      Codebases
        RepoSlide
      Notes
      Activity
      Background Tasks
    Settings
      Agents
      MCP
      Harness
      Fluency
      Specialists
      Schedules
      Workflows
      Webhooks
      Fitness
    Protocol Surfaces
      ACP
      MCP
      A2A
      AG-UI
      A2UI
    Diagnostics
      Messages
      Traces
      MCP Tools
      ACP Replay
```

## 2. Workspace-Centric Information Architecture

Use this diagram when explaining the product model, not just the menu.

```mermaid
flowchart TD
    A[User] --> B[Workspace Switcher]
    B --> C[Selected Workspace]

    C --> D[Codebases]
    C --> E[Sessions]
    C --> F[Kanban Boards]
    C --> G[Team Runs]
    C --> H[Spec Board]
    C --> I[Notes]
    C --> J[Background Tasks]
    C --> K[Memory and Artifacts]

    D --> D1[Repo identity]
    D --> D2[Branch and metadata]
    D --> D3[Worktrees]
    D --> D4[RepoSlide]

    E --> E1[Live agent execution]
    E --> E2[History]
    E --> E3[Trace and review context]

    F --> F1[Tasks]
    F --> F2[Lane automation]
    F --> F3[Agent run metadata]
    F --> F4[Git and workflow actions]

    G --> G1[Multi-agent collaboration]
    G --> G2[Session drill-down]

    H --> H1[Issue clusters]
    H --> H2[Escalation paths]
    H --> H3[Docs and local issue links]

    J --> J1[Schedules]
    J --> J2[Workflow fan-out]
    J --> J3[Polling and async runs]

    K --> K1[Workspace knowledge]
    K --> K2[Structured outputs]
```

## 3. Primary Navigation Model

This is the most useful diagram for UI and IA discussions because it separates global navigation from workspace content depth.

```mermaid
flowchart LR
    A[Global Nav] --> A1[Home]
    A --> A2[Sessions]
    A --> A3[Kanban]
    A --> A4[Team]
    A --> A5[Harness]
    A --> A6[Fluency]
    A --> A7[Settings]

    A2 --> B[Workspace-scoped Sessions]
    A3 --> C[Workspace-scoped Kanban]
    A4 --> D[Workspace-scoped Team]

    B --> B1[Session list]
    B --> B2[Session detail]

    C --> C1[Board view]
    C --> C2[Task detail]
    C --> C3[Automation and git actions]

    D --> D1[Run list]
    D --> D2[Run detail]
```

## 4. Key User Journey

Use this when you want to show why the workspace is the product anchor.

```mermaid
flowchart LR
    A[Select Workspace] --> B[Choose Codebase]
    B --> C[Create or Open Task]
    C --> D[Run Agent Session]
    D --> E[Observe Trace and Outputs]
    E --> F[Promote Through Kanban]
    F --> G[Review Changes and Artifacts]
    G --> H[Coordinate in Team or Spec Views]
```

## Recommended Presentation

If this needs to become a single final visual for product reviews, present it in this order:

1. Product Feature Tree
2. Workspace-Centric Information Architecture
3. Key User Journey

That sequence explains:

- what exists
- how it is organized
- how users move through it

## Recommended Simplification For External Audiences

For external stakeholders, collapse the product into five top-level capability groups:

- Workspace Coordination
- Agent Execution
- Kanban Automation
- Team Collaboration
- Governance and Settings

This avoids over-indexing on protocol names and internal implementation detail.

## Notes

- Workspace should remain the primary visual anchor in all future IA diagrams.
- Codebase, session, and kanban are the three most important second-level product objects.
- Protocol surfaces such as ACP and MCP should be shown as enabling infrastructure, not peer-level user navigation.
- Some current routes still contain transitional `default` workspace behavior, but the target information architecture is explicitly workspace-scoped.
