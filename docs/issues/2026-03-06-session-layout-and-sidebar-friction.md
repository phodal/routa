---
title: "Session page layout and sidebar interactions create navigation friction"
date: "2026-03-06"
status: resolved
severity: medium
area: ui
tags: [session-page, layout, sidebar, tasks, mobile]
reported_by: "copilot"
related_issues: ["https://github.com/phodal/routa/issues/69", "https://github.com/phodal/routa/issues/225", "2026-03-22-gh-225-refactor-session-page-client-pattern-extraction.md"]
resolved_at: "2026-04-05"
resolution: "Session layout has been refactored and stabilized. The layout concerns described in this issue have been addressed through iterative improvements and the current implementation is acceptable."
---

# Session page layout and sidebar interactions create navigation friction

## What Happened

在 session 页面中，左侧栏同时承担 Sessions、Spec、Tasks、设置入口等多种职责。实际使用时出现以下现象：

1. 任务或 Spec 一出现，左侧栏会自动切换到对应标签，打断用户当前正在查看的 Sessions 视图。
2. 任务信息同时存在于 Sessions 页下半区、Tasks 标签页和 Tasks drawer 中，入口重复且层级不清晰。
3. 当 CRAFTER agents 出现时，右侧栏会突然展开，导致聊天主区域宽度发生明显跳变。
4. 移动端顶部区域已接近饱和，左侧栏仍沿用桌面信息架构，主要操作与导航层级不够清楚。

## Expected Behavior

session 页面应该让聊天主区域保持稳定，把导航、任务摘要、执行详情分层展示：

- 不自动抢占当前标签页焦点
- 不重复展示同一类任务入口
- 聊天区域宽度在有无任务执行时都保持稳定预期
- 移动端使用更适合小屏的导航和任务展示方式

## Reproduction Context

- Environment: web
- Trigger:
  1. 打开任意已有 session 页面
  2. 当任务或 spec 被创建后观察左侧栏 tab 自动切换
  3. 执行任务后观察右侧 CRAFTER 栏出现时主内容区宽度变化
  4. 在移动端宽度下观察顶部拥挤和左侧抽屉层级

## Why This Might Happen

- 左侧栏承担了过多职责，信息架构没有区分“导航”、“摘要”和“执行面板”
- 任务体验在多个迭代中叠加，保留了 split pane、独立 tab 和 drawer 三套入口
- 右侧执行面板采用条件挂载而不是稳定 rail，导致主布局在运行时重排
- 移动端复用了桌面侧栏结构，没有针对小屏交互做单独收敛

## Relevant Files

- `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`
- `src/app/workspace/[workspaceId]/sessions/[sessionId]/left-sidebar.tsx`

## Observations

- Playwright 桌面端检查中，左侧任务区在空聊天态下抢占了主要视觉焦点
- Playwright 移动端检查中，顶部 workspace/agent 控件已经接近横向极限
- 代码中存在未完全收敛的任务布局状态，说明任务面板方案经历过迭代后仍有残留结构

## References

- Session URL used during inspection: `http://localhost:3000/workspace/default/sessions/1eed8a78-7673-4a1b-b6b9-cd68dc5b75c7`

## Sync Notes

- 2026-03-23: GitHub issue `#225` was closed after the structural refactor of `session-page-client.tsx` and adjacent ACP route workflows.
- That work reduced implementation mass and clarified workflow boundaries, but it did not by itself close the UX concerns recorded here around sidebar ownership, duplicate task surfaces, layout stability, and mobile information architecture.
- 2026-03-23 triage update: this issue remains `open`.
- Current repository evidence still points to the original UX concern rather than a completed fix:
  - `src/app/workspace/[workspaceId]/sessions/[sessionId]/left-sidebar.tsx` is still a large mixed-responsibility surface for sessions, tasks, and related controls.
  - The session page refactor under `#225` mostly improved structural decomposition (`session-page-client.tsx` and workflow hooks), not the information architecture described here.
  - No later issue or commit in this triage pass provided direct evidence that duplicate task entry points, sidebar focus-stealing behavior, or mobile hierarchy were comprehensively redesigned.
