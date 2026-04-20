---
title: "ACP provider 与 Routa service 启动性能基线缺失"
date: "2026-04-08"
status: open
severity: medium
area: "acp"
tags: ["performance", "fitness", "startup-latency", "acp", "service-startup"]
reported_by: "codex"
related_issues: []
---

# ACP provider 与 Routa service 启动性能基线缺失

## What Happened

当前仓库的 `performance` fitness 维度已经覆盖 web route smoke 与 SQLite WAL guard，但没有记录 ACP provider 启动时间，也没有记录 Routa service 自身启动到 `/api/health` ready 的时间。

2026-04-08 做了一次本机手工 probe，得到以下基线：

- `service_startup_ms` (`./target/debug/routa server` 到 `GET /api/health` 返回 200): `451.40ms`
- `opencode` `acp_initialize_plus_session_new_ms`: `1469.10ms`
- `qoder` `acp_initialize_plus_session_new_ms`: `1408.91ms`
- `codex-acp` `acp_initialize_plus_session_new_ms`: `449.88ms`
- `claude` 当前只能得到 `spawn_stable_ms`: `601.33ms`

这里存在一个重要语义缺口：`claude` 目前的 startup 成功定义只是“进程成功拉起并稳定约 600ms”，而其他 ACP provider 的指标是“`initialize + session/new` 完成”。这些结果不能直接横向比较。

## Expected Behavior

仓库应当能用统一、可执行、可回归的方式记录三类启动指标：

- `service_startup_ms`: Routa server 从启动到健康可用
- `provider_startup_ms`: provider 从 spawn 到可接受会话初始化
- `session_first_usable_ms`: 从 `session/new` 到会话真正可发送首个 prompt

这些指标应作为 `fitness` 的 advisory performance evidence 持久化，至少能提供基线、趋势和回退检测。

## Reproduction Context

- Environment: both
- Trigger: 手工验证 ACP provider 与 Routa backend 的启动耗时，评估是否应纳入 `fitness`

复现方式（本次 probe 使用的定义）：

1. 启动 `./target/debug/routa server --host 127.0.0.1 --port 4210`
2. 轮询 `GET /api/health`，记录首次 200 OK 时间
3. 对标准 ACP provider 执行 `initialize` + `session/new`
4. 对 `claude` 执行当前 Routa 使用的 `stream-json` spawn 路径，记录“进程稳定存活”时间

## Why This Might Happen

- `docs/fitness/runtime/performance.md` 目前聚焦 web route smoke，没有 ACP/runtime startup 子项
- ACP provider 协议不统一，`claude` 与标准 ACP provider 的“ready”语义不同，导致难以直接纳入同一个阈值模型
- 当前更像是一次性手工 probe，而不是 repo 内可重跑、可在 CI 或本地 fitness 中复用的脚本

## Relevant Files

- `docs/fitness/runtime/performance.md`
- `crates/routa-server/src/lib.rs`
- `src/app/api/health/route.ts`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-core/src/acp/process.rs`
- `crates/routa-core/src/acp/claude_code_process.rs`
- `apps/desktop/src-tauri/src/lib.rs`

## Observations

- `service_startup_ms` 约 `451ms`，说明服务 bootstrap 本身不是当前最大瓶颈
- `codex-acp` 约 `450ms`，与 service startup 同量级
- `opencode` 与 `qoder` 都在 `1.4s` 左右，明显高于 `codex-acp`
- `claude` 当前量到的是 `spawn_stable_ms`，不是 `system_init_ms` 或 `first_usable_ms`
- provider probe 的语义差异本身就是 gap：如果 metric 定义不统一，fitness 只能记“数字”，不能记“结论”

## References

- `docs/fitness/README.md`
- `docs/fitness/runtime/performance.md`
