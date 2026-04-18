---
title: "Fitness should support constrained React runtime canvas artifacts for analytical outputs"
date: "2026-04-16"
kind: issue
status: open
severity: medium
area: "fitness"
tags: ["fitness", "canvas", "react-runtime", "artifacts", "ui", "agent-output"]
reported_by: "copilot"
related_issues:
  - "docs/issues/2026-03-03-gh-54-a2ui-for-customize-dashboard.md"
  - "docs/issues/2026-03-28-harness-execution-plan-react-flow.md"
  - "docs/issues/2026-04-14-kanban-entrix-live-fitness-surface.md"
github_issue: 474
github_state: open
github_url: "https://github.com/phodal/routa/issues/474"
---

# Fitness should support constrained React runtime canvas artifacts for analytical outputs

## What Happened

Routa 的 Fitness 结果目前主要以三种形式出现：

- `entrix` / `routa-cli` 生成的 JSON / terminal / TUI 输出
- `/api/fitness/report` 与 `/api/fitness/analyze` 提供的结构化诊断结果
- `/settings/fluency`、`/settings/harness`、Kanban status 等页面中的面板式 UI

这些 surface 已经能展示结论，但还没有把“分析结果本身”提升成一个独立、可持久化、可交互的 artifact。用户如果要消费一次复杂的 Fitness 结论，仍然需要进入既有页面或阅读线性文本，而不是打开一个由 agent 产出的专用分析画布。

仓库里已经存在两条相邻但不同的路线：

- `#54` 讨论过 A2UI dashboard customization，但它更偏声明式 schema surface，不是 Cursor-style TSX canvas authoring。
- `#442` 讨论 Kanban 中实时显示 fitness 状态，但它关注 runtime status signal，不是新的分析产物运行时。

结果是：Routa 已经具备足够的 Fitness 数据模型和 artifact 存储基础，却没有一条“受限 React runtime + 编译后的 canvas + 持久化 artifact”链路，来承载 agent 生成的独立分析界面。

## Expected Behavior

Fitness 应该支持一种类似 Cursor Canvas 的受限 React runtime 产物模型：

- agent 生成受限 TSX source，而不是直接拼接任意页面代码
- source 被编译成单个可挂载 runtime artifact，并带上明确的 host contract
- canvas 可以消费 Fitness report / analyze 输出，并渲染成独立分析界面
- artifact 可以按 workspace / task / codebase 持久化、重开、比较，而不是只活在一次页面会话里
- runtime 保持组件白名单、host theme、错误上报、少量持久 state 等安全边界

这个能力应该首先服务于 `Fitness` / `Harness Fluency` / `Entrix` 的分析交付物，而不是一开始就泛化为整个产品的任意页面生成器。

## Reproduction Context

- Environment: both
- Trigger:
  1. 在当前代码库中运行或读取一次 `entrix` / `fitness fluency` 分析
  2. 打开 `/settings/fluency` 或相关 harness 页面查看结论
  3. 观察到当前系统只能通过既有 panel / dashboard surface 展示结果，无法把这次分析保存成一个独立的可交互 artifact

## Why This Might Happen

- 现有 `FitnessAnalysisPanel` 与 harness surfaces 面向“页面中的诊断区块”设计，而不是“agent 交付的独立产物”。
- A2UI 已经证明声明式 surface 可行，但它更适合 schema-based dashboard，不适合 TSX authoring + constrained component runtime 的 Canvas 模式。
- 当前 artifact store 已能保存结构化产物，但缺少专门的 canvas artifact type、source/bundle metadata 和 renderer contract。
- 现有 Fitness API 已经足够结构化，因此真正缺的不是数据，而是把数据提升为独立 analytical artifact 的运行时与持久化链路。

## Relevant Files

- `src/app/api/fitness/report/route.ts`
- `src/app/api/fitness/analyze/route.ts`
- `src/client/components/fitness-analysis-panel.tsx`
- `src/client/components/harness-fitness-files-dashboard.tsx`
- `src/client/components/harness-execution-plan-flow.tsx`
- `src/core/store/artifact-store.ts`
- `src/core/models/artifact.ts`
- `src/core/routa-system.ts`
- `src/client/a2ui/types.ts`
- `src/client/a2ui/renderer.tsx`

## Observations

- `Fitness` 的 report / analyze 输出已经具备维度、criteria、recommendations、comparison 等结构化字段，足以驱动专用 canvas。
- `artifactStore` 已经提供 workspace/task 级别的持久化抽象，这比把 canvas 只挂在临时页面状态里更符合产品语义。
- `HarnessExecutionPlanFlow` 说明仓库已经接受“图形化/专用渲染器用于分析结果”的方向，但目前仍是页面组件，不是 agent-generated artifact runtime。
- 最低风险的第一步不是替换既有 Fluency 页面，而是新增一条只读 canvas artifact pipeline，让 existing panel 与 canvas 并存。

## References

- `https://cursor.com/cn/blog/canvas`
- `https://github.com/phodal/routa/issues/54`
- `https://github.com/phodal/routa/issues/241`
- `https://github.com/phodal/routa/issues/442`