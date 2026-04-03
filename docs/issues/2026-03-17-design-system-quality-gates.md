---
title: "Design System Quality Gates: layered quality system"
date: "2026-03-17"
status: resolved
resolved_at: "2026-03-30"
severity: high
area: "design-system"
tags:
  - design-system
  - desktop
  - quality
  - accessibility
  - performance
reported_by: "phodal"
related_issues:
  - "https://github.com/phodal/routa/issues/183"
github_issue: 5
github_state: "closed"
github_url: "https://github.com/phodal/entrix/issues/5"
---

# Design System Quality Gates: layered quality system

## What Happened

桌面 shell 的一致性治理已完成第一阶段（`desktop-shell` 相关 fitness function 与 token contract），但后续质量保障缺少分层机制。
给出的 6 层框架（CSS 可维护性、Design Token、组件视觉、页面视觉、可访问性、性能）尚未持续执行。

## Expected Behavior

将设计系统质量拆成可执行的连续质量门（Fitness Function），做到：
- 颜色与 shell 约束可持续检测
- 页面级视觉不漂移
- 组件级视觉回归可自动化
- 可访问性与性能指标可量化监控

## Reproduction Context

- Environment: both web + desktop
- Trigger:
  - 多人并行改样式后无法快速判断是否回归
  - 设计/组件变更主要靠人工复核，缺少稳定阈值
  - shell 级改动后缺少层级化的证据链

## Why This Might Happen

- 现有静态检查主要覆盖 E2E 路由与 shell token 接线，缺少样式语义化规则。
- 缺少统一 token 生产/消费校验链（Style Dictionary + AST 校验）。
- 缺少组件和页面级视觉快照的持续回归。
- 可访问性与 CSS 成本目前没有纳入默认 CI。

## Proposed Work (Prioritized)

### 1) 代码层：CSS 可维护性
- 引入 `stylelint`（或复用现有 lint 流程）
- 新增规则覆盖：
  - 禁止桌面壳体相关文件中无 token 的颜色硬编码
  - 约束自定义 CSS 变量命名

### 2) 设计层：Token 一致性
- 引入 `Style Dictionary` 管理 core shell token（包括 `desktop-theme`）
- 增加 AST 校验脚本：
  - 关键 shell 文件必须出现 `dt-` token 使用
  - 关键 shell 文件不能在本层替代为 `bg-`/`text-`/`border-` 硬编码语义

### 3) 组件层：UI 不漂移
- 引入最小 Storybook + Chromatic 覆盖
- 先覆盖 `desktop-app-shell`、`desktop-layout`、`desktop-sidebar`、`desktop-nav-rail`
- 将关键 chrome 状态（hover/active/focus）加入快照边界

### 4) 页面层：视觉回归
- 在现有 Playwright 路径中补齐页面级 snapshot（workspace / kanban / traces / session detail）
- 与 `docs/fitness/design-system-shell.md` 分离，形成全页面回归文档

### 5) 体验层：可访问性
- 增加 `axe` / `lighthouse` 的 accessibility smoke 脚本
- 在关键页面路由上自动检查（focus/label/name/hierarchy）

### 6) 性能层：CSS 成本
- 引入 bundle 分析脚本与 CSS 体积阈值基线
- 关键页面加入 Lighthouse 脚本，跟踪 First Paint / Total Blocking Time / CSS 体积趋势

## Relevant Files

- `docs/fitness/design-system-shell.md`
- `src/app/styles/desktop-theme.css`
- `src/client/components/desktop-layout.tsx`
- `src/client/components/desktop-app-shell.tsx`
- `src/client/components/desktop-sidebar.tsx`
- `src/client/components/desktop-nav-rail.tsx`
- `src/client/components/workspace-switcher.tsx`
- `package.json`

## Acceptance Criteria

- [ ] 新建 `docs/fitness/design-system-quality-layers.md` 并定义 6 层质量目标与阈值
- [ ] 新增 `npm run lint:css` 并加入 color token 限制规则
- [ ] 新增 `npm run test:accessibility` / `npm run test:performance`
- [ ] Playwright 与（可选）Chromatic 页面级截图覆盖新增完成
- [ ] 新 issue/工作流能独立验证 shell 变更后未引入未授权色值、dead-link 与明显视觉回归

## Resolution

This issue is resolved in the current codebase. The local record was updated
during issue hygiene on 2026-04-03 after verifying that the layered gates are
already wired in, and the upstream tracking issue now lives in `phodal/entrix`.

Evidence in current implementation:

- `docs/fitness/design-system-quality-layers.md` defines the layered quality
  gates and their executable metrics.
- `package.json` includes `lint:css`, `test:accessibility`,
  `test:performance`, `storybook:governance`, `chromatic`, and
  `snapshots:validate`.
- `scripts/validate-storybook-governance.mjs`,
  `scripts/fitness/check-accessibility-smoke.mjs`,
  `scripts/fitness/check-performance-smoke.mjs`, and the page snapshot tooling
  provide the automation chain described in the original proposal.
- Storybook stories and desktop-shell/page snapshot coverage now exist for the
  shell and key route surfaces called out in the issue.
