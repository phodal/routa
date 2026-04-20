---
title: "Desktop tray should expose workspace-first actions and macOS menu bar behavior"
date: "2026-04-20"
kind: issue
status: open
severity: medium
area: "desktop"
tags: ["desktop", "tray", "macos", "tauri", "workspace", "ux"]
reported_by: "codex"
related_issues: []
github_issue: 498
github_state: open
github_url: "https://github.com/phodal/routa/issues/498"
---

# Desktop tray 应该提供 workspace-first 快捷入口和 macOS 菜单栏行为

## What Happened

Routa Desktop 已经有系统托盘实现，但当前菜单结构仍然偏向 webhook / GitHub 快捷链接：一级入口主要是 `Show / Hide Window`、按仓库展开的 `Pull Requests / Issues / Repository`、`Webhook Settings…` 和 `Quit`。

这和产品当前的主工作流不一致。Routa 的核心 surface 已经是 workspace-first，稳定高频能力集中在 `Sessions`、`Kanban`、`Team Runs` 和消息/后台任务，而这些能力没有进入托盘一级入口。

同时，macOS 上的 tray 仍然保持“普通桌面应用 + 托盘菜单”的默认交互：左键会直接弹菜单，没有使用 template icon，也没有切换到 accessory / hidden dock 这类更接近菜单栏应用的运行模式。

结果是：

- Desktop tray 没有成为真正的工作入口，只是一个 GitHub / webhook 附属菜单
- 用户无法从 tray 快速恢复会话、打开看板、启动 team flow、查看后台消息
- macOS 上的视觉与交互仍然偏普通 app，而不是 menu bar app

## Expected Behavior

Desktop tray 应该优先暴露 Routa 自己的高频工作流，而不是外部 GitHub 链接。

理想的一阶行为是：

- 一级入口包含 `Sessions`、`Kanban Board`、`Team Runs`、`Messages`
- `Settings` 保持二级入口，至少包含 `Agent Settings…` 和 `Webhook Settings…`
- GitHub repo links 保留，但下降为二级 submenu
- workspace 跳转优先使用当前页面上下文，其次回退到最近活跃 workspace，而不是盲目退回 `default`

macOS 上应进一步增强为菜单栏模式：

- `show_menu_on_left_click(false)`，左键点击图标时直接唤起主窗口
- tray icon 使用 template 模式，适配深浅色菜单栏
- application activation policy 切为 `Accessory`
- Dock icon 隐藏，仅保留菜单栏驻留

## Reproduction Context

- Environment: desktop
- Platforms:
  - macOS: tray 存在，但交互和视觉仍然像普通桌面应用
  - Windows / Linux: tray 存在，但菜单信息架构仍未对齐 workspace-first 主工作流
- Trigger:
  1. 启动 Desktop app
  2. 点击系统托盘图标
  3. 观察一级菜单仍然偏 GitHub / webhook 快捷链接
  4. 在 macOS 上左键点击图标，会弹出菜单，而不是唤起主窗口

## Why This Happens

- tray 初始实现围绕 GitHub webhook 配置展开，而不是围绕 workspace/task/session 主流程展开
- workspace 级导航逻辑主要存在于主窗口内，没有被 tray 复用
- macOS-specific tray 能力没有在 Rust 侧启用，包括 template icon、left-click custom handling、Accessory activation policy 和 Dock 可见性控制

## Suggested First Slice

- 重构 `apps/desktop/src-tauri/src/tray.rs`，把一级菜单改为 workspace-first actions
- 保留 GitHub repo links，但移动到 `GitHub Shortcuts` submenu
- 复用或抽取 workspace-aware 跳转 helper，让 tray 能回到最近活跃 workspace
- 在 macOS 上启用 `icon_as_template(true)` 和 `show_menu_on_left_click(false)`
- 为左键点击补一个显式 tray click handler，仅负责唤起主窗口
- 在 app setup 阶段启用 `ActivationPolicy::Accessory` 和 `set_dock_visibility(false)`

## Relevant Files

- `apps/desktop/src-tauri/src/tray.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `src/client/components/workspace-switcher.tsx`
- `docs/product-specs/FEATURE_TREE.md`

## Notes

- 这项工作主要是 Desktop surface 的交互和信息架构调整，不改变 Web/Desktop 的领域语义边界
- Windows / Linux 继续保留 tray 作为系统托盘入口；macOS 再额外增强为更接近 menu bar app 的形态
