---
title: "When Agents Join the Board: From Coordination to Computability"
date: 2026-03-19
---

# When Agents Join the Board: From Coordination to Computability

*When execution shifts from humans to agents, Kanban must evolve from a collaboration interface into a governable system.*

## A Kanban Board Is Not a Workflow Until It Has Semantics

在大多数团队中，看板的首要价值是“让工作可见”。列的设计围绕协作展开：To Do、In Progress、Done，辅以 WIP 限制与简单规则。这种设计在以人为执行者的系统中是有效的，因为人类能够用经验补全规则的缺口。

但当 Agent 成为执行者，这种“弱语义”的看板开始暴露问题。Agent 无法理解“差不多完成”，也无法在不完备信息下做出判断。它们需要的是可判定的状态，而不是可解释的状态。

> **A workflow is not what you see on the board; it is what the system can decide.**

因此，看板必须发生一次根本性的转变：从“可视化工具”演进为“语义化工作流”。列不再只是阶段标签，而是状态机中的节点；卡片的移动不再是简单操作，而是一个需要被系统解释的状态转移。

Routa 代码库已经开始朝这个方向收敛。卡片列变化不会只更新 UI，而是会发出 `COLUMN_TRANSITION` 事件；随后由 `KanbanWorkflowOrchestrator` 读取 board 配置、判断目标列是否配置了自动化步骤、是否需要创建 session、是否应该自动前进，甚至是否需要进入恢复流程。列在这里已经不只是“显示位置”，而是工作流控制点。

如果缺乏这种语义，自动化只会放大系统的不一致，而不会提升效率。

## Columns Must Behave Like States, Not Labels

传统 Kanban 的一个隐含前提是：列是标签，而不是严格的状态。团队可以接受列之间存在模糊边界，因为人类可以用上下文自行修正。

但在 Agent 系统中，这种模糊性会迅速演变为系统性错误。

如果系统中存在两个不一致的状态模型，例如一个用于展示的列结构，另一个用于业务逻辑的状态枚举，那么人类可以在两者之间“脑补一致性”，而 Agent 只能在边界条件上不断失败。

> **If your system has two states, your system has no state.**

从建模角度看，这违反了一个基本原则：

> 一个工作流只能有一个状态机，所有视图都必须是它的投影。

Routa 当前的实现很接近这个问题的真实边界。一方面，board 明确有 `backlog`、`todo`、`dev`、`review`、`done`、`blocked` 等列；另一方面，任务状态通过 `TaskStatus` 映射到这些列时，并不是完全一一对应。这个细节很重要，因为它提醒我们：一旦列承担了自动化语义，列和状态就不能只是“差不多一致”。它们必须由同一个工作流模型驱动。

只有当列具备明确的状态语义时，看板才真正成为可执行系统的一部分。

## Every Transition Should Be an Explicit Contract

在人类团队中，卡片流转往往是一种“软约定”。拖动卡片意味着“差不多完成”，评论意味着“请你接手”。这些行为依赖共识，而不是系统约束。

但 Agent 无法依赖共识。每一次流转，都必须是一个显式契约。

一次状态转移不仅是“从 A 到 B”，还隐含着一组需要被系统处理的问题：是否允许进入目标状态，是否需要触发执行，失败时如何处理，是否需要回退或重试。

> **A transition is not movement; it is a decision.**

这与 Kanban 中“明确交接”的实践是一致的，但在 Agent 系统中，它必须被提升为可执行协议，而不是团队习惯。

Routa 在这一点上的做法很值得注意。手动 PATCH 任务进入新列时，系统会先检查是否仍有当前泳道内未完成的自动化 step；如果同列内还有下一个 specialist 要运行，就会直接阻止移出该列。换句话说，列之间的流转已经不是任意拖拽，而是一个由运行时状态决定的契约。对于 Agent 来说，这比“允许移动，再靠人纠正”要可靠得多。

当流转成为契约，工作流才具备可预测性与可组合性。

## A Gate Is a Policy, Not a Checklist

Kanban 中的 Definition of Done，本质上是一种质量门。但在很多团队中，它逐渐演变为 checklist：只要提交了某些产出，就被视为“完成”。

这种做法在人类系统中尚可运行，但在 Agent 系统中会迅速失效。

真正的 Gate 关注的不是“是否存在证据”，而是：

> 这些证据是否允许进入下一状态。

> **Evidence is not validation; passing a gate is a decision, not a presence.**

Routa 已经实现了 Gate 的第一层语义。列自动化配置允许声明 `requiredArtifacts`，例如 `screenshot`、`test_results`、`code_diff`；当卡片进入目标列前，系统会检查这些 artifact 是否已经存在。与此同时，dev lane 的监督模式还可以要求 session 不只是“结束”，而是必须留下 `completionSummary` 或 `verificationReport` 才算满足完成条件。

这已经比“靠口头说明完成了”前进了一大步。但这套设计也清楚地暴露出下一步该往哪里演化：Gate 还需要从“存在性检查”走向“策略判定”。例如，系统已经有 `verificationVerdict` 字段，但当前前进条件仍主要看报告是否存在，而不是 verdict 是否允许放行。这恰恰说明 Gate 不应该只是表单字段，而应该是一等公民的 policy object。

当 Gate 被提升为策略，系统才真正具备治理能力。

## Orchestration Is More Important Than Automation

引入 Agent 时，一个常见误区是试图“自动化每一列”。看板因此被拆解为一组独立的自动执行节点，每个节点只关注自己的局部任务。

但这会导致系统失去整体控制。

Kanban 的核心不是自动化，而是“管理流动”。当执行者变成 Agent，这一原则变得更加重要。系统需要一个统一的控制层来决定何时开始、何时停止、何时重试以及何时前进。

> **Automation executes; orchestration decides.**

在 Routa 中，真正承担这个职责的不是某一个 specialist prompt，而是 `KanbanWorkflowOrchestrator`。它监听 `AGENT_COMPLETED`、`AGENT_FAILED`、`AGENT_TIMEOUT` 与 `REPORT_SUBMITTED`，维护 active automations，判断当前列是否需要恢复，是否存在下一个 lane step，是否应该自动推进到下一列。它还会在 dev 阶段配合 watchdog 与 `ralph_loop` 这样的 supervision mode，对长期无活动的 session 进行恢复或重试。

自动化关注的是“能不能做”，而编排关注的是“什么时候做、是否应该做”。前者提升效率，后者保证系统行为的可预测性。

在 Agent 系统中，后者更为关键。

## Work History Must Be First-Class, Not Incidental

在人类团队中，协作历史通常是副产品。它分散在评论、提交记录和即时通信中，只有在需要时才被回溯。

但在 Agent 系统中，历史必须成为一等公民。

每一次责任转移、每一个决策理由、每一次失败与恢复路径，都需要被显式记录。否则，系统将无法解释自身行为，也无法持续改进。

> **If you cannot replay the work, you do not understand the system.**

Routa 在这方面的实现非常有代表性。任务并不只保存一个 `triggerSessionId`，而是保存 `laneSessions` 与 `laneHandoffs`。前者记录某个 session 属于哪个列、哪个 step、哪个 specialist、何时开始、何时完成、是否 recovery；后者记录相邻泳道之间的请求与响应，例如 environment preparation、runtime context、clarification 或 rerun command。

这意味着多 Agent 协作不再只是“一段对话”，而是“可回放的执行路径”。更进一步，Agent 通过 MCP 工具更新任务时，不只是改标题和状态，也可以回写 `completionSummary`、`verificationReport` 与其他结构化字段。对系统来说，这些字段并不是备注，而是可治理工作流的一部分。

这与 Kanban 中“度量流动”的原则形成呼应。只是这里的度量不再是简单的时间指标，而是可追溯的执行路径。

当历史成为系统的一部分，观测与治理才有基础。

## Execution Context Matters More Than the Card

传统看板默认卡片描述了工作本身。但在软件交付里，一项工作是否可执行，往往不只取决于描述是否清晰，还取决于它在哪个仓库、哪个分支、哪个 worktree、哪个运行时上下文里被执行。

> **In software delivery, work is never detached from its execution context.**

Routa Kanban 的一个重要进展，是把这些上下文从隐性背景提升成显式领域对象。任务可以绑定 codebase，进入 `dev` 列时可以自动创建 worktree，任务会记录当前 session 与 lane 历史，Agent prompt 里还会明确告诉执行者应该优先使用哪些 Kanban MCP 工具，何时可以 `move_card`，何时必须先补齐 artifact。卡片因此不再只是“描述单元”，而开始接近“执行单元”。

这件事很关键，因为没有执行上下文，Agent 就只能依赖脆弱的聊天记忆；而一旦上下文被纳入工作流模型，看板才有可能成为真正的 control plane。

## From Visualization to Computation

把这些变化放在一起，可以看到一个清晰的演进方向。

Kanban 最初解决的是可视化问题，让团队理解工作状态。随后，通过 WIP 限制与流动管理，它开始优化效率。而当 Agent 成为执行者后，系统面临新的要求：一切必须可判定、可执行、可验证。

> **Coordination tolerates ambiguity; computation does not.**

这推动看板从协作工具演变为执行系统：

- 列从标签变为状态
- 流转从操作变为契约
- Gate 从检查变为策略
- 历史从副产品变为系统资产
- 上下文从背景信息变为显式执行边界

软件工程的重心也随之发生转移。过去，我们关注如何协调人类的工作；现在，我们需要定义系统本身的行为边界。

> **When agents execute work, software engineering becomes a discipline of computability.**

当执行者变成 Agent，工程问题从“如何沟通”转向“如何计算”。Kanban 也不再只是一个管理界面，而成为一种可以被系统执行的语言。
