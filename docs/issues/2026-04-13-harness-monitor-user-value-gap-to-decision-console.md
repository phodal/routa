---
title: "Harness monitor 仍缺少 journey-first 的决策汇总"
date: "2026-04-13"
kind: issue
status: open
severity: high
area: "harness-monitor"
tags: ["harness-monitor", "operator-console", "user-value", "task-journey", "run-details"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-12-harness-monitor-task-tracking-from-codex-hooks.md"
  - "docs/issues/2026-04-12-cross-language-test-mapping-and-missing-test-gates.md"
  - "docs/issues/2026-04-12-harness-monitor-semantic-refactor-for-run-centric-operator-model.md"
github_issue: null
github_state: null
github_url: null
---

# Harness monitor 仍缺少 journey-first 的决策汇总

## What Happened

`crates/harness-monitor` 这轮迭代已经补上了几条关键链路：

- `Codex` / `Auggie` 的 transcript/session recovery
- prompt-first Runs
- synthetic process-scan runs
- `All` aggregate run
- dirty files、journey files、recent git activity
- run-scoped operator assessment
- decision-first 的 `Run Details`

当前剩下的缺口已经不再是“完全 observer-first”，而是用户仍然需要跨多个 panel 自己拼装这些问题的答案：

- “我现在最该管哪个 run？”
- “它为什么卡住？”
- “下一步应该继续、评审、补证据还是停下来？”
- “这条任务旅程已经交付到了哪一步？”

换句话说，`harness-monitor` 已经更接近一个 run-centric operator console，但 journey 与 go/no-go summary 仍不够收束成一个一眼可判的 surface。

## Expected Behavior

从用户角度，`harness-monitor` 应该优先帮助人驾驭多智能体，而不是只观察多智能体。

这意味着产品表达应该把“决策信息”放在“元数据信息”之前，并围绕一条可追溯的 task/run journey 组织界面。

## User Value Gaps

### 1. Run Details 已经 decision-first，但 continue / merge judgement 仍分散在多个 panel

当前 `Run Details` 已经能拿到：

- `state`
- `block_reason`
- `approval`
- `evidence`
- `next_action`
- `handoff`

`Run Details` 的排序已经在往决策优先收敛，但“能不能继续 / 能不能 merge / 是否缺测试或证据”这类判断，仍然要跨 `Run Details`、`Fitness`、`Git Status`、`Prompt` 等区域自己拼出来。

### 2. Task journey 仍然是摘要，不是连续链路

虽然 session、turn、task、file attribution 已经开始打通，但当前 UI 更像“当前状态卡片”，而不是一条可回放的旅程。

用户真正需要的是：

- 当前 task
- 最近 prompt 历史
- 关键 tool / event
- dirty files
- 已提交变更
- eval / evidence / handoff

都能围绕同一个 run/task 被理解。

### 3. “能不能继续 / 能不能 merge” 还没有成为 run 的一眼判断

仓库已经有：

- Entrix fitness
- test mapping
- dirty file observation
- evidence / policy assessment

但这些信号还分散在 `Git Status`、`Fitness`、`Run Details` 等多个区域。

用户需要的是：选中一个 run 后，能立刻知道它是否安全继续、是否缺测试证据、是否缺 coverage、是否应转人工评审。

### 4. Committed changes 还只是提示，不是 run journey 的一部分

现在 `recent_git_activity` 只是轻量摘要，能提示最近发生过 commit，但还不足以让用户回答：

- 这个 run 已经交付了什么？
- dirty changes 和 committed changes 是同一条旅程吗？
- commit 之后这条 run 是不是已经进入 review / validation 阶段？

用户需要 committed changes 成为 run-level evidence 的一部分，而不是提交后就从 monitor 视角里“消失”。

## Why This Matters

如果 `harness-monitor` 只优化观测能力，用户会获得更多信号，但不会获得更强控制力。

对真实并行 agent 工作流来说，最贵的不是缺少事件，而是人类需要在噪声里持续自己做状态翻译。

真正的用户价值应该是：

- 更快发现需要介入的 run
- 更快判断为什么介入
- 更快判断是否可以继续 / 交接 / 合并
- 更少依赖人脑临时拼接 task journey

## Near-Term Implementation Order

1. 把 task journey 扩成连续链路，而不是摘要字段
2. 把 test mapping / eval / evidence 汇总成 run-level continue/merge safety
3. 把 committed changes 纳入 run journey / evidence surface
4. 把最需要人工介入的 run 提升成更显式的 decision summary

## Relevant Files

- `crates/harness-monitor/src/ui/panels.rs`
- `crates/harness-monitor/src/ui/views.rs`
- `crates/harness-monitor/src/ui/state.rs`
- `crates/harness-monitor/src/ui/tests.rs`
- `crates/harness-monitor/src/run/orchestrator.rs`
- `crates/harness-monitor/src/observe/hooks.rs`
- `crates/harness-monitor/src/shared/db.rs`
- `crates/harness-monitor/src/evaluate/gates.rs`

## Constraints

- 不能回退现有 prompt-first runs / recovered markers / synthetic run fallback
- 不能为了“更好看”重新把 run 语义退回 session-centric
- 不能把 continue/merge safety 写死在 UI heuristics 中，而应尽量复用已有 assessment / evaluator 输出
