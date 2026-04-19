---
title: Core Concepts Overview
---

# Core Concepts

Routa is not a single chat window with extra buttons around it. It is a workspace-first
coordination system for software delivery.

## The Product Model

The stable concepts to understand first are:

- `Workspace`: the top-level boundary for codebases, sessions, tasks, notes, and automation
- `Session`: a workspace-scoped execution thread backed by a provider
- `Kanban`: the board-driven coordination and lane automation surface
- `Team`: a coordinated multi-agent execution mode
- `Provider`: the runtime used to execute work through ACP or normalized adapters
- `Specialist`: a named role with specific responsibilities in the flow

## Best Next Reads

- [How Routa Works](/core-concepts/how-routa-works)
- [Use Routa](/use-routa)
- [Architecture](/ARCHITECTURE)
- [Execution Modes](/design-docs/execution-modes)
- [Architecture Decisions](/adr)
- [Providers & Models](/configuration/providers-and-models)

## Why This Section Exists

Getting started tells you how to run Routa. Core concepts tells you how to reason about it
once it is running.
