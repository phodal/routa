---
title: "Generic trace-learning session analysis foundation for provider-agnostic transcript ingestion"
date: "2026-04-17"
kind: issue
status: resolved
severity: medium
area: "trace-learning"
tags: ["trace-learning", "sessions", "codex", "feature-tree", "normalization", "rust"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-12-harness-monitor-task-tracking-from-codex-hooks.md"
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
  - "https://github.com/phodal/routa/issues/294"
github_issue: 478
github_state: closed
github_url: "https://github.com/phodal/routa/issues/478"
resolved_at: "2026-04-20"
resolution: "Acceptance criteria implemented via the generic session-normalization foundation introduced in commit 832c71fe and evolved into the current trace-parser + feature-trace split."
---

# Generic trace-learning session analysis foundation for provider-agnostic transcript ingestion

## What Happened

Routa already has multiple transcript and trace surfaces, but the current Rust-side transcript parsing is still implementation-specific:

- `crates/harness-monitor` contains Codex-specific transcript backfill logic
- existing trace-learning in `routa-cli` is focused on harness evolution playbooks rather than general session analysis
- there is not yet a reusable Rust library that can normalize session transcripts from different agent providers into one extensible model

This makes it hard to support feature-linked session management such as:

- grouping sessions by page/API surface from `docs/product-specs/FEATURE_TREE.md`
- comparing session patterns across providers
- promoting transcript evidence into broader trace-learning pipelines

## Expected Behavior

Routa should have a generic Rust foundation for session analysis that:

- models normalized session transcripts independent of Codex-specific JSONL shape
- allows provider adapters to parse their own transcript formats into one shared domain model
- can extract changed files, prompts, tool usage, and other reusable evidence from normalized sessions
- can map changed files onto product surfaces such as pages and APIs

## Reproduction Context

- Environment: both
- Trigger: analyzing local `~/.codex/sessions` to evaluate a new feature-tree-based session management model showed that the current parser logic is not reusable enough for broader trace-learning goals

## Why This Might Happen

- Codex transcript parsing currently lives inside a product-specific observer path instead of a reusable crate
- trace-learning evolved first around harness playbooks, not around provider-agnostic session normalization
- the codebase lacks a stable intermediate model between raw transcript events and higher-level playbook generation / feature attribution
- feature-linked session analysis currently depends on ad hoc scripts rather than a durable Rust library boundary

## Relevant Files

- `docs/product-specs/FEATURE_TREE.md`
- `crates/harness-monitor/src/observe/codex_transcript.rs`
- `crates/routa-cli/src/commands/harness/engineering/learning.rs`
- `crates/trace-learning/`

## Observations

- Local Codex session JSONL already contains enough signal to recover session metadata, user prompts, tool calls, and file-change evidence.
- The same evidence could support broader trace-learning use cases if it were exposed through a provider-agnostic library boundary.
- Feature-tree-linked session management likely needs many-to-many attribution: one session can touch multiple surfaces, and one surface can aggregate many sessions.

## Resolution

- A dedicated Rust normalization boundary exists in the current `trace-parser` crate, which exports `NormalizedSession`, provider adapters, and `AdapterRegistry`.
- Codex transcripts are parsed through `CodexSessionAdapter` into the shared model.
- Feature-surface and feature-tree attribution now live in the companion `feature-trace` crate and are consumed from `trace-parser` and `routa-server`.
- Unit tests covering transcript parsing and feature-surface mapping pass in the current tree (`cargo test -p trace-parser -p feature-trace`).

## References

- https://github.com/phodal/routa/issues/478
- https://github.com/phodal/routa/issues/294
