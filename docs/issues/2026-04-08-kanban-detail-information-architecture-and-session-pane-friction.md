---
title: "Kanban detail information architecture and session pane friction"
date: "2026-04-08"
status: resolved
severity: medium
area: "ui"
tags: ["kanban", "detail-overlay", "session-pane", "ux"]
reported_by: "codex"
related_issues: []
---

# Kanban detail 信息架构和 session pane 交互摩擦

## What Happened

在 `workspace/default/kanban` 打开 card detail 后，详情面板的信息层级和右侧 session pane 的关系存在多处摩擦：

- split 状态下 detail 区域被压缩，`Runs` 视图不可见，而高频的执行信息仍然埋在 `Description` tab 内。
- 右侧按钮文案是 “Close session pane”，但点击后实际会关闭整个 card detail overlay，而不是只隐藏右侧 pane。
- `Description` tab 同时承载描述、review feedback、progress notes、test cases、execution、repo/worktree，导致纵向滚动过长，信息密度失衡。
- 标题和测试用例使用 `onBlur` 自动保存，但局部保存状态和失败反馈较弱，误触导致的写入不可见。

## Expected Behavior

- split 模式下，detail 仍然应该保留核心导航和 run history 的可见入口。
- “Close session pane” 应只影响右侧 session pane，不应关闭整个 detail。
- detail tab 应按阅读目标分组，让 spec、execution、evidence、runs 快速到达。
- 频繁编辑的字段应提供明确的保存反馈，避免无意保存。

## Reproduction Context

- Environment: web
- Trigger: 启动本地 `localhost:3000`，打开 `http://localhost:3000/workspace/default/kanban`，进入任意带 session 的 card detail

## Why This Might Happen

- 详情区是否 `compact` 直接由 session pane 是否存在决定，导致 split 布局承担了过多信息压缩责任。
- session pane 的关闭动作复用了整个 detail overlay 的关闭回调，语义和行为被混在一起。
- detail tab 的划分更接近“按实现组件拼接”，而不是“按用户任务组织”。
- 内联编辑优先追求低摩擦，但没有补足对应的保存状态设计。

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-activity.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`

## Observations

- 本地 walkthrough 中，session pane 先展示大量 tool-call / thinking 记录，高层 run summary 不够突出。
- split 模式下存在全屏按钮，但默认阅读路径仍然偏向“看右侧 session，而非先理解卡片状态”。
- 2026-04-08 fix landed:
  - detail tab 拆分为 `Overview / Story Readiness / Execution / Changes / Evidence Bundle / Runs`
  - split 模式保留 `Runs` tab
  - “Close session pane” 改为只隐藏右侧 pane，并在 detail header 提供 “Show session pane”
  - 标题与测试用例编辑补充显式保存/取消路径，减少误触保存

## References

- `http://localhost:3000/workspace/default/kanban`
