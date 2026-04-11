---
title: "Routa-watch 增加 Entrix fast fitness 图表面板"
date: "2026-04-11"
kind: issue
status: open
github_issue: 410
github_state: open
github_url: "https://github.com/phodal/routa/issues/410"
severity: medium
area: "ui"
tags: ["routa-watch", "tui", "fitness", "entrix", "visualization"]
reported_by: "codex"
related_issues: []
---

# Routa-watch 增加 Entrix fast fitness 图表面板

## What Happened

`routa-watch` 目前主要展示文件、代理、事件流，缺少 `Entrix`（fast 模式）健康评分的可视化面板。

## Expected Behavior

- 点击/快捷键可触发一次 fast 模式的 fitness 执行，并在界面中展示结果摘要。
- 能以图表形式显示：
  - Fast 总分（或健康度）与健康状态
  - 各 Dimension 的得分分布（按权重）
  - 关键 metric 的失败/跳过状态与耗时 Top 榜
- 告知当前可展示的信息边界（例如当前 Fast 规则中无原生“覆盖率”指标时的说明），避免误导。

## Reproduction Context

- Environment: desktop
- Trigger: 打开 TUI 后需要查看健康态势时

## Why This Might Happen

- 当前视图未接入 `routa-entrix` 的运行链路。
- Fast 执行时长较高，直接放在主循环会阻塞交互，需要后台异步计算与缓存。
- 规则侧写中 fast 模式主要覆盖 lint/typecheck/contract/security 等可执行检查，缺少标准化覆盖率指标。

## Relevant Files

- `crates/routa-watch/src/tui.rs`
- `crates/routa-watch/src/tui_cache.rs`
- `crates/routa-watch/src/tui_render.rs`
- `crates/routa-watch/src/tui_fitness.rs`
- `crates/routa-watch/src/tui_tests.rs`
- `crates/routa-watch/Cargo.toml`
- `docs/fitness/*`
