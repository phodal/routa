---
title: "Kanban should surface Entrix fitness state in real time"
date: "2026-04-14"
kind: issue
status: open
severity: medium
area: "kanban"
tags: ["kanban", "entrix", "fitness", "realtime", "ui", "observability"]
reported_by: "codex"
related_issues: [
  "docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md",
  "docs/issues/2026-04-11-routa-watch-entrix-fast-fitness-tui.md"
]
github_issue: 442
github_state: open
github_url: "https://github.com/phodal/routa/issues/442"
---

# Kanban 应该实时显示 Entrix fitness 状态

## What Happened

`crates/entrix` 已经具备运行 fitness 并输出 runtime artifact / mailbox 事件的能力，但 `Kanban` 主工作面并没有消费这条链路。

当前现状是：

- `crates/entrix/src/main.rs` 会把 runtime fitness 结果写入 `.routa/runtime/artifacts/fitness/`，并同时写 mailbox/event 载荷。
- `/settings/fluency` 已有 `FitnessAnalysisPanel`，但它读取的是 `docs/fitness/reports` 下的快照与显式触发分析，不是面向 Kanban 的实时运行态。
- `/workspace/{workspaceId}/kanban` 已通过 `/api/kanban/events` 做 SSE 刷新，但事件类型只覆盖 `kanban:changed`，不包含 Entrix fitness 状态。

结果是：Kanban 已经是任务执行的主工作台，但用户在这个页面里看不到当前仓库的 fitness 是否正在运行、最近一次结果是否通过、是否存在 hard gate/blocker，也无法第一时间获知状态变化。

## Expected Behavior

`/workspace/{workspaceId}/kanban` 应该为当前 workspace / codebase 提供一个紧凑的 Entrix 运行态面板，并在 fitness 结果变化时自动刷新。

这个 surface 至少应该能回答：

- 当前是否有 fitness run 在进行中
- 最近一次结果来自哪种 mode / tier
- 最近一次结果的状态、分数、时间戳
- 是否存在 blocker / hard gate failure

同时它应该保持双后端语义一致，不要求用户切到 `/settings/fluency` 才能知道当前 repo 健康状态。

## Reproduction Context

- Environment: both
- Trigger: 打开 `http://localhost:3000/workspace/default/kanban` 或桌面对应 Kanban 页面；随后通过 Entrix / Fluency / 其他自动化链路触发一次 fitness 运行，Kanban 页面不会出现对应的运行态或结果变化

## Why This Might Happen

- Entrix 的 runtime 输出路径与当前 Web UI 消费路径是分裂的：前者写 runtime mailbox/artifact，后者主要读 `docs/fitness/reports` 快照。
- Kanban 的 SSE broadcaster 是 board-domain 专用通道，当前只负责 task / board / queue 变化，没有承接 fitness/runtime 事件。
- `kanban-page-client.tsx` 当前会拉取 boards、tasks、sessions、repo changes、providers 等上下文，但没有 fitness 状态模型。
- 现有 `FitnessAnalysisPanel` 面向 `/settings/fluency` 设计，信息密度和交互深度都偏诊断台，不适合直接原样嵌入 Kanban 主工作面。

## Relevant Files

- `crates/entrix/src/main.rs`
- `src/app/api/fitness/report/route.ts`
- `src/app/api/fitness/analyze/route.ts`
- `src/client/components/fitness-analysis-panel.tsx`
- `src/client/hooks/use-kanban-events.ts`
- `src/core/kanban/kanban-event-broadcaster.ts`
- `src/app/api/kanban/events/route.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-status-bar.tsx`

## Observations

- 仓库里已经有一个可参考先例：`routa-watch` 之前接入过 Entrix fast fitness 面板，并且明确消费 runtime snapshot / mailbox，而不是重新设计评分引擎。
- 这个问题与 `2026-03-19-kanban-flow-observability-and-control-gaps.md` 相邻，但范围更窄。后者讨论的是 Kanban flow metrics 和治理原语；本问题只聚焦于 Entrix 运行态进入 Kanban 主工作面。
- 风险最低的首个切片不是把完整 Fluency 控制台复制进 Kanban，而是提供一个紧凑的 status surface，并把深度分析留给现有 Fluency 页面。

## References

- `docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`
- `docs/issues/2026-04-11-routa-watch-entrix-fast-fitness-tui.md`
- `https://github.com/phodal/routa/issues/410`
