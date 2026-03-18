# Fitness Function Rulebook

> **Defense-in-Depth**: 摒弃传统针对 DX 的"宽容度"，用硬性约束封锁 AI 的乱写空间。

## 防御理念

通过持续演进的架构约束实现深度防御：

- **控制爆炸半径**: 通过权限和行为约束限定 AI 的操作范围
- **反熵增机制**: 设立质量门槛与技术债检查（Linter、静态分析），将 AI 的解空间限制在安全边界内
- **契约优先**: `api-contract.yaml` 作为单一事实来源，双后端必须一致

## Quick Start

```bash
# 快速检查（仅 fast tier，<30s）
python3 docs/fitness/scripts/fitness.py --tier fast

# 标准检查（fast + normal tier，<5min）
python3 docs/fitness/scripts/fitness.py --tier normal

# 完整检查（所有 tier，<15min）
python3 docs/fitness/scripts/fitness.py

# 并行执行（加速）
python3 docs/fitness/scripts/fitness.py --parallel

# 仅查看会执行什么（不实际运行）
python3 docs/fitness/scripts/fitness.py --dry-run
```

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
1. AGENTS.md           → 项目概述 + Fitness 入口
2. README.md           → 规则手册（本文件）
3. unit-test.md        → 单元测试证据（含 frontmatter）
4. rust-api-test.md    → API 契约证据（含 frontmatter）
5. scripts/fitness.py  → 解析 frontmatter，执行检查
```

## Score Model

```
Fitness = Σ (Weight_i × Score_i) / 100

阻断: < 80 | 强告警: 80-90 | 通过: ≥ 90
```

## Dimensions (八大维度)

| 维度 | 权重 | 描述 | 关键指标 | 证据文件 |
|------|------|------|----------|----------|
| code_quality | 18% | 代码质量与架构 | Lint通过, 无循环依赖, 文件≤1000行 | [code-quality.md](code-quality.md) |
| testability | 20% | 测试覆盖与通过率 | 覆盖率≥80%, 通过率100% | [unit-test.md](unit-test.md) |
| security | 20% | 依赖漏洞与安全扫描 | critical=0, high≤阈值 | [security.md](security.md) |
| api_contract | 10% | API 契约测试 | Rust API 测试通过, 契约同步 | [rust-api-test.md](rust-api-test.md) |
| design_system | 10% | 设计系统质量 | 视觉回归, 可访问性, 性能 | [design-system-quality-layers.md](design-system-quality-layers.md) |
| evolvability | 8% | API 兼容性与契约 | breaking changes=0, parity=100% | [api-contract.md](api-contract.md) |
| ui_consistency | 8% | UI 一致性 | Shell 组件覆盖, Token 接入 | [design-system-shell.md](design-system-shell.md) |
| change_impact | 6% | 变更影响与爆炸半径 | graph probe 可运行, 宽 blast radius 告警 | [change-impact.md](change-impact.md) |

**Total: 100%**

## Hard Gates

硬门禁失败直接阻断，不计入评分：

| Gate | 命令 | 阈值 |
|------|------|------|
| ts_test_pass | `npm run test:run` | 100% |
| rust_test_pass | `cargo test --workspace` | 100% |
| api_contract_parity | `npm run api:check` | pass |
| lint_pass | `npm run lint` | 0 errors |
| no_critical_vulnerabilities | `snyk test` | 0 critical |

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
- `scripts/fitness.py`：解析 frontmatter，执行命令，输出结果。
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
