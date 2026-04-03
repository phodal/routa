---
title: "Harness execution plan should be visualized as a React Flow topology"
date: "2026-03-28"
status: resolved
resolved_at: "2026-03-28"
severity: medium
area: "ui"
tags: ["harness", "fitness", "react-flow", "execution-plan"]
reported_by: "codex"
github_issue: 241
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/241"
related_issues: ["https://github.com/phodal/routa/issues/241"]
---

# Harness Execution plan 需要改成 React Flow 执行拓扑

## What Happened

`/settings/harness` 当前的 `Execution plan` 还是静态 summary cards + dimension 列表。它能展示数量和 runner 分发，但不能解释 `Filter -> Dispatch -> Gates -> Report` 的执行路径，也不能把 dimension / metric / hard gate 之间的关系作为可交互拓扑展开。

## Expected Behavior

`Execution plan` 应该使用 node-based flow UI 呈现：

- 第一层：Execution Plan
- 第二层：Filter / Dispatch / Gates / Report
- 第三层：每个 dimension
- 第四层：每个 metric
- 边和节点需要表达 `hard / warn / pass / blocked` 等状态

## Reproduction Context

- Environment: web
- Trigger: 打开 `http://localhost:3000/settings/harness` 查看 `Execution plan`

## Why This Might Happen

- 现有实现按传统 inspector / summary panel 组织，适合看统计，不适合看路径。
- `PlanResponse` 数据已经天然是 node + edge 结构，但页面仍按线性列表消费。
- `Execution plan` 区块仍然直接写在 `src/app/settings/harness/page.tsx` 里，没有抽成专门的拓扑组件。

## Relevant Files

- `src/app/settings/harness/page.tsx`
- `src/app/api/fitness/plan/route.ts`
- `docs/fitness/manifest.yaml`
- `docs/fitness/*.md`

## Observations

- `PlanResponse` 已经包含 `dimensions`, `metrics`, `runnerCounts`, `hardGateCount`，足够驱动 React Flow。
- 页面已经有 repository / workspace / tier 上下文，不需要新增上游数据源。

## References

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/client/components/harness-execution-plan-flow.tsx` now renders the
  execution plan as a React Flow topology with nodes, edges, viewport fitting,
  and flow controls.
- The `PlanResponse` contract in that component carries the graph-oriented
  structure the issue originally requested: dimensions, metrics, runner counts,
  hard gates, and execution scope.
- `src/app/settings/harness/harness-console-page.tsx` uses
  `HarnessExecutionPlanFlow` both as a full panel and as an embedded compact
  view inside governance context flows.
