---
title: "Harness monitor auto full graph test-mapping can trigger repo-wide memory spikes"
date: "2026-04-21"
kind: issue
status: open
severity: high
area: harness-monitor
tags:
  - harness-monitor
  - entrix
  - test-mapping
  - graph
  - performance
  - memory
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-17-autoresearch-led-harness-fitness-speed-optimization.md"
github_issue: null
github_state: null
github_url: null
---

# Harness monitor auto full graph test-mapping can trigger repo-wide memory spikes

## What Happened

When `harness-monitor` is open on a repo with a small dirty set, it can automatically spawn `entrix graph test-mapping --json` in Full mode. In the current `routa-js` workspace this child process can climb above 10 GB private memory and continue consuming CPU until the machine runs out of memory or the process is killed.

The problem is visible even when `harness-monitor` itself stays small. Activity Monitor showed `harness-monitor` near tens of MB while its child `entrix` process grew to roughly 14 GB private memory and stayed near 100% CPU.

## Expected Behavior

Opening `harness-monitor` should not automatically trigger a repo-wide graph build that can exhaust local memory. Any expensive graph-aware enrichment should either stay within a bounded budget or require explicit opt-in.

## Reproduction Context

- Environment: desktop / local terminal
- Trigger: open `harness-monitor` on `routa-js`, let test-mapping warm from Fast to Full, then watch the spawned `entrix` child process in Activity Monitor

## Why This Might Happen

- `harness-monitor` currently upgrades Fast test-mapping to Full whenever dirty files stay under a count-based threshold, which is not a reliable proxy for whole-repo graph cost
- `entrix graph test-mapping` Full mode calls `parse_repo_graph(repo_root)`, which walks and parses the whole supported-language repo, not just changed files
- the graph builder derives edges with broad symbol-pair scans and stores large intermediate structures, so memory cost can rise sharply on larger repos
- the current test-mapping graph path appears to build a full graph and then query with `ReviewBuildMode::Skip`, so the expensive graph work may not even be consumed by the caller

## Relevant Files

- `crates/harness-monitor/src/ui/cache.rs`
- `crates/harness-monitor/src/ui/cache_test_mapping.rs`
- `crates/entrix/src/test_mapping.rs`
- `crates/entrix/src/review_context/analysis.rs`
- `crates/entrix/src/review_context/tree_sitter/mod.rs`
- `crates/entrix/src/review_context/tree_sitter/graph_builder.rs`

## Observations

- `graph_test_files_by_source()` in `crates/entrix/src/test_mapping.rs` currently calls `query_current_graph(..., ReviewBuildMode::Skip)`, which returns a skipped result rather than using the graph that was just built
- as an immediate mitigation, `harness-monitor` should not auto-upgrade to Full graph refresh by default until the graph path is both bounded and demonstrably useful
