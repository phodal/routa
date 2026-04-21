---
title: "Task-Adaptive Harness should hydrate history-session context just in time for the current task"
date: "2026-04-21"
kind: issue
status: open
severity: medium
area: harness
tags:
  - harness
  - kanban
  - sessions
  - context-hydration
  - just-in-time
  - task-adaptive-harness
  - mcp
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
  - "docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md"
github_issue: 515
github_state: open
github_url: "https://github.com/phodal/routa/issues/515"
---

# Task-Adaptive Harness should hydrate history-session context just in time for the current task

## What Happened

Routa already has enough local evidence to recover useful task context from prior sessions:

- history session JSONL transcripts can be normalized into changed files, prompt history, tool usage, and session diagnostics
- Feature Explorer can already attribute those signals back to selected files and feature surfaces
- ACP session creation already supports per-session specialist prompts and MCP tool-profile narrowing

However, that capability is still exposed mainly as an analysis path rather than an execution path.

Today, when a Kanban user wants to start a new requirement and reuse relevant prior work context, the system does not offer a first-class way to:

- retrieve the most relevant history sessions for the current task
- compile those signals into a focused context bundle
- inject that bundle into the new session automatically at session start
- adapt the visible tool surface based on the inferred task shape

The result is that context reuse is possible in pieces, but not yet productized as a task-start harness experience.

## Expected Behavior

Routa should expose a first-class `Task-Adaptive Harness` capability under the Harness umbrella.

Its concept boundary should be:

- `Task-Adaptive Harness`: product and architecture concept
- `Just-in-time context hydration`: runtime implementation mechanism

For a new Kanban or task-oriented session, the system should be able to:

- identify the current task scope from card, feature, file, or repo context
- retrieve relevant history-session evidence just in time
- compile a minimal task-scoped context pack rather than loading raw transcripts directly
- optionally adapt the MCP tool subset and provider-native tool access for that task
- inject the compiled pack into the session startup path

This should work as both:

- an automatic session-start path for task execution
- an explicit operator action, potentially via an MCP tool such as `assemble_task_adaptive_harness`

## Reproduction Context

- Environment: both
- Trigger: discussing how Kanban users could directly load relevant prior session context into a new implementation task showed that the current system has retrieval and analysis primitives, but not a first-class task-start harness abstraction

## Why This Might Happen

- history-session evidence currently lives mostly in trace/session-analysis flows rather than in a reusable task activation pipeline
- Feature Explorer already performs context assembly, but its output is designed for retrospective analysis rather than general session bootstrap
- MCP tool exposure is currently selected through coarse modes and static profiles, not by task-local evidence
- the current product vocabulary distinguishes harness, trace learning, and session analysis, but does not yet have a unifying concept for task-scoped adaptive startup
- AG-UI and ACP session startup flows do not yet consume a structured just-in-time context pack compiled from history sessions

## Relevant Files

- `crates/harness-monitor/AGENTS.md`
- `src/app/api/feature-explorer/shared.ts`
- `src/app/workspace/[workspaceId]/feature-explorer/session-analysis.ts`
- `src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx`
- `resources/specialists/tools/file-session-analyst.yaml`
- `src/app/api/acp/acp-session-create.ts`
- `src/core/acp/session-prompt.ts`
- `src/core/acp/mcp-config-generator.ts`
- `src/core/mcp/mcp-server-profiles.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/app/api/ag-ui/route.ts`

## Observations

- Feature Explorer already builds a high-signal session evidence bundle from history sessions, including prompt history, tool history, changed files, and diagnostics.
- The current session-analysis prompt explicitly tells the specialist to prefer supplied evidence first and only open raw transcript JSONL when necessary.
- ACP session creation already supports per-session `specialistId`, `systemPrompt`, `toolMode`, `mcpProfile`, and `allowedNativeTools`.
- MCP tool exposure already supports allowlist-based profiles, but those profiles are currently static and not compiled from task-local evidence.
- `AG-UI` already has a `context` field in its input contract, but the current route does not yet turn that into a real task-start context hydration path.
- The existing terminology is split across `trace learning`, `session analysis`, and `harness`; the proposed issue introduces `Task-Adaptive Harness` as the top-level concept and treats just-in-time hydration as one implementation strategy.

## References

- Local related issue: `docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md`
- Local related issue: `docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md`
