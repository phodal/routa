---
title: "Harness governance loop is not orchestrated with sibling panels"
date: "2026-03-29"
status: resolved
resolved_at: "2026-03-30"
severity: medium
area: "ui"
tags: ["harness", "governance-loop", "orchestration", "react-flow"]
reported_by: "codex"
github_issue: 245
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/245"
related_issues: ["https://github.com/phodal/routa/issues/245"]
---

# Governance loop still behaves as an isolated graph instead of a page coordinator

## What Happened

`/settings/harness` 已经把 `Governance loop`、`Instruction file`、`Hook system`、`Execution plan`、`GitHub Actions flow` 拆成了独立区块，但 `Governance loop` 右侧详情仍然只是组件内部的摘要标签。

当前页面存在两个明显问题：

- `Governance loop` 自己再次请求 `hooks`、`github-actions`、`instructions`，没有与右侧其它 panel 共享状态。
- 用户点击 graph 节点时，右侧不能切换成真正对应的 panel 内容，只能显示局部 summary chips。

## Expected Behavior

`Governance loop` 应该成为 Harness 页面里各治理阶段的统一入口：

- 页面级容器统一拉取 harness 数据
- graph 节点选中态由页面层持有
- 右侧上下文区根据节点切换到真实 panel 内容或对应 graph
- `Execution plan` 能作为 `lint/review/test` 等阶段的子视图接入，而不是完全孤立的另一块

## Reproduction Context

- Environment: web
- Trigger: 打开 `http://localhost:3000/settings/harness?workspaceId=default`

## Why This Might Happen

- 现有重构只完成了展示层拆分，没有完成页面级 orchestration shell。
- `HarnessGovernanceLoopGraph` 仍然内部发请求，导致它只能做自包含图，而不能作为容器导航。
- sibling panels 没有共享 data model，也没有统一的 `selectedNodeId -> panel` 映射层。

## Relevant Files

- `src/app/settings/harness/page.tsx`
- `src/client/components/harness-governance-loop-graph.tsx`
- `src/client/components/harness-agent-instructions-panel.tsx`
- `src/client/components/harness-hook-runtime-panel.tsx`
- `src/client/components/harness-github-actions-flow-panel.tsx`
- `src/client/components/harness-execution-plan-flow.tsx`

## Observations

- 页面已经持有 repository / workspace / tier 上下文，适合作为 orchestration shell。
- `Execution plan` 和 `Governance loop` 都已经是 React Flow，可复用统一的节点上下文切换思路。
- 现有 API 已足够支撑重构，不需要新增后端接口。

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/app/settings/harness/harness-console-page.tsx` owns the shared
  repository/workspace/tier state and loads harness data once through
  `useHarnessSettingsData(...)`.
- The same page keeps `selectedGovernanceNodeId` at page scope and maps node
  selection to real sibling panels through `GOVERNANCE_NODE_SECTION_MAP` and
  `governanceContextPanel`.
- The bottom panel wiring now lets governance-node selection open compact
  `Context`, `Execution Plan`, and `Fitness` views instead of leaving the graph
  isolated.
- `src/client/components/harness-governance-loop-graph.tsx` now accepts
  `selectedNodeId` and `onSelectedNodeChange` props from the page shell instead
  of acting as a self-contained data island.
