---
title: "Add ReasoningBank-style strategy memory for agent experience learning"
date: "2026-04-25"
kind: issue
status: open
severity: medium
area: "agent-memory"
tags:
  - agent-memory
  - trace-learning
  - kanban
  - task-adaptive-harness
  - reasoning-bank
  - agent-experience
reported_by: "codex"
github_issue: 535
github_state: open
github_url: "https://github.com/phodal/routa/issues/535"
related_issues:
  - "docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-22-save-jit-context-minimal-result-persistence.md"
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
references:
  - "https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/"
  - "https://arxiv.org/abs/2509.25140"
  - "https://github.com/google-research/reasoning-bank"
---

# Add ReasoningBank-style strategy memory for agent experience learning

## What Happened

Google Research's ReasoningBank work describes an agent memory loop that distills reusable reasoning strategies from both successful and failed trajectories, then retrieves those strategy memories before future tasks.

Routa already has several adjacent capabilities:

- workspace-scoped traces and session history
- task-adaptive history memory for matching files, sessions, and feature context
- saved `jitContextSnapshot.analysis` through `save_history_memory_context`
- learned playbooks derived from repeated run outcomes
- Kanban lane sessions, handoffs, recovery reasons, and review convergence signals

However, Routa does not yet have a first-class strategy memory layer that captures lessons such as:

- what reasoning shortcut helped a task converge
- what failed path should be avoided next time
- which verifier or handoff signal should be checked before acting
- how repeated dev/review or backlog/todo loops should change future agent behavior

The current memory surfaces are mostly context-entry and tool-flow oriented. They help agents know where to look, but they do not consistently teach agents how to reason from prior success and failure.

## Expected Behavior

Routa should provide a workspace-scoped Reasoning Bank / Experience Bank that stores compact, prompt-ready strategy memories derived from agent runs.

Each memory item should be human-readable and machine-usable, with a minimal shape similar to:

- `title`
- `description`
- `content`
- `outcome`: `success`, `failure`, or `mixed`
- `sourceTaskIds`
- `sourceSessionIds`
- `tags`: features, files, routes, APIs, lanes, providers
- `confidence`
- `evidenceCount`

Before a Kanban/ACP agent starts a task, Routa should retrieve the top 1-3 relevant strategy memories and inject them separately from existing `Relevant History Memory`.

## Why This Matters

Without strategy memory, agents can still repeat expensive failure modes even when Routa has all the evidence needed to prevent them:

- repeated broad repo scans after a prior session already identified the correct surface
- review agents guessing runtime setup instead of requesting lane handoff
- dev agents rerunning the same failing command without interpreting the failure signal
- backlog/todo loops caused by missing contract fields that previous tasks already exposed

ReasoningBank's core product lesson is that failures are not just bad runs; they are high-value counterfactual data for future guardrails.

## Proposed Direction

### M0: Lightweight Spike

Add a small TypeScript-only Reasoning Memory domain and use it in Kanban task prompts.

Suggested scope:

- store candidate strategy memories in workspace/task storage or a local JSON-backed service
- retrieve by workspace, repo path, feature/file hints, route/API hints, lane, provider, and text overlap
- render a new prompt section such as `## Relevant Strategy Memory`
- keep top-k low to avoid noisy prompt bloat
- add characterization tests around retrieval and prompt rendering

### M1: Closed Loop

Add a dedicated extraction/save path:

- `search_reasoning_memories`
- `save_reasoning_memory`
- `promote_session_to_reasoning_memory`
- optional `consolidate_reasoning_memories`

The extractor should prefer deterministic signals first:

- tests and verification verdicts
- task lane session status
- review result
- recovery reason
- trace errors and failed tool calls

LLM-as-judge can summarize and classify the lesson, but should not be the only success/failure signal.

### M2: Memory-Aware Scaling

Use Routa's multi-agent and Kanban automation model to support ReasoningBank-style scaling:

- parallel scaling: multiple candidate sessions for a high-risk card, then contrast successful and failed paths
- sequential scaling: watchdog retry / Ralph loop / review bounce produces refinement history that is distilled into memory
- memory feedback: high-confidence strategy memories bias later retries and future similar tasks

## Acceptance Criteria

- A task can receive both context memory and strategy memory without conflating the two.
- At least one failed or recovered Kanban lane session can be converted into a preventative strategy memory.
- Retrieval is workspace-scoped and respects repo/feature/file hints.
- Prompt injection is bounded to a small number of high-confidence items.
- Existing `TaskJitContextAnalysis` and learned playbook behavior continue to work.
- Web and desktop domain semantics are documented before adding public API surface.

## Relevant Files

- `docs/ARCHITECTURE.md`
- `src/core/models/task.ts`
- `src/core/kanban/context-preload.ts`
- `src/core/kanban/agent-trigger.ts`
- `src/core/trace/trace-playbook.ts`
- `src/core/trace/run-outcome.ts`
- `src/core/orchestration/orchestrator.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `crates/routa-core/src/trace/`
- `crates/routa-server/src/api/`

## Notes

Do not reuse `/api/memory` for this feature; that endpoint currently represents runtime memory monitoring. Use an explicit product/domain name such as `reasoning-memory`, `experience-memory`, or `reasoning-bank`.

Do not store private chain-of-thought. Store concise operational rationale, evidence-backed lessons, and preventative guidance.
