---
title: "Harness Fitness 加速：引入 pi-autoresearch 进行自动化闭环实验"
date: "2026-04-17"
kind: issue
status: in_progress
severity: high
area: "harness"
tags: ["fitness", "harness-monitor", "entrix", "autoresearch", "performance", "automated-optimization"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-13-harness-monitor-selection-latency-from-single-worker.md"
  - "docs/issues/2026-04-14-kanban-entrix-live-fitness-surface.md"
  - "docs/issues/2026-03-28-harness-execution-plan-react-flow.md"
github_issue: 482
github_state: open
github_url: "https://github.com/phodal/routa/issues/482"
---

# Harness Fitness 加速：引入 pi-autoresearch 进行自动化闭环实验

## What Happened

已拉取 `pi-autoresearch`（https://github.com/davebcn87/pi-autoresearch）并确认其循环模型：`baseline -> run_experiment -> log_experiment -> keep/discard`，支持 `METRIC name=value` 输出、`checks_failed` 回退和 `confidence` 判定。当前 Routa 的 `harness`/fitness 路径（`entrix` + `harness-monitor`）没有可自动执行的“速度优化闭环”。当前主要耗时点集中在：

- `crates/harness-monitor/src/evaluate/entrix.rs` 每次 fast/full 都重算维度并执行 `entrix` 指标命令。
- `crates/harness-monitor/src/evaluate/entrix.rs` 每次都做 `git diff` + `changed_files` 发现，作为 fast rewrite 的输入。
- `crates/harness-monitor/src/ui/cache.rs`、`src/core/fitness/entrix-runner.ts` 在触发 fitness 运行时缺少“自适应降本策略”（例如基于慢指标自动收窄 scope）。
- `crates/harness-monitor/src/ui/cache_test_mapping.rs` 对 graph 结果的策略固定，不支持按历史/成本动态退化。

## Expected Behavior

希望建立一个“Harness Agent + Harness Fitness”协同闭环：

- 每次变更后自动跑 `harness` 速度目标实验，目标是持续压缩 `entrix` 快速/全量健康评估耗时；
- 自动记录慢维度（slowest metrics）、并基于改动和历史表现尝试“候选加速策略”；
- 保持现有 correctness checks 不变，失败自动回退；
- 将最佳策略建议沉淀到 `docs`，并通过 `apply`/`ratchet` 形成可持续优化轨道。

## Reproduction Context

- Environment: both
- Trigger: 在本地/CI 频繁运行 `entrix run --tier fast` 或 harness-monitor fast/full 反馈路径时，fitness runtime 与 slowest metric 报告不稳定抖动，且缺少结构化自动化优化机制。

## Why This Might Happen

- 当前 `entrix run` 的性能问题主要是“可变参数空间大 + 调优策略手工化”，而非单点 bug。
- 仓库已有 run-centric 与 trace 记录能力，但尚未把其用于 Harness 自身的闭环优化搜索。
- 自动化优化 agent（`harness-engineering`）更偏治理/补齐能力，未专注于执行性能曲线收敛。
- `pi-autoresearch` 的实验脚本接口与我们已有的度量模型天然匹配（`METRIC` 输出 + commit/revert + confidence）。

## Relevant Files

- `/Users/phodal/test/pi-autoresearch/README.md`
- `/Users/phodal/test/pi-autoresearch/skills/autoresearch-create/SKILL.md`
- `src/core/fitness/entrix-runner.ts`
- `crates/routa-cli/src/commands/harness/engineering/mod.rs`
- `crates/routa-cli/src/commands/harness/engineering/learning.rs`
- `crates/harness-monitor/src/evaluate/entrix.rs`
- `crates/harness-monitor/src/ui/cache.rs`
- `crates/harness-monitor/src/ui/cache_test_mapping.rs`
- `docs/fitness/README.md`

## Plan (proposed)

### 1) 增加 Harness Fitness 实验基线与指标采集

- 新增 `autoresearch.sh`（或 `harness-autoresearch.sh`）：
  - 主指标: `METRIC fitness_ms=<elapsed_ms>`（目标越小越好）。
  - 方向指标: `METRIC hard_gate_hits=<n>`，`METRIC slowest_metric_ms=<n>`，`METRIC changed_files=<n>`。
  - 快速路径优先执行 `entrix run --tier fast`，必要时追加 `entrix run --tier normal --min-score 0`。
  - 若已有 `harness` 目录中的快照，脚本可解析 `docs/fitness/reports/*latest*.json` 估算“回归”风险。

### 2) 与 Harness Agent 绑定（建议最小变更）

- 新建 `resources/specialists/tools/harness-fitness-optimizer.yaml`：
  - 输入：当前最慢维度、失败指标、文件变更范围。
  - 产出：优化建议（按粒度：`entrix` 维度 filter、度量并行度、fast rewrite 策略）。
- 在 `harness evolve` 的演化路径里新增“速度优化模式”入口：
  - `routa harness evolve --speed-profile` 触发一次自动实验（不默认 apply，先 dry-run）。
  - 结合 `learn` 产出的 playbook 优先尝试历史有效参数。

### 3) 可回归的候选优化点（按影响优先）

- `crates/harness-monitor/src/evaluate/entrix.rs`
  - 缓存 `local_changed_files` 结果，避免 fast 模式每次重复 `git diff`。
  - 对快变更场景引入“metric 命令白名单 + 按变更规模降级”：变更文件过多时，优先保留可并行的关键硬门控命令。
  - 引入 `HARNESS_FAST_TIMEOUT_MS` / `HARNESS_PARALLEL_DIMENSIONS` 环境变量开关，支持环境自适应。

- `src/core/fitness/entrix-runner.ts`
  - 在失败/超时场景记录执行耗时、命令耗时并写入 `EntrixRunSummary` secondary metrics，供 `autoresearch` 做回归对比。

- `crates/harness-monitor/src/ui/cache.rs`
  - 当同一 key 在短时间内连续触发时，加入“debounce + stale-while-revalidate”策略，减少重复 full run。

### 4) 自动化验收与回退

- `checks`: `entrix run --dry-run` + `npm run test:run:fast` + `npm run lint`。
- 收敛条件（示例）：
  - 3 轮内 `fitness_ms` 中位数下降 ≥ 20%
  - `hard_gate_hits` 不增加
  - `entrix run --tier fast` pass 率不下降

## References

- https://github.com/davebcn87/pi-autoresearch
- `docs/fitness/README.md`
- `docs/features/harness-trace-learning.md`
