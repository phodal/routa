---
title: 从 AutoDev 到 Routa：开放生态下的新一代多 Agent 编排实践
date: 2026-03-02
---

# 从 AutoDev 到 Routa：开放生态下的新一代多 Agent 编排实践

> Routa 是一个 **“工程化的多 Agent 协作框架”**：它把任务、状态、事件和执行拆成可控模块，让开放生态下的多 Agent 系统可以真正落地，而不是靠
> Prompt 默契拼接。

年前，在为某客户设计基于 OpenCode / Claude Code 的 AI Coding 解决方案时，围绕 ACP（Agent Client Protocol）这一通用化、
标准化的 Coding Agent 协议，我开始重新思考一个问题：

> 在开放生态下，多 Agent 系统应该如何构建？

这一次的探索，与我们在 AutoDev 中所设计的多 Agent 体系有着本质差异。

AutoDev 更强调“自研一体化”的多 Agent 架构：自研 Agent、自研调度、自研协作机制等。而在 Routa 中，我们尝试构建一个更加开放的编排系统。
它不再依赖单一实现，而是面向生态进行协作与整合。在新的 Routa 架构中：

- 可以接入不同实现的 Coding Agent（如 Codex、OpenCode、Qwen Code 等），而不局限于 AutoDev Agent
- 基于 Tool 的 Agent 协同体系，通过 MCP Server 提供 Agent 创建、调度与工具能力
- 通过统一的结构化 Spec/Tasks 进行意图编排，而非依赖 Prompt 级别的隐式协作

在这篇文章里，我们将讲述**Routa 的多 Agent 体系是如何组织起来的，以及为什么这样设计。**

PS：在设计 Routa，我们参考了 Augment Code 的 Intent、JetBrains 的 ACP 管理等。

<!-- truncate -->

## 从经验到方法：Routa 的三个取舍

与其说是“原则”，不如说是三种工程取舍。

### 取舍一：优先开放协作，而不是绑定单一实现

在 Routa 里，Agent 是可替换的能力单元，不是系统的中心。系统中心是“协作协议与任务流”。这意味着：

- 你可以按场景接入不同的 Coding Agent：Claude Code、OpenCode、Codex 等
- 你可以在不重写业务逻辑的前提下切换 Provider
- 你可以随着生态变化持续替换底层能力

一句话总结：**Routa 关注的是“如何把人和 Agent 组织成有效协作”，而不是“押注某个固定 Agent 实现”。**

**从 FinOps 视角看**，角色分工不仅是工程整洁，更意味着 **"算力成本的分层优化"**：ROUTA 规划者需要全局视野，可以使用昂贵且强大的模型（如
GPT-4o / Claude 3.5 Sonnet），而部分 CRAFTER 执行者或独立验证动作可以路由给本地运行的、成本更低的专有模型（如 Qwen Code /
DeepSeek Coder）。这展现了 Routa 在企业级部署时对 **"Token 经济学"** 的考量。

### 取舍二：优先角色分工，而不是全能 Agent

多 Agent 失败的常见原因是角色塌缩：同一个 Agent 既负责规划又负责实现还负责验收，最后责任边界消失。Routa 与其它 MAS
系统一样，把角色拆开，
并强调边界：

| 角色                   | 主要职责           | 边界       |
|----------------------|----------------|----------|
| ROUTA（Coordinator）   | 规划、拆解、委派、汇总    | 不直接写实现代码 |
| CRAFTER（Implementor） | 按任务完成实现        | 不扩大任务范围  |
| GATE（Verifier）       | 按验收标准验证结果      | 不替代实现职责  |
| DEVELOPER（Solo）      | 单 Agent 交付完整任务 | 适用于轻量场景  |

这种分工的价值很直接：出问题时知道该看哪里，做复盘时知道谁对什么负责。在创建 Agent 时，只需要关注它应该完成的任务，而不需要关注它
如何完成任务。

### 取舍三：优先可验证交付，而不是“提示词默契”

在多 Agent 协作里，真正昂贵的是“对齐成本”：目标是否一致、范围是否一致、完成标准是否一致。Routa 的做法是把参考 Intent 任务描述结构化，
而不是只靠自然语言约定。每个任务至少要回答四件事：

1. 目标是什么（Objective）
2. 范围是什么（Scope）
3. 完成标准是什么（Definition of Done）
4. 怎么验证（Verification）

当这些信息被结构化后，协作就从“靠经验”变成“可检查、可追踪、可复用”。

## Routa 的多 Agent 体系

简单说，Routa 是一个 **多 Agent 协作的“协调平面”**。它不替代任何外部 Agent，而是让不同的 Agent 在工程上可以**可控、可追踪、可验证地协作
**。

换句话说：

* 它知道“任务是什么、谁执行、结果如何回报”
* 它提供稳定的“动作接口”，上层不需要关心内部实现
* 它让异步的多 Agent 协作变成一种可观察、可管理的工程能力

你可以把它想象成：

> Routa = 结构化大脑 + 事件驱动协调器 + 状态管理器

### Routa 的核心特性

1. **协议融合架构**。Routa 内部通过 **ACP** 管理 Agent 进程生命周期，通过 **MCP** 暴露协作工具，并支持 **A2A Bridge**
   以实现跨平台联邦扩展。三者分工明确：MCP 管工具、ACP 管客户端进程、A2A 管联邦协作——这种"用垂直协议做水平协同"的设计，让
   Routa 能够无缝接入异构 Agent 生态。
2. **结构化任务**。任务不是随意的文本，而是包含目标、范围、验收标准等字段的结构化对象；这样每个 Agent 执行的任务都是可追踪的，协作结果可以直接验证。
3. **事件驱动协作**。系统用事件流来推动任务状态，从"等待执行"到"任务完成"，每一步都可观测；这不仅让多 Agent
   并发协作不会变成混乱的轮询或黑箱，更为企业提供了每一级 Agent 决策的 **"白盒化"审计日志（Audit Trails）**。
4. **工具化能力暴露**。协作动作被封装成"可调用工具"，比如 `create_task`、`delegate_task_to_agent`、`subscribe_to_events`、
   `report_to_parent` 等；上层 Agent 或前端可以直接调用，而不需要关心内部执行细节。
5. **状态持久化与容错恢复**。同一套协作语义，可以在 Web、桌面或其他部署环境复用；通过结构化的 Task 和
   Stores，系统能从断点快速恢复执行（Resilience），而不是从头开始消耗 Token。

在**工具化能力暴露**这一点上，我们主要参考的是 Intent 的设计和实现。

## HOW：Routa 如何把开放编排落成工程能力

这一节会刻意把描述落在“代码里的抽象”，而不是停留在口号：你看得到它们在哪一层、负责什么，以及为什么这些边界能支撑开放生态下的多 Agent 协作。

### 0）先统一系统边界：`RoutaSystem` 是“协调平面的组合件”

Routa 在代码里把“协调平面”收敛成一个中心对象：`RoutaSystem`。它不等于某个 Agent，而是把协作所需的基础设施组合起来：

- **Stores（状态持久化与容错恢复）**：`AgentStore` / `TaskStore` / `ConversationStore` / `WorkspaceStore`。这些 Store 提供了
  **状态持久化**能力——如果某个 CRAFTER 陷入死循环（类似 AutoGen 常被诟病的对话混乱），或者发生网络中断，Routa 的架构能够依靠结构化的
  Task 和 Stores **从断点恢复执行**，而不是从头开始消耗 Token。
- **EventBus（可观测性与审计追踪）**：不仅把协作推进从"轮询脚本"变成"可订阅事件流"，更为企业提供了每一级 Agent 决策的**白盒化审计日志**。
  基于事件驱动架构，系统的每一次状态变更、任务委派、结果汇报都被完整记录，满足企业级的 Governance 和 Auditability 需求。
- **Tools（动作入口）**：`AgentTools` / `NoteTools` / `WorkspaceTools`，把“要做什么”固定成可调用的动作

同时，`RoutaSystem` 支持多种存储形态（InMemory / Postgres / SQLite）但保持同一套接口：这让"运行形态变化"
不需要重写协作语义。这种设计也为"时间旅行（Time Travel）"调试能力奠定了基础——在复杂企业级场景下，能够追溯和回放任何一次协作过程。

### 1）把协作动作变成协议工具：Tools → MCP 工具面

在 Routa 里，“创建任务、委派、订阅事件、汇报结果”不是散落在各处的私有调用，而是统一走 `Tools` 的门面，然后再被注册成 MCP 工具。

关键点是：`RoutaMcpToolManager` 会把这些动作注册到 MCP Server 上（例如 `create_task`、`delegate_task_to_agent`、`subscribe_to_events`、`report_to_parent` 等）。这样上层接入任意支持 MCP 的外部 Agent 时，拿到的是一组**稳定的工具集合**，而不是一堆“需要记住的提示词约定”。

对应的工程收益：

- 协作能力是“接口契约”，可以版本化、可测试
- Provider 侧只要能连上 MCP，就能调用同一套协调动作（配置差异交给适配层处理）

### 2）把“任务”当作数据结构：`Task` 字段贯穿创建→执行→验收

Routa 不是把任务当成一段聊天上下文，而是把它当成一等数据对象：

- **意图字段**：title / objective / scope
- **交付字段**：acceptanceCriteria（Definition of Done）
- **验证字段**：verificationCommands（可执行的验证入口）
- **编排字段**：dependencies / parallelGroup / status / assignedTo

这也是为什么 Routa 可以把“对齐成本”从人脑记忆，迁移到结构化字段：同一个任务在不同 Agent 之间流转时，口径不会随着对话漂移。

**从混合记忆（Hybrid Memory）架构的视角看**，Task 的结构化字段实际上是极佳的 **工作记忆（Working Memory）隔离** 实践。Routa
通过结构化字段切断了不必要的聊天上下文（Chat History），这不仅降低了 Prompt 对齐成本，更避免了无关信息在 Agent 之间传递导致的
**注意力偏移（Distraction）**，相当于在架构层面实现了优秀的**上下文管理（Context Management）**，有效防止长周期任务中的"
上下文腐化（Context Rot）"。

### 3）用事件驱动解决异步协作：`EventBus` 提供订阅语义，而不是靠轮询

多 Agent 协作一旦并发起来，最先失控的是“状态同步”：谁完成了？谁卡住了？该不该汇总？

Routa 在工程上把它收敛到 `EventBus`：

- 统一事件类型（例如任务状态变化、汇报提交、Agent 完成等）
- 支持一次性订阅（one-shot）、优先级投递（priority）、以及 `after_all` 这类“等一组都完成再通知”的 wait-group 语义
- 支持 pre-subscribe（先订阅再触发动作），避免竞态条件把事件丢掉

对应的工程收益：并发规模变大时，协作推进仍然是可观察、可解释、可回放的。

**从企业级治理（Governance）视角看**，EventBus 的价值远不止解决异步协作的状态同步问题。它实际上构建了系统的 *
*可观测性（Observability）** 基础设施：每一次 Agent 决策、每一次任务状态变更、每一次汇报提交都被完整记录，形成可审计的事件链。
这让企业在面对合规审查或事故复盘时，能够精确追溯" 谁在什么时候做了什么决策"。

在指标上，可以结合 Agent Trace 等工具，来构建 AI 的可度量性（Metrics）：例如，可以度量 Coding Agent 带来的效率提升。

### 4）委派不止是“分配”，而是“生成可运行的子执行单元”：`RoutaOrchestrator`

很多 MAS 的“委派”停留在“把任务文本转发给另一个 Agent”。Routa 更进一步：当 Coordinator 使用委派工具时，`RoutaOrchestrator` 会把一次委派落成完整的执行链路：

1. 创建子 Agent 记录（带 role、parentId、modelTier 等边界）
2. 生成面向角色的 delegation prompt（由 specialist 配置驱动，例如 CRAFTER/GATE）
3. 通过 ACP process manager **拉起一个真实的外部 Agent 进程/会话**，把任务作为初始输入
4. 订阅 `REPORT_SUBMITTED` 等事件，在子 Agent 回报后唤醒父 Agent，形成闭环

这个设计把“角色化协同”从概念落实为运行时机制：你能追踪每个子 Agent 的会话、状态、回报，并让汇总动作有明确触发条件。

### 5）多后端不是重复实现，而是语义对齐：同一套 API / 同一套协作模型

Routa 同时支持 Web 与桌面形态，本质不是“做两套系统”，而是把协作语义抽象清楚后，在不同运行时提供相同的 API：

- Web 侧可以用 Next.js/TypeScript 提供 REST/MCP 接入
- 桌面侧可以用 Rust（axum）实现同样的 HTTP 层（并复用核心领域概念），本地用 SQLite 保证稳定与可移植

对使用者来说，差异被压缩到“部署与存储选择”，而不是“协作流程要重写”。

## 总结

从 AutoDev 到 Routa，变化的不是“换了哪个模型”，而是方法论：

- 从“自研一体化”走向“开放协作”
- 从“全能 Agent”走向“角色化协同”
- 从“Prompt 默契”走向“可验证交付”

Routa 不是要替代所有 Agent，而是要成为一个稳定的多 Agent 协调平面：让外部能力可以接入，让协作过程可控，让交付结果可验证。
