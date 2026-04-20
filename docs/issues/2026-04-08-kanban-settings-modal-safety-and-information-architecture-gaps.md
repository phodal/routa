---
title: "Kanban Settings modal silently discards edits and overloads structure, automation, and runtime controls"
date: "2026-04-08"
status: resolved
severity: high
area: "ui"
tags: ["kanban", "settings", "modal", "ux", "i18n", "automation"]
reported_by: "codex"
github_issue: 394
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/394"
resolved_at: "2026-04-08"
related_issues:
  - "2026-03-21-kanban-column-configurability-and-manual-lane-boundary.md"
  - "2026-04-08-kanban-detail-information-architecture-and-session-pane-friction.md"
---

# Kanban Settings modal 存在静默丢失编辑和信息架构过载问题

## What Happened

在本地打开 `http://localhost:3000/workspace/default/kanban` 并进入 `Kanban Settings` 后，观察到以下问题：

- modal 内编辑 `Name` 等字段后，按 `Esc` 会直接关闭 modal，未保存修改被静默丢弃，没有任何 discard warning。
- modal 同时承载 board structure、lane automation、session queue、dev supervision、YAML import/export、clear all cards，首屏信息密度过高。
- 自动化配置区把 `Transport / Provider / Role / Specialist / Trigger` 展示了一次，`Advanced` 下的 `Step 1` 又重复展示同一组配置，单步场景下容易造成“两个地方都在配同一件事”的困惑。
- 左侧 `Stages` 列表把内部 id、自动化摘要、visible/automation toggles、排序和删除动作都压在同一块高密度卡片里，扫描成本很高，并出现 `Backlog backlog`、`Todo todo` 这类重复表达。
- `Specialist` 分类 tabs 在标准桌面宽度下会横向溢出，只露出前几个分类，没有清晰的可滚动提示。
- 页面中仍有多处用户可见硬编码英文，如 `Session queue`、`Dev supervision`、`Structure`、`Advanced`、`Step 1`、`Up/Down/Remove`、`Defaults`，与仓库的 i18n 约束不一致。

## Expected Behavior

- 关闭 modal 前，若存在未保存更改，应明确提示保存、放弃或取消关闭。
- `Kanban Settings` 应把 structural board settings、automation settings、runtime settings、danger zone 分层，而不是全部堆在同一个 modal 工作区里。
- 单步自动化配置不应在主配置和 `Advanced` 区域重复编辑同一组字段。
- stage 列表应优先展示用户关心的信息，弱化内部 id 和技术摘要，减少高密度操作噪音。
- specialist 分类切换应完整可见，或明确呈现可滚动/可折叠关系。
- 所有 UI-facing strings 都应走 i18n 字典。

## Reproduction Context

- Environment: web
- Trigger: 启动本地 `localhost:3000`，打开 `http://localhost:3000/workspace/default/kanban`，点击右上角 `Settings`，检查 `Kanban Settings` modal；在 `Name` 输入框修改值后按 `Esc`

## Why This Might Happen

- modal 关闭路径只处理 `onClose`，没有 dirty state 或 unsaved changes guard。
- 当前 settings surface 按实现能力叠加演进，缺少按用户任务重新整理的信息架构。
- 自动化模型支持多 step，但 UI 没有把“primary step summary”和“advanced step editor”清晰区分，导致重复配置感。
- stage list 仍然偏向把实现细节直接暴露给用户，而不是面向 board curation 任务做信息收敛。
- specialist category tabs 使用横向不换行滚动方案，但没有额外 affordance。
- i18n 收敛不完整，部分较新的设置文案仍直接写在组件中。

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-settings-modal.test.tsx`
- `src/i18n/locales/en-extended.ts`
- `src/i18n/locales/zh-extended.ts`
- `src/i18n/types-extended.ts`

## Observations

- 本地 walkthrough 中，`Esc` 关闭 modal 后，重新打开时 `Name` 字段恢复原值，证明未保存变更被直接丢弃。
- `clear all cards` 和 YAML import/export 与日常 lane config 混在同一底部动作区，危险操作和常规保存操作靠得过近。
- 浏览器截图：
  - `/Users/phodal/.agent-browser/tmp/screenshots/screenshot-2026-04-08T01-20-12-418Z-yl6exy.png`
  - `/Users/phodal/.agent-browser/tmp/screenshots/screenshot-2026-04-08T01-21-38-574Z-mr4i21.png`

## References

- `http://localhost:3000/workspace/default/kanban`
- `https://github.com/phodal/routa/issues/394`
