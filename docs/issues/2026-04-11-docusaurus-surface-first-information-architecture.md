---
title: "Docusaurus docs need surface-first information architecture instead of repo-first navigation"
date: "2026-04-11"
status: open
severity: medium
area: "documentation"
tags: ["docs", "docusaurus", "information-architecture", "onboarding", "navigation"]
reported_by: "codex"
related_issues:
  - "2026-04-09-home-start-surface-and-onboarding-overload.md"
---

# Docusaurus 文档需要从 repo-first 导航转向 surface-first 信息架构

## What Happened

当前公开文档站点虽然已经能承载大量文档，但它的导航结构仍然更像“仓库内容树”，而不是“用户如何开始和如何做事”的信息架构：

- 首页同时承担 overview、quick start、开发环境启动、CLI 参考等职责。
- 顶部导航是少量页面入口，而不是稳定的文档域入口。
- 左侧侧边栏更多围绕 `design-docs`、`exec-plans`、`features`、`specialists` 等内部知识分类组织。
- `Desktop / CLI / Web` 三种 product surface 没有被作为一等 onboarding 决策对象呈现。
- `Quick Start` 与 `Development` 的语义边界不清，容易把安装使用路径和 contributor setup 混在一起。

结果是：用户进入文档后，首先看到的是“仓库里有什么内容”，而不是“我应该从哪个入口开始、我该用 Desktop 还是 CLI、接下来应该读什么”。

## Expected Behavior

文档站点应更接近 surface-first 的产品文档结构：

- 顶部导航按稳定文档域组织，例如 `Getting Started / Core Concepts / Platforms / Configuration / Reference`。
- `Overview` 页面先解释产品与各 surface 的差异，而不是直接进入开发启动命令。
- `Quick Start` 是独立页面，重点回答 `Desktop / CLI / Web` 分别如何开始。
- 左侧导航优先服务新用户的阅读路径，再暴露更深层的设计文档、执行计划、features 和 specialist 参考。
- `Desktop`、`CLI`、`Web` 都应有独立页面，而不是被压缩在一页说明里。

## Why This Might Happen

- 站点最初更像“把已有 docs 发布到 Docusaurus”，而不是从读者任务出发重新设计 IA。
- `sidebars.js` 当前是 repo content aggregation 的混合结果，不是面向 onboarding 的 curated tree。
- `quickstart.md` 历史上承担了首页职责，因此语义自然漂移成大而全的入口页。
- 已有丰富的内部文档（ADR、design-docs、features、fitness、issues）使“内部知识可见性”优先于“公开站点的起步体验”。

## Proposed Direction

第一阶段先建立骨架，不做大规模迁移：

- 保留 `/` 作为产品 `Overview`
- 把 `Quick Start` 独立为单独文档
- 引入稳定 section：
  - `Getting Started`
  - `Core Concepts`
  - `Platforms`
  - `Configuration`
  - `Reference`
- 为 `Desktop / CLI / Web` 增加独立页面
- 在侧边栏中优先呈现这些 curated sections，再保留 deeper docs 入口

第二阶段再逐步吸收现有文档：

- 将 relevant docs 映射到上述 sections
- 让 `Deployment`、`Administration`、`Reference` 等领域变成真正的 landing pages
- 收敛破碎的 cross-links 和 route naming

## Why It Matters

- 文档站点是公开入口之一，信息架构直接影响产品理解和首次成功率。
- `Desktop / CLI / Web` 是 Routa 的真实产品 surfaces，不应被埋在 developer-only 结构下。
- 当前结构不利于用户快速判断“我该从哪里开始”。
- 把 Quick Start 和 Overview 分开之后，还需要进一步把 section skeleton 建立起来，否则用户仍然主要面对内部知识分类。

## Relevant Files

- `docs/quickstart.md`
- `docs/quick-start.md`
- `docusaurus.config.js`
- `sidebars.js`

## Follow-up Checks

- docs build 能通过
- navbar 能体现 stable sections
- sidebar 能体现 curated onboarding tree
- `/quick-start`、`/platforms/*`、`/configuration/*` 等新页面可访问
