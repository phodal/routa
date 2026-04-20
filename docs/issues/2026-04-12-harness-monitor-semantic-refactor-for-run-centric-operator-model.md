---
title: "Harness monitor 的 run-centric 语义仍然分散在 session/file/operator 逻辑里"
date: "2026-04-12"
kind: issue
status: resolved
resolved_at: "2026-04-12"
severity: medium
area: "harness-monitor"
tags: ["harness-monitor", "run-centric", "semantic-refactor", "operator-console"]
reported_by: "codex"
related_issues: []
github_issue: null
github_state: null
github_url: null
resolution: "Phase 1 and Phase 2 are now shipped: a shared run assessment drives CLI and TUI, workspace identity and recovery hints are first-class assessment inputs/outputs, and fast-tier fitness passes cleanly."
---

# Harness monitor 的 run-centric 语义仍然分散在 session/file/operator 逻辑里

## What Happened

`crates/harness-monitor` 已经开始引入 `Task / Run / Workspace / Eval / Policy / Evidence` 领域模型，但当前运行语义仍然分散在多套实现里：

- repo 信号和 dirty 文件归属主要在 `observe.rs`、`detect.rs`、`state*.rs`
- run 阻断、evidence、approval、next action 主要在 `operator_guardrails.rs`
- run/workspace CLI 视图又在 `cli_operator.rs` 二次拼装状态

这导致产品方向虽然已经转向 run-centric operator console，但代码表达仍然偏向：

- session/file monitor 语义
- 局部启发式判断
- CLI/TUI 各自派生“这个 run 现在意味着什么”

## Expected Behavior

`harness-monitor` 应该把 run-centric operator 语义作为一层显式的应用模型表达出来，使下列概念能稳定挂接到 run 上：

- `Observe`
- `Attribute`
- `Evaluate`
- `Orchestrate`
- `Constrain`
- `Contextualize`
- `Validate`
- `Evidence`
- `Operate`
- `Reflect`

这些概念应作为语义 plane，而不是替代 `Task / Run / Workspace / EvalSnapshot / PolicyDecision / Evidence` 这些领域对象。

## Reproduction Context

- Environment: desktop
- Trigger: 阅读 `crates/harness-monitor` 现有代码并尝试把产品概念映射到实现边界时

## Why This Might Happen

- `harness-monitor` 正处于从 session/file monitor 向 run-centric console 迁移的中间状态。
- 新领域模型已经出现，但旧状态折叠逻辑和展示层拼装逻辑还没有被统一抽象。
- 当前还没有一层共享的 operator semantic assessment，导致 CLI/TUI 和 guardrail 逻辑各自表达语义。

## Relevant Files

- `crates/harness-monitor/src/observe.rs`
- `crates/harness-monitor/src/detect.rs`
- `crates/harness-monitor/src/models.rs`
- `crates/harness-monitor/src/state.rs`
- `crates/harness-monitor/src/state_events.rs`
- `crates/harness-monitor/src/state_views.rs`
- `crates/harness-monitor/src/operator_guardrails.rs`
- `crates/harness-monitor/src/cli_operator.rs`
- `crates/harness-monitor/src/domain/run.rs`
- `crates/harness-monitor/src/domain/task.rs`
- `crates/harness-monitor/src/domain/workspace.rs`
- `crates/harness-monitor/src/domain/eval.rs`
- `crates/harness-monitor/src/domain/policy.rs`
- `crates/harness-monitor/src/domain/evidence.rs`
- `docs/exec-plans/active/harness-monitor-run-centric-priorities.md`

## Observations

- `Observe / Attribute / Evaluate / Constrain / Evidence` 已经有较明确的实现锚点，但仍缺少统一的运行语义汇总层。
- `Orchestrate` 已有 `Task / Run / Workspace / Role / Handoff` 雏形，但更多体现在结构体和 CLI heuristics 中，尚未成为共享应用层。
- `Contextualize / Operate / Reflect` 在设计上成立，但按当前代码成熟度更适合作为 roadmap plane，而不是第一轮重构的强实现目标。

## Refactor Judgment

这组概念是合理的，但更适合作为 **operator semantic planes**，而不是十个对等的顶层运行时实体。

应该保持为一等领域对象的仍然是：

- `Task`
- `Run`
- `Workspace`
- `EvalSnapshot`
- `PolicyDecision`
- `Evidence`
- 相关联的 domain events

这组 semantic planes 的作用应该是：

- 描述一段代码或一个 run 当前属于哪种 operator 能力面
- 让 run 的状态推导不再散落在 CLI/TUI heuristics 中
- 让未来 managed mode 能在当前 unmanaged attach 语义之上继续演进
- 避免 UI、CLI、guardrail 逻辑各自重复表达业务意义

## Plane Mapping

### Runtime Signal Planes

| Plane | Meaning | Current code anchors | Current maturity |
|---|---|---|---|
| `Observe` | hook events, process detection, git dirty state, session matching | `observe.rs`, `detect.rs`, `hooks.rs`, `ipc.rs`, `state_events.rs` | implemented |
| `Attribute` | file ownership, session-to-agent association, confidence, conflict detection | `models.rs`, `state_views.rs`, `state_events.rs`, `db.rs` | implemented |

### Control And Quality Planes

| Plane | Meaning | Current code anchors | Current maturity |
|---|---|---|---|
| `Evaluate` | Entrix fast/full, hard gates, score summary | `domain/eval.rs`, `domain/evaluator.rs`, `tui_fitness.rs`, `db.rs` | implemented |
| `Constrain` | tool allowlist, effect classes, approval and policy gates | `domain/policy.rs`, `operator_guardrails.rs` | implemented |
| `Validate` | acceptance checks, behavior/contract verification, UI/E2E proof obligations | `docs/fitness/README.md`, `operator_guardrails.rs`, future evaluator adapters | emerging |
| `Evidence` | unified artifact view for test reports, coverage, screenshots, diff/log bundles, approval records | `domain/evidence.rs`, `operator_guardrails.rs`, `db.rs` | implemented for structure, partial for runtime bundling |

### Execution Plane

| Plane | Meaning | Current code anchors | Current maturity |
|---|---|---|---|
| `Orchestrate` | `Task / Run / Workspace` lifecycle, role handoff, retry/recovery, worktree ownership | `domain/task.rs`, `domain/run.rs`, `domain/workspace.rs`, `cli_operator.rs` | emerging |

### Context And Outer-Loop Planes

| Plane | Meaning | Current code anchors | Current maturity |
|---|---|---|---|
| `Contextualize` | `AGENTS.md`, architecture rules, product intent, task context, runbook assembly | repo docs, future context-pack assembly | roadmap |
| `Operate` | PR/merge/deploy/rollback flow and release-stage blocking | domain events only, CLI placeholders | roadmap |
| `Reflect` | runtime signals, regression/drift detection, learned follow-up and feedback loops | fitness history, event logs, future learning loop | roadmap |

## Recommended Code Shape

### 1. Keep Domain Objects Stable

不要让 plane taxonomy 替代 `Task / Run / Workspace / EvalSnapshot / PolicyDecision / Evidence`。

plane taxonomy 应该服务于：

- application services
- operator state derivation
- TUI / CLI view models
- roadmap framing

### 2. Extract Application-Layer Semantics

重构重点应该放在 raw signals 与 presentation 中间的应用层：

- raw inputs: hook/git/process/db/runtime events
- domain state: run/task/workspace/eval/evidence/policy records
- semantic layer: 用 plane 表达 run/operator assessment
- presentation: TUI panels 和 CLI output

这样可以避免：

- UI 直接从 session status 字符串推导 operator meaning
- CLI 在 domain/policy 之外单独发明 block reason
- attribution ambiguity 在不同 surface 里有不同解释

### 3. Use Planes As Grouping Boundaries, Not As Crate Boundaries

第一轮重构应优先：

- 提取一层共享的 run/operator assessment
- 让 `Observe / Attribute / Evaluate / ...` 的映射可复用
- 让 CLI 和 TUI 消费同一份语义摘要

第一轮重构应避免：

- 为了对齐标签而生硬拆出十个顶层模块
- 把 durable domain type 移进 presentation-centric 文件
- 在 unmanaged 语义还不清晰前，提前做 full managed runtime

## Refactor Sequence

### Phase 1: Semantic Consolidation Around Runs

- 让 `Run` 成为 observation、attribution、evaluation、constraint、evidence 状态的统一挂接点
- 停止让 CLI/TUI 各自发明一套 run 语义
- 从 `cli_operator.rs` 和 `operator_guardrails.rs` 抽取共享的 run/operator assessment

### Phase 2: Workspace And Handoff Semantics

- 把 workspace/worktree identity 作为 run assessment 的常规输入
- 把 handoff 和 recovery hint 通过 `Orchestrate` 表达，而不是停留在 CLI heuristics

### Phase 3: Outer Loop Surfaces

- 保留 `Contextualize / Operate / Reflect` 作为显式 plane
- 但不要在第一轮里把 PR/deploy 控制或 context-pack assembly 做成强实现目标

## Constraints

- 保持 run-centric 方向，不回到 session-centric 产品表达
- 保持 unmanaged attach 和 ambiguity-first attribution 为一等行为
- 重构期间不能回退 `Observe / Attribute / fast Evaluate` 的现有能力
- 不能把 plane model 只写成文档概念，必须落到可复用的代码边界
- 不能高估 `Contextualize / Operate / Reflect` 的当前成熟度

## Naming Guidance

命名也应该参与语义表达，而且这件事对人和 AI 都有帮助。

建议原则：

- 名字优先表达稳定语义，不表达偶然实现细节。
- 一类名字只承载一种含义，避免同一个概念在仓库里被 `monitor / watch / operator / governance` 混用。
- domain 层优先用名词：`run`、`task`、`workspace`、`evidence`、`policy`、`eval`。
- application 层优先用能力或动作：`observe`、`attribute`、`run_assessment`、`workspace_assessment`、`handoff`。
- adapter / infra 层优先用来源加职责：`hook_adapter`、`git_observer`、`process_detector`、`entrix_evaluator`。
- presentation 层保持界面语义：`tui`、`cli`、`panels`、`render`。

对当前 `harness-monitor` 的具体含义：

- 如果产品短期仍是“live operator console for unmanaged and managed runs”，包名 `harness-monitor` 仍可接受，因为它保留了现有用户心智和二进制入口。
- 如果后续产品语义明显超出 monitor，进入真正的 control surface，则可以再评估是否升级到更强语义名，例如 `harness-operator`，但这应该是产品边界变化，而不是第一轮内部重构动作。

命名层面的落地方向：

- 不要为了对齐 plane taxonomy，把每个 plane 都拆成一个顶层 crate。
- 更好的做法是让 crate 内部目录和模块先语义化，再决定是否值得进一步拆包。
- 第一轮应优先收敛那些带有历史痕迹、难以表达职责的名字，例如过宽的 `models`、`state_views`、`cli_operator` 一类命名。

命名重构成功的标准：

- 看到模块名就能大致判断它属于 domain、application、adapter 还是 presentation。
- AI 在跨文件阅读时，能从名字推断依赖方向和职责边界，而不需要反复打开实现验证。
- 新增逻辑更容易知道应该落到哪里，而不是继续堆到“万能文件”里。

## Verification

当下面这些条件成立时，这个重构就算成功：

- 代码中只有一条共享的 operator assessment 路径，而不是 CLI/TUI 各自推导
- 单个 run 能解释自己在 observation、attribution、evaluation、constraint、validation、evidence 上的状态
- unmanaged fallback run 和 unknown/conflict bucket 仍然保留可见性
- workspace 与 handoff 语义能挂到 run detail，而不要求 full managed mode 先落地
- roadmap planes 仍然显式存在，但不会造成提前实现的结构债

## Follow-up Progress

- 已抽取 `crates/harness-monitor/src/application/run_assessment.rs` 作为共享 run/operator assessment 路径
- CLI 与 TUI 现在消费同一份 assessment，不再各自派生主要 operator 语义
- synthetic process-scan run、unknown bucket、workspace/worktree identity、handoff 与 recovery hint 都已落到共享 assessment
- `cli_operator.rs` 与 `tui_panels.rs` 已展示 workspace-aware handoff 和 recovery hints
- 相关 README 与 architecture 文档已同步到 run-centric operator 语义

## Verification Evidence

- `cargo test -p harness-monitor`: 81 passed
- `cargo clippy -p harness-monitor -- -D warnings`: passed
- `entrix run --tier fast`: 100% PASS

## Resolution

该问题在当前代码库中已经解决。本地 issue tracker 保留作为架构演进记录，后续如果继续推进 `Contextualize / Operate / Reflect` 的强实现，应新开独立 tracker，而不是重新打开本问题。

## References

- `docs/exec-plans/active/harness-monitor-run-centric-priorities.md`
- `docs/ARCHITECTURE.md`
- `docs/fitness/README.md`
