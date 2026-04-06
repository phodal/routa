# Fitness Function Rulebook

> **Defense-in-Depth**: 摒弃传统针对 DX 的"宽容度"，用硬性约束封锁 AI 的乱写空间。

## 防御理念

通过持续演进的架构约束实现深度防御：

- **控制爆炸半径**: 通过权限和行为约束限定 AI 的操作范围
- **反熵增机制**: 设立质量门槛与技术债检查（Linter、静态分析），将 AI 的解空间限制在安全边界内
- **契约优先**: `api-contract.yaml` 作为单一事实来源，双后端必须一致

## Quick Start

```bash
# 安装（首次）
pip install -e tools/entrix

# 快速检查（仅 fast tier，<30s）
entrix run --tier fast

# 标准检查（fast + normal tier，<5min）
entrix run --tier normal

# 完整检查（所有 tier，<15min）
entrix run

# Harness Fluency 评估（默认 generic profile，文本报告）
cargo run -p routa-cli -- fitness fluency

# Harness Fluency 评估（agent_orchestrator profile）
cargo run -p routa-cli -- fitness fluency --profile agent_orchestrator

# Harness Fluency 评估（JSON + 与上次快照对比）
cargo run -p routa-cli -- fitness fluency --format json --compare-last

# Harnessability framing（对外基线视角）
cargo run -p routa-cli -- fitness fluency --framing harnessability

# Harness Fluency 评估（只读，不落快照）
cargo run -p routa-cli -- fitness fluency --no-save

# Harness Engineering 评估（默认 dry-run，结构化 gap classification）
cargo run -p routa-cli -- harness evolve --dry-run --format json

# 弱仓库 bootstrap（先评估，再显式 apply 低风险 patch）
cargo run -p routa-cli -- harness evolve --repo-root /path/to/repo --bootstrap --dry-run --format json
cargo run -p routa-cli -- harness evolve --repo-root /path/to/repo --bootstrap --apply --format json

# Harness Engineering + AI specialist（deterministic report 仍是权威输入）
cargo run -p routa-cli -- harness evolve --ai --provider claude --format json

# 包管理器快捷入口（仍走 Rust CLI）
npm run fitness:fluency

# 旧 TS 入口（兼容层，内部会转发到 routa-cli）
node --import tsx tools/harness-fluency/src/cli.ts --json

# 并行执行（加速）
entrix run --parallel

# Harness specialist 手工验收（可重放：只验证输出是否可解析且为纯 JSON）
set -a; source .env; set +a
./target/debug/routa specialist run resources/specialists/tools/harness-build.yaml --provider claude -p "Read docs/harness/build.yml and output strict JSON."
./target/debug/routa specialist run resources/specialists/tools/harness-test.yaml --provider claude -p "Read docs/harness/test.yml and output strict JSON."

# 若先前 provider 不可用，可临时切换为 codex（若配置了 CODEX_API_KEY）
./target/debug/routa specialist run resources/specialists/tools/harness-build.yaml --provider codex -p "Read docs/harness/build.yml and output strict JSON."
./target/debug/routa specialist run resources/specialists/tools/harness-test.yaml --provider codex -p "Read docs/harness/test.yml and output strict JSON."

# 仅查看会执行什么（不实际运行）
entrix run --dry-run

# 仅运行指定维度（可重复传参）
entrix run --tier normal --scope ci --dimension code_quality --dimension testability

# 校验维度权重
entrix validate
```

Harness Fluency 默认跑通用 `generic` 模型；如果要评估编排型 agent 平台能力，可显式传 `--profile agent_orchestrator`。不同 profile 会使用独立快照文件，避免 `--compare-last` 互相污染。

`tools/harness-fluency` 已降级为兼容层，唯一权威实现是 `routa fitness fluency`。后续 detector、profile、输出格式与测试应只在 Rust CLI 侧演进。

### Harness Fluency vs Harnessability

- **Harness Fluency**: Routa 内部的成熟度模型与评分引擎，负责计算 level、readiness、blocking criteria 和 recommendations。
- **Harnessability**: 对外解释同一套结果的 framing，用来回答“这个 repo / workspace 是否适合高自治 coding agent”。

当前推荐做法是保留 `Harness Fluency` 作为权威实现，再通过 `--framing harnessability` 或机器可消费的 `baseline` 视图，把结果投影成更容易对外沟通的仓库基线报告。

这个 baseline 视图应聚焦：

- 当前基线分数 / 成熟度
- dominant gaps
- top actions
- autonomy recommendation
- lifecycle / sensor placement 的可见性

### Harness Engineering Loop

`routa harness evolve` 对应的是 #314 里的 `observe → evaluate → synthesize → verify → ratchet` 主循环：

- `observe`: 读取 repo signals、`docs/harness/*.yml`、automation、spec sources、fitness / fluency 快照
- `evaluate`: 输出结构化 gap classification，并区分 harness gap 与 non-harness engineering gap
- `synthesize`: 在 dry-run 模式下给出 low-risk patch candidates 和 verification plan
- `verify`: `--apply` 只会自动落低风险 patch，随后立即执行 verification plan；任一步失败都会回滚本轮变更
- `ratchet`: verification 通过后会重新运行 fluency baseline，对 `generic` / `agent_orchestrator` 快照做比较；若 level、dimension、baseline score 或已通过 criterion 出现回退，则整轮变更回滚；若没有历史快照，则会建立新的 baseline snapshot

边界：

- 这条命令不会把所有 fitness failure 都当成 harness mutation 目标
- medium/high-risk patch 仍然需要人工 review，除非显式 `--force`
- `harness evolve` 只负责 fluency baseline 的闭环比较与持久化，不替代 `entrix` 的规则执行，也不会把所有 repo-level failure 自动转成 harness mutation

### Tier 分层

- **fast** (<30s): Lints, 静态分析, 契约检查
- **normal** (<5min): 单元测试, API 测试, 代码质量
- **deep** (<15min): E2E 测试, 安全扫描, 视觉回归

## Scope

- 覆盖 `routa-core`、`routa-server`、`routa-cli`、`routa-rpc` 及前端 Next.js
- 目标不是"覆盖率数字"，而是"变更后核心行为可被验证"
- 评估依据必须来自可执行证据（测试文件、命令输出）

## Flow

```
1. AGENTS.md                        → 项目概述 + Fitness 入口
2. README.md                        → 规则手册（本文件）
3. unit-test.md                     → 单元测试证据（含 frontmatter）
4. rust-api-test.md                 → API 契约证据（含 frontmatter）
5. tools/entrix/                    → 解析 frontmatter，执行检查（Python 模块）
```

## Score Model

```
Fitness = Σ (Weight_i × Score_i) / 100

阻断: < 80 | 强告警: 80-90 | 通过: ≥ 90
```

## Dimensions（十个维度）

| 维度 | 权重 | 描述 | 关键指标 | 证据文件 |
|------|------|------|----------|----------|
| code_quality | 18% | 代码本体质量与静态门禁 | 文件/函数预算, lint/typecheck/clippy, 重复与复杂度 | [code-quality.md](code-quality.md) |
| engineering_governance | 6% | 工程治理与仓库卫生 | blast radius, 外链可达, scripts 冻结预算, TODO/FIXME 监控 | [engineering-governance.md](engineering-governance.md) |
| testability | 20% | 测试覆盖与通过率 | 覆盖率≥80%, 通过率100% | [unit-test.md](unit-test.md) |
| security | 20% | 依赖漏洞与安全扫描 | critical=0, high≤阈值 | [security.md](security.md) |
| api_contract | 10% | API 契约测试 | Rust API 测试通过, 契约同步 | [rust-api-test.md](rust-api-test.md) |
| design_system | 10% | 设计系统质量 | CSS 契约, 组件视觉回归, 可访问性 | [design-system-quality-layers.md](design-system-quality-layers.md) |
| evolvability | 8% | API 兼容性与契约 | breaking changes=0, parity=100% | [api-contract.md](api-contract.md) |
| ui_consistency | 8% | UI 一致性 | Shell 组件覆盖, Token 接入 | [design-system-shell.md](design-system-shell.md) |
| observability | 0% | 运行时可观测性 | instrumentation, error visibility, trace recorder | [runtime/observability.md](runtime/observability.md) |
| performance | 0% | 运行时性能证据 | route smoke, SQLite WAL | [runtime/performance.md](runtime/performance.md) |

**Total: 100%**

说明：

- `observability` 与 `performance` 目前是 runtime 维度，权重为 `0`，不会改变总分，但会作为执行证据出现在报告里。
- `security` 维度仍由 `entrix` 评分，同时 GitHub Actions 会继续保留 SARIF / scanner 类型的独立安全作业。

## Hard Gates

硬门禁失败直接阻断，不计入评分：

| Gate | 命令 | 阈值 |
|------|------|------|
| ts_test_pass | `npm run test:run` | 100% |
| rust_test_pass | `cargo test --workspace` | 100% |
| api_contract_parity | `npm run api:check` | pass |
| lint_pass | `npm run lint` | 0 errors |
| no_critical_vulnerabilities | `snyk test` | 0 critical |

## CI Fan-out

`Defense` workflow 现在按维度拆分 `entrix run --dimension ...`，每个 job 对应一个 fitness 维度：

- `Gate: Code Quality`
- `Gate: Engineering Governance`
- `Gate: Testability`
- `Gate: Security`
- `Gate: API Contract`
- `Gate: Design System`
- `Gate: Evolvability`
- `Gate: UI Consistency`
- `Gate: Observability`
- `Gate: Performance`

这保证了 CI 展示和 `docs/fitness/*.md` 的维度定义保持一一对应，而不是回退到手写命令的旧 gate 模式。

## 规则（AI Verifier / 人工都按同一标准执行）

### 1) API Contract 变更规则
- 变更到的 HTTP 行为必须先在 `docs/fitness/rust-api-test.md` 上登记 endpoint 级条目。
- 每个新增/修改 endpoint 必须至少有：
  - 1 个正向用例（成功路径，含预期响应体字段）
  - 1 个负向用例（400/404/409/422 类中的任意一个或更多）
  - 1 个关键不变量断言（幂等性、鉴权/归属、状态一致性）
- 对于响应格式或错误码变更，必须补充"回归用例 + 旧行为断言"。
- 不允许只验证 status code；至少要有一次 `body` 结构或关键字段断言。

### 2) 领域行为规则
- 业务规则变化、状态映射变化、错误映射变化，必须至少有 1 个单元测试。
- 边界条件（非法输入、空输入、冲突状态）必须至少有 1 个失败用例。
- 可通过重构简化路径，不允许只靠"快照文本"冒充行为验证。

### 3) 测试数据与隔离规则
- 每条测试必须：
  - 明确前置数据（workspace/task/codebase/...）；
  - 明确清理策略（测试结束销毁临时数据/文件）；
  - 避免依赖外部服务，若必须依赖须标记为 `blocked`.
- 禁止"隐式共享状态"导致测试顺序相关；同一文件下测试应可并行顺序执行。

### 4) 证据优先规则
- 可执行性优先：所有条目必须指向 `crates/...` 的测试代码路径。
- 不可执行项必须标记为 `blocked`，并给出阻塞原因。
- 未执行/未更新条目视为未完成，不得计入得分。

### 5) Gate 规则
- 只有所有 `critical` 条目为 `VERIFIED` 才可进入审核通过流程。
- 任何 endpoint 的负向路径缺失会直接阻断关键合格条件。

## Fitness 评分模型（用于 AI Verifier）

- API Contract Completeness（40%）
- Business Unit Unit-Tests（30%）
- Negative-path Completeness（20%）
- Regression Evidence Stability（10%）

每项仅基于 `docs/fitness/unit-test.md` 与 `docs/fitness/rust-api-test.md` 上的已验证条目计分。
未验证条目按 0 分处理。

## 文件职责（只允许单一事实来源）

- `README.md`：规则手册（本文件）。
- `unit-test.md`：单元测试证据，frontmatter 定义 metrics。
- `rust-api-test.md`：API 契约证据，frontmatter 定义 metrics。
- `tools/entrix/`：解析 frontmatter，执行命令，输出结果（`entrix` CLI）。
- 所有测试改动必须同步更新证据文件。

## Core principle

- 用例价值优先：一条高价值行为回归优于多个低质量覆盖。

## 维护动作（每次提交前）

1. 更新本次影响到的条目；
2. 对新条目给出 `status: VERIFIED/BLOCKED/TODO`；
3. 在 PR 描述中引用对应条目和测试文件路径。

## Frontmatter 规范

证据文件使用 YAML frontmatter 定义可执行的 metrics：

```yaml
---
dimension: testability          # 维度名称
weight: 14                      # 权重百分比
threshold:
  pass: 80                      # 通过阈值
  warn: 70                      # 警告阈值

metrics:
  - name: ts_test_pass          # 指标名称
    command: npm run test:run 2>&1   # 执行命令
    pattern: "Tests\\s+passed"  # 成功匹配正则（可选）
    hard_gate: true             # 是否为硬门禁
---
```

### Metric 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 指标名称，用于显示 |
| `command` | 是 | Shell 命令，建议加 `2>&1` 捕获 stderr |
| `pattern` | 否 | 成功匹配的正则，未设置则用 exit code |
| `hard_gate` | 否 | 硬门禁失败直接阻断（默认 false）|

## 添加新维度示例

创建 `docs/fitness/e2e-test.md`：

```yaml
---
dimension: e2e
weight: 10
threshold:
  pass: 90
  warn: 80

metrics:
  - name: playwright_e2e
    command: npx playwright test --reporter=line 2>&1
    pattern: "\\d+ passed"
    hard_gate: false
---

# E2E 测试证据

## 测试清单
- [ ] Home → Agent Selection → Requirement Input
- [ ] Workspace Detail → Session Click → Trace UI
```

## 验证 AI 理解

添加新维度后，可用以下命令测试 AI 是否正确理解：

```bash
# 测试 AI 是否能识别新维度
claude -p "fitness 有哪些维度？每个维度的权重是多少？"

# 测试 AI 是否能解析 frontmatter
claude -p "e2e-test.md 的 frontmatter 定义了哪些 metrics？"

# 测试 AI 是否能执行检查
claude -p "请执行 fitness 检查的 dry-run"
```

## 模块架构

执行引擎位于 `tools/entrix/`，按《Building Evolutionary Architectures》概念分层：

```
entrix/
  model.py          → 领域模型 (Tier, Metric, Dimension, FitnessReport)
  evidence.py       → 从本目录 *.md 加载 frontmatter → Dimension
  runners/shell.py  → Shell 命令执行
  runners/graph.py  → 代码图探针 (可选, 需 code-review-graph)
  scoring.py        → 加权评分
  governance.py     → 策略过滤 (tier, hard gate)
  reporters/        → 终端 / JSON 输出
  structure/        → 代码图集成层 (Protocol + Adapter)
  cli.py            → CLI 入口
  server.py         → MCP server (可选)
```
