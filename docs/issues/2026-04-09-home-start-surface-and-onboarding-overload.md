---
title: "Home start surface and onboarding flow overload new users"
date: "2026-04-09"
status: resolved
severity: high
area: "ui"
github_issue: 409
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/409"
resolved_at: "2026-04-09"
tags: ["homepage", "onboarding", "workspace", "information-architecture", "ux"]
reported_by: "copilot"
related_issues:
  - "2026-03-19-homepage-kanban-entry-surface-fragmentation.md"
  - "2026-03-20-team-automation-entry-is-hidden-and-lacks-product-boundary.md"
  - "2026-02-25-gh-21-feat-complete-workspace-centric-ui-redesign-notes-skills-scoping-session.md"
---

# Home 起步面和 onboarding 流程对新用户来说过载

## What Happened

在本地打开 `http://localhost:3000/`，以“已有默认工作区但尚未完全完成配置”的典型状态观察首页，首页同时承担了过多职责：

- 工作区 launcher：顶部 workspace switcher 和右侧 workspace 列表都能切换工作区。
- onboarding checklist：provider、codebase、mode 三步清单以内联卡片形式插入首屏。
- 日常操作入口：`看板 / 概览 / 设置 / Harness` 四张 CTA 卡片同时存在。
- 恢复中心：最近看板、最近卡片、最近会话放在同一页。
- 专家级执行入口：底部 `HomeInput` 直接暴露 repo、branch、provider、agent mode、custom specialist 等上下文。
- 高级能力导航：左侧主导航除了 `Home / Kanban / Overview / Team`，还同时暴露 `MCP Servers / Schedules / Harness / Fluency / Workflows / Specialists / Debug`。

这会让用户在进入产品后的第一屏就面对“我要先配置、先选模式、先开看板、先发 prompt、还是先去 Team/Harness/Fluency”的决策负担。

另外还存在一个直接破坏信息气味的问题：首页 CTA 文案写的是“查看工作区概览”，但链接实际跳到 `/workspace/{workspaceId}`，而该路由会立即 `307` 重定向到 `/workspace/{workspaceId}/kanban`。

## Expected Behavior

- 新用户进入 Routa 后，应当看到一个明确的主路径，而不是多个并列的产品心智模型。
- 首页文案、链接目标和真实路由语义应保持一致。
- onboarding 应该帮助用户完成“开始之前必须做的事”，而不是与日常执行入口并排竞争注意力。
- 高级能力入口应采用渐进披露，而不是在首次进入时与核心工作流同级暴露。

## Reproduction Context

- Environment: web
- Trigger: 启动本地 `localhost:3000`，打开 `http://localhost:3000/`，使用默认工作区进行 walkthrough；随后访问 `http://localhost:3000/workspace/default/kanban`、`http://localhost:3000/workspace/default/overview`、`http://localhost:3000/workspace/default/team`

## Why This Might Happen

- 首页在此前“入口碎片化”治理后，仍然保留了 launcher、recent activity hub、inline onboarding 和 expert command surface 四种职责。
- onboarding 清单被直接叠加到 daily-use 首页，而不是作为单独的 start flow 或更窄的前置步骤。
- 顶层导航没有对“核心工作流”和“高级工具”做足够强的层级区分。
- Team 已经是产品能力，但对新用户来说仍属于较高级的 operating mode；当前与 Kanban/Overview 同级暴露会增加起步阶段的认知分叉。

## Relevant Files

- `src/app/page.tsx`
- `src/app/workspace/[workspaceId]/page.tsx`
- `src/client/components/desktop-sidebar.tsx`
- `src/client/components/home-input.tsx`
- `src/client/components/home-page-sections.tsx`
- `src/client/components/workspace-switcher.tsx`

## Observations

- 首页当前仍会在 `src/app/page.tsx` 中主动拉取 `/api/kanban/boards`、`/api/tasks`、`/api/sessions` 并展示 recent board/task/session 信息，这说明首页仍是一个高密度运营面，而不仅是 start surface。
- 浏览器 walkthrough 中，`agent-browser snapshot -i` 统计到首页约有 `167` 个可交互元素；相比之下，Kanban 页约 `67` 个，Overview 页约 `49` 个，Team 页约 `24` 个。首页的初始交互密度明显高于任何单一工作面。
- `curl -I http://localhost:3000/workspace/default` 返回 `HTTP/1.1 307 Temporary Redirect`，`location: /workspace/default/kanban`，证实“查看工作区概览”这张卡的文案和真实去向不一致。
- `src/app/workspace/[workspaceId]/page.tsx` 目前把工作区根路由直接重定向到 Kanban，但首页 CTA 仍把它当成 Overview 入口使用。
- `src/client/components/home-input.tsx` 会自动连接 ACP、自动加载 specialists，并在有 codebase 时自动选择默认 repo；这说明首页底部输入框本质上已经是 expert launcher，而不是一个轻量的新手入口。
- 相关历史 issue `2026-03-19-homepage-kanban-entry-surface-fragmentation.md` 已关闭，但首页仍然保留了 recent board/task 聚合与多重入口，说明之前解决的是“路由语义歧义”的一部分，而不是“从哪里开始”的整体问题。

## References

- `http://localhost:3000/`
- `http://localhost:3000/workspace/default/kanban`
- `http://localhost:3000/workspace/default/overview`
- `http://localhost:3000/workspace/default/team`
- `https://github.com/phodal/routa/issues/409`
