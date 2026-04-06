---
title: 从建议到闭环：Routa 如何把 Harness Evolution 变成可回滚、可 Ratchet 的工程循环
date: 2026-04-06
---

# 从建议到闭环：Routa 如何把 Harness Evolution 变成可回滚、可 Ratchet 的工程循环

## 问题不在于 Agent 会不会改文件，而在于系统知不知道什么时候该停

在 AI Coding 场景里，"会改配置"从来不算稀缺能力。真正稀缺的是另一件事：**系统能不能判断，这次演进已经真正成立，而不是只是在仓库里留下了一批看起来合理的改动。**

这也是 Harness Engineering 一直会碰到的核心矛盾。

如果系统只能输出建议，那它更像一个报告器；如果系统能直接改文件，但没有验证和回退，它又只是一个更激进的脚本。真正的工程闭环，需要同时回答五个问题：

- 观察到了什么
- 判定出了什么 gap
- 准备如何修改
- 修改后如何证明没有把系统变差
- 如果真的变差了，能不能自动撤回

这一次在 Routa 里完成的，不是再加一个 specialist，也不是再补一个 YAML 模板，而是把 `routa harness evolve` 从一个 **dry-run 建议器** 收束成一个真正的 **observe → evaluate → synthesize → verify → ratchet** 循环。

## 为什么 "verify" 还不够

很多自动化系统做到 verification 就会停。逻辑通常是：

1. 改动落盘
2. 跑一组命令
3. 命令通过
4. 认为本轮演进成功

这个模型对传统脚本够用，但对 Agent Loop 不够。

因为 verification 证明的是"这次改动没有立刻炸"，并不证明"系统整体能力没有倒退"。

一个很典型的例子是 harness surface 演进。你可以成功生成 `docs/harness/build.yml` 和 `docs/harness/test.yml`，verification 也会通过，因为目录存在、格式合法、doctor 能跑。但这仍然不代表仓库的 Harness Fluency baseline 得到了维持。你完全可能在做出局部可执行改动的同时，把更高层的完成条件能力拉低。

所以 Routa 这里缺的不是再多一条 verification command，而是缺一个更高层的判定：

> 这次改动虽然"能运行"，但它到底有没有让仓库在 fluency baseline 上回退？

这就是 ratchet 的意义。

## Routa 这次补的是一条完整的 Harness Evolution Loop

新的 `harness evolve` 闭环可以概括为：

```text
observe
  → 读取 repo signals / docs/harness / automations / spec sources / fluency snapshots
evaluate
  → 输出结构化 gap classification
synthesize
  → 给出 low-risk patch candidates
verify
  → apply 后立即执行 verification plan
ratchet
  → 重跑 fluency baseline，对比旧 snapshot，若回退则整轮 rollback
```

它不再只是输出一个"建议你加点什么"的报告，而是形成了一个明确的状态机：

- `dry-run` 时，只给出 patch candidates 和 verification plan
- `apply` 时，只自动落低风险 patch
- patch 之后，必须先过 verification
- verification 通过后，还必须过 ratchet
- ratchet 一旦发现 baseline 回退，整轮变更直接 rollback

换句话说，**现在的 Harness Evolution 已经具备了一种最小可用的“自我否决机制”。**

## 这次实现里，最关键的三个工程决策

### 1. Ratchet 不靠额外 shell 拼接，而是直接复用 Fluency evaluator

最容易想到的做法，是在 `harness evolve --apply` 后再 shell 一次：

```bash
routa fitness fluency --compare-last
```

这当然能跑，但不够稳定。因为一旦把 ratchet 逻辑放在命令行输出层，就不得不面对更多字符串解析、输出污染和上下文漂移问题。

Routa 这次没有把 ratchet 做成"命令套命令"，而是直接复用了 Rust 里的 fluency evaluator，把 baseline comparison 拉回结构化对象层。这样做有几个好处：

- 能直接拿到 `HarnessFluencyReport`
- 能直接比较 overall level、dimension changes、criteria changes
- 可以把 baseline score delta 变成明确字段
- 可以把 ratchet 结果直接挂进 `harness evolve` 的最终 report

所以现在的 report 不再只有 `verificationResults`，还会多一段 `ratchet`：

```json
{
  "ratchet": {
    "enforced": true,
    "regressed": false,
    "profiles": [
      {
        "profile": "generic",
        "status": "stable",
        "currentOverallLevel": "agent_centric",
        "baselineScoreDelta": 0.02
      }
    ]
  }
}
```

这意味着 `harness evolve` 已经不再只是"本轮动作记录器"，而是开始携带自己的基线判定结果。

### 2. Ratchet 失败不是 warning，而是 rollback signal

如果 ratchet 只是在报告里写一句"这次回退了"，那它的工程价值其实很有限。因为系统还是会把坏结果留在仓库里。

这次实现刻意把 ratchet failure 提升成和 verification failure 同等级的 rollback signal。

也就是说，apply 流程现在实际变成：

```text
apply patch
  → verification
    → ratchet
      → persist
```

只要 verification 或 ratchet 任何一步失败：

- 本轮文件变更回滚
- fluency snapshot 不写回
- evolution history 记录失败结果

这里真正重要的不是"有 rollback"，而是 **rollback 的触发条件被前移到了 baseline 层**。系统开始承认一种以前不会被脚本承认的失败：

> 命令都通过了，但这次演进仍然不应该保留。

这类失败，在 Agent 时代非常常见。

### 3. 闭环里顺手暴露了另一个事实：契约漂移会在最意想不到的地方冒出来

这次在补闭环时，`entrix` 的 hard gate 顺手暴露了一个很典型的问题：`GET /api/graph/analyze` 已经在 Next.js 里存在，并且前端组件已经真实依赖，但它没有进入 API contract，也没有 Rust 对应实现。

这个问题很有代表性，因为它说明：

- 实现已经存在
- 前端已经在用
- 局部功能也没有报错
- 但系统整体语义其实已经开始漂移

如果没有 API parity gate，这种问题很容易长期潜伏。

所以这次顺手补上的不只是一个 endpoint，而是一个更直白的工程事实：**闭环从来不只会抓出“本次新增逻辑”的问题，它还会把系统里已经形成但尚未暴露的漂移一起拉出来。**

最后的修复方式也保持了 Routa 一贯的语义：

- 在 `api-contract.yaml` 里把 `/api/graph/analyze` 补进单一事实来源
- 在 Rust backend 增加对应路由
- 底层仍复用 `routa-cli graph analyze`，而不是在 server 里复制一套分析引擎

这不是额外工作，而是闭环本来就应该迫使系统完成的对齐动作。

## 这次改完后，`harness evolve` 的角色发生了变化

在此之前，`harness evolve` 更像：

- 一个 harness gap evaluator
- 一个 patch proposal generator
- 一个带 apply 能力的低风险脚本

现在它更接近：

- 一个受控的 harness mutation engine
- 一个内建 verification gate 的 patch executor
- 一个受 fluency baseline 约束的 ratcheting loop

这三个角色的差异很大。

第一种工具只是告诉你"哪里有问题"。第二种工具会帮你改。第三种工具则开始具备真正的工程边界：它不仅能改，还知道什么情况下必须拒绝保留自己的改动。

这就是这次变化最重要的地方。

## 为什么这件事对 Harness Engineering 很关键

如果把 Harness Engineering 理解成"给 Agent 多补几份上下文、多加几条脚本、多挂几个 specialist"，那它最后很容易沦为另一个堆配置系统。

真正的 Harness Engineering 不只是增加能力入口，而是要构造一条让系统可以持续自证、持续自否定、持续收敛的工程循环。

从这个角度看，这次 `harness evolve` 闭环补完了三个以前缺失的语义：

- **完成不是 patch 写完，而是 patch + verification + ratchet 都成立**
- **失败不只是命令失败，也包括 baseline regression**
- **回退不是人工善后，而是系统内建的一等路径**

这三点合起来，才让 Harness Evolution 开始有资格被称作"闭环"。

## 还有什么没做完

闭环已经成立，但它还没有到终局形态。

接下来最自然的演进方向至少还有三条：

### 1. 从 fluency snapshot 扩展到更多 baseline surface

现在 ratchet 主要盯的是 fluency baseline。后面完全可以继续扩展到：

- coverage threshold
- review trigger completeness
- automation drift baseline
- operational docs readiness

这意味着未来的 `harness evolve` 不只是比较一个 fluency score，而是比较一组工程基线。

### 2. 从 low-risk patch 扩展到更细的 mutation policy

现在的 apply policy 仍然比较保守：低风险自动、medium/high-risk 需要 `--force`。这很合理，但后续还可以继续往前走：

- 按文件类型控制风险
- 按 repo profile 调整 allowlist
- 按 baseline maturity 决定自动化程度

也就是说，**autonomy band** 最终也可以反向作用到 harness mutation policy 本身。

### 3. 从单次演进报告扩展到真正的 evolution history

现在已经有 `history.jsonl`，但它更像 apply history，而不是完整的 evolution ledger。后面如果继续做，会很自然地发展成：

- 记录每次 patch set
- 记录 verification / ratchet verdict
- 记录 baseline delta
- 记录被拒绝的 mutation 类型

一旦这个账本稳定下来，Harness Engineering 就不只是"让 Agent 改仓库"，而是在建立一种面向演进的工程记忆。

## 结语：闭环的价值，不是让系统更激进，而是让系统知道什么时候该撤回

很多人会把 Agent 系统的进步理解成"能做更多事"。但在工程语境里，更重要的进步往往不是扩张能力，而是收紧边界。

这次 Routa 给 `harness evolve` 补上的，不只是 apply、verification 和 ratchet 这些功能名词，而是一种更重要的工程语义：

> 系统不再把“改动成功落盘”当作成功，而是把“改动在基线上没有造成回退”当作成功。

这是一个很小的变化，也是一条非常硬的边界。

因为从这一刻开始，Harness Evolution 不再只是帮 Agent 往前走，它也开始有能力在该停的时候让系统停下来，在该撤回的时候把变更撤回。

而这，才是一个真正可用的工程闭环的起点。
