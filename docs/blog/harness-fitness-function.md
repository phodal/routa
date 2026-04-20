---
title: Harness Engineering 的下一步：用 Fitness Function 定义 AI Agent 的完成条件
date: 2026-03-16
---

# Harness Engineering 的下一步：用 Fitness Function 定义 AI Agent 的完成条件

## 当 Harness Engineering 开始落地，问题就不再只是"怎么生成代码"

Harness Engineering 之所以成为热门话题，是因为大家意识到 AI Coding 的问题不只是模型能力问题。上下文工程、提示词策略、多 Agent 协作都很重要，但这些讨论大多停留在生成侧。一旦 AI Agent 真正进入软件交付流程，另一个更棘手的问题就会浮现：**系统究竟如何判断，这个 Agent 已经完成了任务？**

过去"完成"被包裹在人类经验里——开发者写完代码、跑过测试、提交 PR、经过 review，团队形成共识。但在 Agent Loop 中，这种默认前提不再成立。Agent 可以很快生成代码、修掉报错，但它同样会制造另一类结果：代码看起来已经完成，实际上只是完成了一半。

这类问题并不抽象：功能路径跑通，不代表负向路径被覆盖；接口修改了，不代表契约同步了；测试数量增加，不代表关键不变量得到验证。**Harness Engineering 的下一步，是把"完成"从经验判断转化为可执行、可审计、可阻断的工程信号。**

<!-- truncate -->

## Fitness Function 在 AI 时代，不再只是架构概念

Fitness Function 来自演进式架构，用来持续验证系统是否满足架构特征。但在 AI Agent 参与开发后，它的角色发生了重要变化：**不再只是"架构质量检查"，而是成为一种完成条件机制。**

AI Agent 并不天然理解"什么叫真正做完"。它会把局部信号当成完成依据——命令执行成功了、测试绿了、报错消失了。但这些局部成功从来不等价于整体完成。Fitness Function 的新角色，就是把工程条件编码成 Agent 能消费的形式，明确告诉系统"哪些信号一旦没有出现，任务就不能被视为完成"。

Fitness Function 真正重要的地方，在于它能帮助系统重新建立可信的完成判断。它不再只是演进式架构术语，而是 Harness Engineering 的核心部件：**决定 Agent 在什么条件下才被允许退出循环。**

## Routa 的 Fitness 架构：一个工程回答

我们在 Routa 里直接在代码库中构建了一套完整的 Fitness 架构。Fitness 必须是仓库的一部分，能被 Agent 读取、被脚本执行、被 CI 消费，并在失败时阻断流程。

### 目录结构

```
docs/fitness/
├── README.md              # 规则手册：防御理念、维度定义、门禁规则
├── unit-test.md           # 测试证据：frontmatter + 验证状态
├── api-contract.md        # 契约证据：OpenAPI 一致性检查
├── rust-api-test.md       # API 测试矩阵
├── security.md            # 安全扫描规则
├── code-quality.md        # 代码质量规则
└── scripts/
    └── fitness.py         # 统一执行器：解析 frontmatter，执行检查
```

### 架构流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  AGENTS.md  │────▶│  README.md  │────▶│ 证据文件    │────▶│ fitness.py  │
│  (入口导航)  │     │  (规则手册)  │     │ (frontmatter)│     │ (统一执行器) │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                    ┌───────────────────────────────────────────────┘
                    ▼
            ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
            │   Hard Gate   │     │   评分汇总    │     │   CI 集成     │
            │  (阻断/通过)   │     │  (≥90 通过)   │     │  (门禁机制)   │
            └───────────────┘     └───────────────┘     └───────────────┘
```

入口从 `AGENTS.md` 开始，它只定义最小执行边界：代码变更后必须运行 Fitness 检查；提交必须保持 baby-step。对于 Agent 来说，**入口比说明更重要**——它需要先被带到正确的位置，而不是一上来理解整个世界。

## 规则必须可读，也必须可执行

我们把规则写进 Markdown 的 frontmatter 里，而不是写死在 CI 配置或外部 DSL 中。这样做的理由：如果规则只对机器友好，团队无法自然维护；如果规则只对人友好，系统无法统一执行。

### Frontmatter 示例

```yaml
---
dimension: testability
weight: 14
threshold:
  pass: 80
  warn: 70

metrics:
  - name: ts_test_pass
    command: npm run test:run 2>&1
    pattern: "Tests\\s+(\\d+)\\s+passed"
    hard_gate: true

  - name: rust_test_pass
    command: cargo test --workspace 2>&1
    pattern: "test result: ok"
    hard_gate: true
---
```

规则既是可阅读知识，也是可执行声明。新增一个 Fitness 维度，只需在 `docs/fitness` 目录下新增一个带 frontmatter 的 Markdown 文件。

## 证据文件：工程账本

规则声明只是第一层。一个可靠的 Fitness 系统还需要记录验证状态：哪些场景已经 `VERIFIED`，哪些仍然 `TODO`，哪些被标记为 `BLOCKED`。

```markdown
### 集成测试（与 API 行为强绑定）
- [x] notes 流程
  - status: `VERIFIED`
  - required: create/list/get/delete 的成功/失败闭环
  - evidence: `docs/fitness/rust-api-test.md`
- [ ] store: workspace
  - status: `TODO`
  - required: CRUD、查询过滤、归档状态一致性
```

证据文件不是普通的测试说明书，而是**工程账本**。它让代码库中的历史经验以稳定的方式被保存下来，成为 Agent 和执行器都能理解的验证上下文。

## 执行器：收回规则解释权

规则和证据都存在后，关键问题是：谁来解释它们？最危险的恰恰是这一步——规则虽然写下来了，但执行时总会出现模糊空间。

### fitness.py 核心逻辑

```python
def run_metric(metric: dict, dry_run: bool = False) -> tuple[str, bool, str]:
    """Run a single metric command and check result."""
    name = metric.get('name', 'unknown')
    command = metric.get('command', '')
    pattern = metric.get('pattern', '')

    result = subprocess.run(
        ["/bin/bash", "-lc", command],
        capture_output=True, text=True, timeout=300
    )
    output = result.stdout + result.stderr

    if pattern:
        passed = bool(re.search(pattern, output, re.IGNORECASE))
    else:
        passed = result.returncode == 0

    return name, passed, output
```

执行器扫描 `docs/fitness/*.md`，解析 YAML frontmatter，逐项执行命令，根据输出模式或退出码判定通过与否。它做了一件关键的事：**把规则解释权从人的经验中收回来，交给统一执行器。**

系统不再接受"这次应该问题不大"这种模糊表述，而只接受规则中声明过的命令、可观察的输出和门禁结果。

## 契约一致性：防止语义漂移

Routa 是双后端系统（Next.js + Rust/Axum），AI Agent 最容易制造的问题是**语义漂移**：某个局部修改本身是对的，但多个实现之间开始悄悄失去同构关系。

```yaml
# api-contract.md frontmatter
metrics:
  - name: openapi_schema_valid
    command: npm run api:schema:validate 2>&1
    pattern: "schema is valid|validation passed"
    hard_gate: true

  - name: api_parity_check
    command: npm run api:check 2>&1 && echo "api parity passed"
    pattern: "api parity passed"
    hard_gate: true
```

OpenAPI 文件被当作单一事实来源，要求契约优先于实现变更，要求 Next.js 与 Rust 两侧围绕同一组 endpoint 收敛。**契约优先，是在给 Agent 提供一个不容易漂移的重心。**

## Hard Gate：真正定义"完成"的地方

在 AI Agent 场景下，单纯的评分体系是不够的。Agent 天然会把"还不错"误解成"可以结束"。所以 Fitness 最终不是评分系统，而是**阻断系统**。

| Gate | 命令 | 阈值 |
|------|------|------|
| ts_test_pass | `npm run test:run` | 100% |
| rust_test_pass | `cargo test --workspace` | 100% |
| api_contract_parity | `npm run api:check` | pass |
| lint_pass | `npm run lint` | 0 errors |

Hard Gate 失败直接阻断，不计入评分。它把"质量折损"和"流程终止"明确区分开来。**Hard Gate 就是 Agent 时代的 Definition of Done**——在什么条件下，这个自动化参与者被允许退出循环。

## 结语：AI 时代的软件工程，需要重新发明"完成"

当越来越多的代码由 AI Agent 生成、修改与修复时，软件工程真正面临的变化，不只是"写代码的人变了"，而是"完成这件事的判定方式变了"。

Routa 的实践给我们的启发：用 `AGENTS.md` 提供入口导航，用 Markdown frontmatter 声明规则，用证据文件记录验证状态，用统一执行器收敛规则解释，用契约检查约束多实现一致性，再用 hooks 与 CI 把这一切接进完整的交付链路。

**Harness Engineering 最终要解决的，是软件工程里那个最根本的问题之一：当自动化参与者越来越多时，系统究竟如何重新定义"完成"。而 Fitness Function，正在成为这个问题最直接、也最工程化的答案。**
