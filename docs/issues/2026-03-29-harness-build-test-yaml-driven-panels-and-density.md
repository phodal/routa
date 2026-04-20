---
title: "Harness build/test feedback loops should be YAML-driven and visually compressed"
date: "2026-03-29"
status: resolved
severity: medium
area: "ui"
tags: ["harness", "build", "test", "yaml", "density", "governance-loop"]
reported_by: "codex"
related_issues: [
  "docs/issues/2026-03-29-harness-governance-loop-missing-build-metadata.md",
  "docs/issues/2026-03-29-harness-governance-loop-panel-orchestration-gap.md",
  "docs/issues/2026-03-28-harness-governance-loop-semantic-drift.md"
]
github_issue: 250
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/250"
resolved_at: "2026-03-30"
resolution: "Resolved by adding checked-in build/test harness surface contracts and wiring compact repo-signal panels into the Harness governance experience."
---

# Harness 的 build / test 反馈环仍然缺少稳定配置源，而且 UI 密度过高

## What Happened

在 `http://localhost:3000/settings/harness?workspaceId=default` 中，`构建` 和 `测试` 反馈环目前没有像 hook runtime / review trigger / execution plan 那样的稳定、可审阅配置源。

这两个维度如果直接从仓库文件系统做启发式推断，最终呈现会受当前仓库结构影响，难以形成长期稳定的 harness surface，也不利于后续让 agent 或人工维护。

同时，当前 Harness 页面已经叠加了：

- Governance loop 大图
- Instruction file 面板
- Hook system 面板
- Review trigger 面板
- Fitness files / execution surfaces

页面纵向长度和单卡片内容密度都偏高。即使 `build` / `test` 面板接入真实信号，如果继续沿用当前“完整 inspector”风格，也会进一步拉长页面，削弱治理图右侧上下文面板的作用。

## Expected Behavior

`build` 和 `test` 应该像其他 Harness 维度一样，先沉淀为显式配置，再由 UI 消费：

- `docs/harness/build.yml`
- `docs/harness/test.yml`

这两个文件应该成为 build / test feedback loop 的权威描述层，至少明确：

- 展示哪些入口命令
- 哪些 config / manifest / artifact 被视为该环的关键证据
- 哪些分组在 compact UI 中默认展开或折叠
- 哪些内容应该在治理图右侧只显示摘要，哪些才进入完整页面卡片

在 UI 上，`build` / `test` 需要采用比当前 Hook system / Review trigger 更紧凑的布局：

- 默认只显示 3 到 5 个高信号摘要槽位，而不是完整长列表
- 把大量脚本和文件路径收纳到分组 capsule、折叠区或二级 drill-down
- 在 governance loop 的 compact context 中优先显示“stage identity + evidence summary + 关键入口”，而不是整块 inspector

## Reproduction Context

- Environment: web
- Trigger: 打开 `http://localhost:3000/settings/harness?workspaceId=default`，观察 `Governance loop` 右侧上下文面板，以及页面中各个 harness surface 的累计纵向长度

## Why This Might Happen

- 目前 harness 的成熟 surface 主要集中在 fitness / hooks / review / workflows，`build` 与 `test` 还没有对应的 checked-in config contract。
- 页面已经先完成了“把已知 surface 拆成独立面板”，但还没有建立统一的“compact summary vs full detail”信息分层。
- governance loop 的节点详情目前是按组件复用切换的，导致任何完整面板接到右侧 context 后都会显得过长。
- 仓库里没有找到独立的 Harness build/test mockup 文件，说明这一块可能还停留在实现阶段，而不是先有稳定设计契约。

## Relevant Files

- `src/app/settings/harness/page.tsx`
- `src/client/components/harness-governance-loop-graph.tsx`
- `src/client/components/harness-hook-runtime-panel.tsx`
- `src/client/components/harness-review-triggers-panel.tsx`
- `src/client/components/harness-execution-plan-flow.tsx`
- `src/client/hooks/use-harness-settings-data.ts`
- `src/app/api/harness/hooks/route.ts`
- `docs/issues/2026-03-29-harness-governance-loop-missing-build-metadata.md`
- `docs/issues/2026-03-29-harness-governance-loop-panel-orchestration-gap.md`

## Observations

- 当前页面截图已记录在本地会话产物：`/tmp/harness-settings.png`

## Deduplication Note

`2026-03-29-harness-governance-loop-missing-build-metadata.md` is now treated
as a narrower symptom of this broader build/test harness issue rather than a
separate active tracker.
- `2026-03-28-harness-governance-loop-semantic-drift.md` is also treated as a
  narrower governance-loop presentation symptom inside the same broader harness
  surface family.
- 当前屏幕首屏已经同时呈现 governance graph 与 instruction file 的大块内容，首屏以下还会继续堆叠 Hook system、Review triggers、Fitness files 等区块。
- `build` 与 `test` 比 `review` 更需要“摘要化”，因为它们天然会带来 scripts、config、artifact、coverage、reports 等多组内容。
- 如果后续直接把 repo heuristics 暴露给 UI，很容易把 `package.json`、`Cargo.toml`、`vitest.config.ts`、`playwright.config.ts`、`coverage/` 等全部平铺出来，进一步放大页面长度问题。

## References

- `http://localhost:3000/settings/harness?workspaceId=default`
