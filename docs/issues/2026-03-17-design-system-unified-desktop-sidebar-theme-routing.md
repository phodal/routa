---
title: "Design System: unify desktop sidebar, shell theme, and workspace routing"
date: "2026-03-17"
status: open
severity: high
area: "ui"
tags:
  - design-system
  - desktop
  - tauri
  - workspace
  - navigation
reported_by: "phodal"
related_issues:
  - "https://github.com/phodal/routa/issues/183"
github_issue: 183
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/183"
---

# Design System: unify desktop sidebar, shell theme, and workspace routing

## What Happened

- `/workspace/default/sessions`（含 workspace 内 sessions 列表）在当前路由结构下不可达；桌面导航仍有入口或样式预期，但页面不存在。
- `/workspace/default`、`/workspace/default/kanban`、`/traces` 的背景和标题栏/侧边栏色值出现不一致，和系统 macOS 日/夜间主题不一致。
- Desktop sidebar 及主容器存在不同风格并存（多处 hardcoded 颜色），导致 Next.js 与 Tauri 体验漂移。
- 导航左侧/全局菜单仍会出现不需要的数字/计数提示（与当前交互策略不匹配）。
- 存在历史残留导航入口（如 `/sessions`）指向不存在/不再维护的页面。
- Desktop 页面仍有大量组件级内嵌颜色定义，尚未形成统一 design-system 层。

## Expected Behavior

- 任何桌面化页面（workspace home、kanban、traces、session detail）统一使用同一套 macOS 风格主题 token（light/dark），不出现风格偏移。
- sidebar 为纯导航入口，不展示 session/task 数量 chip，点击路径行为稳定且不存在 dead-link。
- `/sessions` 相关入口与 `/workspace/{id}/sessions` 的列表页入口保持一致（若不保留列表页则彻底移除入口）。
- 设计系统改造可直接覆盖到 `/workspace/[workspaceId]` 全家族页面，避免每个 page client 各自硬编码背景。

## Reproduction Context

- Environment: both web + desktop (Next.js + Tauri)
- Trigger:
  - 打开 `/workspace/default`、`/workspace/default/kanban`、`/traces`
  - 通过左侧或顶部导航切换页面
  - 访问 `/workspace/default/sessions` 与 `/sessions`

## Proposed Scope and Impact

### 1. 设计系统基建（高影响）

- 新增统一 design token：
  - `src/app/globals.css`（或新建 `src/styles/design-system.css`）定义桌面 Light/Dark 变量（背景、边框、文字、强调色、hover 等）。
- 将 sidebar/header/main 容器的关键颜色从 inline class 提取为 token 使用。
- 提供一组“desktop shell utility class / component variants”，用于 desktop shell/sidebars/page sections。

### 2. Desktop shell/navigation 统一（高影响）

- 统一以下页面级壳体：
  - `src/client/components/desktop-layout.tsx`
  - `src/client/components/desktop-sidebar.tsx`
  - `src/client/components/desktop-nav-rail.tsx`
  - `src/client/components/desktop-app-shell.tsx`
- 明确导航结构为：
  - Home
  - Dashboard
  - Kanban
  - Traces
  - Settings
- 确认是否保留计数显示（当前需求是“去掉数字”），如去掉则彻底移除所有相关 props/显示逻辑，避免误导。

### 3. 页面级样式迁移（中高影响）

- `src/app/traces/page.tsx`
- `src/app/workspace/[workspaceId]/page.tsx`（通过 `workspace-page-client`)
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/page.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- 将这些页面中的 hardcoded 背景样式改为 shell 提供的主题变量，不在各 page 中重复定义。

### 4. 路由与入口清理（中影响）

- `src/client/components/home-page-sections.tsx`
  - 评估并修复 `/sessions`、`/workspaces` 链接（当前 `src/app/` 下无对应页面）。
- `src/client/components/desktop-sidebar.tsx` / `desktop-nav-rail.tsx`
  - 明确 sessions 列表页是否应从导航体系移除；若移除，清理所有 dead-link。
- `src/app/workspace/[workspaceId]/sessions` 下不存在 `[workspaceId]/sessions/page.tsx` 的事实要形成 UX 决策（保留仅会话详情页或补齐列表页）。

### 5. 质量与一致性验证（中高影响）

- 提供至少一份截图矩阵：
  - `/workspace/default`
  - `/workspace/default/kanban`
  - `/workspace/default/sessions/<sessionId>`（已有）
  - `/traces`
  - `/traces` 在 desktop 与 web 两端
- 与旧版视觉回归对比，重点看背景块、分隔线、标题栏、hover、active。

## Relevant Files

- `src/app/globals.css`
- `src/client/components/desktop-layout.tsx`
- `src/client/components/desktop-sidebar.tsx`
- `src/client/components/desktop-nav-rail.tsx`
- `src/client/components/desktop-app-shell.tsx`
- `src/client/components/workspace-switcher.tsx`
- `src/app/page.tsx`
- `src/client/components/home-page-sections.tsx`
- `src/app/traces/page.tsx`
- `src/app/workspace/[workspaceId]/page.tsx`
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/page.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`

## Acceptance Criteria

- [ ] Desktop shell 与页面背景只由一套 token 决定，`/workspace/default` / `/workspace/default/kanban` / `/traces` 的背景在同一主题下视觉一致。
- [ ] Sidebar 上无未授权计数展示；如保留计数，则明确文案和来源，且所有页面行为一致。
- [ ] 导航无 dead-link（含 `/sessions`、无效的 `/workspace/{id}/sessions` 列表入口）。
- [ ] 在 Next.js 与 Tauri 中，日间/夜间切换后的配色一致且与 macOS 风格接近。
- [ ] PR 说明列出受影响页面，并附截图。
- [ ] 新建并执行对应 fitness function：`docs/fitness/design-system-shell.md`（运行命令 `npm run test:e2e -- e2e/layout-changes.spec.ts e2e/layout-verification.spec.ts`，用于验证桌面 shell/布局一致性与关键导航路径）。

## Risks / Impact

- 涉及多文件 UI 重构，可能触发快照/截图更新及 E2E 选择器变更。
- 主题变量引入初期会导致一些页面轻微视觉抖动（预期）；
  但需要避免单页面级样式优先级掩盖 token 的问题。
- 路由入口清理会影响历史操作习惯，建议先在设计评审时确认 `/sessions` 保留策略。
