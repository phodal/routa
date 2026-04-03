---
title: "Fluency settings page mixes configuration, conclusions, and debug payloads into one overloaded surface"
date: "2026-03-29"
status: resolved
resolved_at: "2026-03-30"
severity: medium
area: "ui"
tags: ["fluency", "settings", "ux", "dx", "information-architecture", "fitness"]
reported_by: "codex"
related_issues: [
  "docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md"
]
---

# Fluency 设置页同时承载配置、结论和调试载荷，导致首屏认知负担过高

## What Happened

在 `http://localhost:3000/settings/fluency?workspaceId=default` 中，Fluency 页面把以下内容放在了同一个首屏工作区里：

- Profile 选择
- 执行按钮与运行模式
- 结果摘要
- 细粒度 capability hotspots
- 阻塞项与推荐动作
- Console transcript
- 原始 JSON

页面虽然功能完整，但缺少清晰的主线，用户进入后很难快速判断：

- 当前结论是什么
- 为什么是这个结论
- 下一步应该执行哪个动作
- Console / Raw JSON 什么时候才需要看

同时，页面使用了大量实现侧术语和状态，如 `Agent-Centric`、`Readiness`、`Sibling`、`Evidence packs`、`Experimental / unreliable`、`Console: N/A`。这些字段在没有解释层的情况下直接出现在首屏，削弱了可理解性和结果可信度。

## Expected Behavior

Fluency 页面应该优先呈现一条清晰工作流：

- 先选择 profile 与 mode
- 再触发运行或读取快照
- 首屏优先展示结论、阻塞原因和推荐动作
- Console / Raw JSON 下沉为高级调试区，而不是与结论区同级竞争注意力

页面应能在首屏回答三件事：

- 当前 maturity level 是什么
- 卡在什么 blocker 上
- 下一步最值得做的动作是什么

## Reproduction Context

- Environment: web
- Trigger: 打开 `http://localhost:3000/settings/fluency?workspaceId=default`，观察首屏布局、状态文案、Profile 选择、执行区、Views 区，以及 `Console` / `原始 JSON` 在主导航中的地位

## Why This Might Happen

- 页面实现目前更接近内部诊断台，把所有可用信号直接暴露出来，还没有建立“结果摘要 vs 高级调试”的信息分层。
- `fitness-analysis-panel` 把 profile 选择、执行配置、视图切换和结果摘要都聚合在同一个组件里，导致主工作流和辅助工作流之间没有明显边界。
- 视图定义沿用了实现层对象结构，`Console` 和 `Raw JSON` 因而被提升到了主视图层级。
- 文案更多是在描述底层数据字段，而不是帮助用户理解结果和下一步动作。

## Relevant Files

- `src/app/settings/fluency/fluency-settings-page-client.tsx`
- `src/client/components/fitness-analysis-panel.tsx`
- `src/client/components/fitness-analysis-content.tsx`
- `src/client/components/fitness-analysis-types.ts`

## Observations

- 页面首屏已有明确的 repository 上下文，但结果摘要仍然需要用户自己从多个 capsule 中拼出来。
- `运行当前 Profile`、`同时运行两套`、`刷新快照` 当前权重接近，但它们服务的是不同操作意图。
- `Raw JSON` 当前可直接在首屏切入，说明高级调试信息还没有被折叠到二级路径。
- 当前 live 页面截图和检查结果来自本地会话中的 `agent-browser` 走查。

## References

- `http://localhost:3000/settings/fluency?workspaceId=default`

## Resolution

This issue is resolved in the current codebase.

Evidence in current implementation:

- `src/app/settings/fluency/fluency-settings-page-client.tsx` now renders the
  page as a repo selector plus a single `FitnessAnalysisPanel`, without the
  old overloaded multi-surface shell.
- `src/client/components/fitness-analysis-panel.tsx` is now summary-first:
  it shows one hero summary, direct run/refresh actions, the capability matrix,
  the dashboard, and a single `overview` content view.
- `src/client/components/fitness-analysis-types.ts` no longer exposes
  `Console` or `Raw JSON` as primary page views. The available view modes are
  `overview`, `capabilities`, `recommendations`, and `changes`.
- `src/client/components/__tests__/fitness-analysis-panel.test.tsx` contains a
  focused regression test,
  `surfaces a summary-first workflow without advanced debug views`, which
  asserts that `Report Controls`, `Mode`, and `Views` are absent from the new
  surface.
- `src/client/components/__tests__/fitness-analysis-content.test.tsx` verifies
  the new `overview` inspector, including current findings and recommended
  actions, instead of a debug-first transcript surface.
