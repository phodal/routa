---
title: "Routa-watch 增加 Entrix fast fitness 图表面板"
date: "2026-04-11"
kind: issue
status: closed
github_issue: 410
github_state: closed
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

## Resolution Update (2026-04-11)

- 已完成：
  - 在 `crates/routa-watch` 增加 `Entrix` fast 健康快照获取与展示。
  - 背景异步刷新机制接通（启动时、手动 `g`、10 分钟周期刷新）。
  - 首屏面板显示总分、维度得分、关键度量失败统计、覆盖率可见性说明。
  - 小/中屏下已将 `Fitness (Entrix Fast)` 面板置于 `Files` 下面。
  - 启动逻辑改为优先读取历史快照；无历史才触发一次 `fast` 刷新。
  - `Fitness` 面板现已支持焦点切换与滚动；中小屏会优先展示摘要并允许继续滚动查看更多维度/TopN。
  - `routa-watch` 的 fast fitness 执行已对 `eslint_pass` / `clippy_pass` 做本地变更增量化：优先只检查当前分支相对 upstream/main 的变更文件或受影响 Rust crate。
  - visible files 的 diff stat 已改成批量 `git diff --numstat`，减少每个文件单独 spawn 的开销。
  - 后续继续扩展为 `Fast / Full` 视图切换，允许在同一面板里查看完整维度集。
- 已验证：
  - `cargo check -p routa-watch`、`cargo test -p routa-watch` 正常。
  - 快照渲染测试覆盖面可见，当前面板可在无快照数据时回退到 `idle`。
- 当前状态：
  - GitHub issue #410 已与本地 tracker 同步关闭。
  - 剩余优化项转为后续体验增强，不再作为该问题的阻断项。

## Next Actions

1. 完善并稳定化测试：为 `run_fast_fitness` 增加并发路径/历史趋势字段覆盖。
2. 评估可配置化：将 TopN（当前 5）与趋势窗口（当前 12）提为可配置参数，和偏好配置联动。

## Relevant Files

- `crates/routa-watch/src/tui.rs`
- `crates/routa-watch/src/tui_cache.rs`
- `crates/routa-watch/src/tui_render.rs`
- `crates/routa-watch/src/tui_fitness.rs`
- `crates/routa-watch/src/tui_tests.rs`
- `crates/routa-watch/Cargo.toml`
- `docs/fitness/*`
