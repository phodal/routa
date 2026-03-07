---
title: "Spec Analysis: A2UI for Customize Dashboard"
issue: 54
date: 2026-03-07
status: analysis
labels: feature
author: phodal
---

# Spec Analysis: A2UI for Customize Dashboard (#54)

## 需求概述

Issue #54 要求为 Routa.js 平台引入基于 [A2UI](https://a2ui.org/) 协议的**可定制化仪表盘 (Customize Dashboard)**。A2UI 是一种声明式、JSON 驱动的 UI 协议，允许 AI Agent 安全地生成原生渲染的界面组件，无需执行任意代码。Issue 同时引用了 [A2UI Composer](https://a2ui.org/composer/)，暗示需要一个可视化的界面编排/编辑能力。

### 核心目标

1. **基于 A2UI v0.10 协议渲染 Workspace 仪表盘**：将 workspace 的运行时数据（sessions、agents、tasks、traces 等）转换为 A2UI 消息并渲染。
2. **用户可定制化**：支持用户添加、删除、重排仪表盘面板（surfaces），导入/导出 A2UI JSON，以及从模板库选择预置面板。
3. **可视化 Composer（参考 a2ui.org/composer）**：提供类似 A2UI Composer 的交互式界面，允许用户通过描述或拖拽生成 A2UI 面板 JSON，并实时预览渲染效果。

### 当前实现状态

根据 Issue 评论和代码审查，**基础实现已完成**，包括：

- A2UI v0.10 类型定义（18 种组件类型）
- 纯 React 渲染器（无 Lit 依赖）
- Dashboard 数据生成器（6 个默认 surface）
- API 端点 (`GET/POST /api/a2ui/dashboard`)
- Workspace 页面 "Overview" Tab 中的 A2UI 渲染
- 4 个预置模板（Task Board、Agent Monitor、Timeline、Workspace Summary）
- JSON 导入/导出 + Source 编辑模式
- 17 个单元测试

**尚未实现的部分**（需求差距）：

| 缺失能力 | 说明 |
|---------|------|
| 可视化 Composer | 类似 a2ui.org/composer 的交互式 surface 构建器 |
| 面板拖拽排序 | 用户无法通过拖拽重排 Dashboard 中的 surface 顺序 |
| 面板持久化 | 自定义 surfaces 仅保存在内存 (`useState`)，刷新即丢失 |
| Surface 删除/隐藏 | 用户无法隐藏或删除单个默认面板 |
| Agent 实时推送 | Agent 无法通过 streaming 实时向 Dashboard 推送 A2UI 消息 |
| Rust 后端完整实现 | `crates/routa-server/src/api/a2ui.rs` 仅为 mock 占位 |
| 面板大小调整 | 无法调整 surface 在网格中的宽度/高度 |

## 涉及的模块/文件

### 前端 (Next.js / TypeScript)

| 文件路径 | 职责 | 改动类型 |
|---------|------|---------|
| `src/client/a2ui/types.ts` | A2UI v0.10 协议类型定义 | 可能扩展（Composer 相关类型） |
| `src/client/a2ui/renderer.tsx` | A2UI React 渲染器 | 扩展（支持拖拽占位、编辑模式） |
| `src/client/a2ui/dashboard-generator.ts` | Workspace 数据 -> A2UI 消息 | 扩展（支持面板可见性配置） |
| `src/client/a2ui/index.ts` | 模块导出 | 新增导出 |
| `src/app/workspace/[workspaceId]/overview-a2ui-tab.tsx` | Dashboard Tab 主组件 | 重构（加入 Composer 入口、拖拽排序） |
| `src/app/workspace/[workspaceId]/workspace-page-client.tsx` | Workspace 页面容器 | 微调（持久化状态管理） |
| `src/app/api/a2ui/dashboard/route.ts` | A2UI Dashboard API | 扩展（持久化读写） |
| `src/client/a2ui/__tests__/a2ui-dashboard.test.ts` | 单元测试 | 扩展 |

### 需要新建的文件

| 文件路径 | 职责 |
|---------|------|
| `src/client/a2ui/composer.tsx` | A2UI 可视化 Composer 组件 |
| `src/client/a2ui/composer-types.ts` | Composer 相关类型（面板布局、用户配置） |
| `src/client/a2ui/dashboard-layout.tsx` | 面板拖拽排序、网格布局管理 |
| `src/client/a2ui/__tests__/a2ui-composer.test.ts` | Composer 测试 |

### 后端 (Rust / Axum)

| 文件路径 | 职责 | 改动类型 |
|---------|------|---------|
| `crates/routa-server/src/api/a2ui.rs` | A2UI Dashboard API (Rust) | 重写（从 mock 变为真实实现） |
| `crates/routa-server/src/lib.rs` | 路由注册 | 微调 |

### 数据库

| 层面 | 说明 |
|------|------|
| Dashboard 配置表 | 存储用户自定义面板配置（可见性、排序、自定义 surface JSON） |
| 迁移脚本 | `drizzle/` 或 `drizzle-sqlite/` 下需新增迁移 |

## 技术方案建议

### 方案一：渐进式增强（推荐）

分 3 个阶段实施，每阶段可独立交付：

#### 阶段 1：面板持久化 + 排序

**目标**：让用户的自定义配置在刷新后不丢失，并支持拖拽排序。

1. **数据库 Schema**：新增 `dashboard_config` 表
   ```sql
   CREATE TABLE dashboard_config (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     surface_order TEXT,         -- JSON array of surface IDs
     hidden_surfaces TEXT,       -- JSON array of hidden surface IDs  
     custom_surfaces TEXT,       -- JSON array of custom A2UI messages
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
   );
   ```

2. **API 扩展**：
   - `GET /api/a2ui/dashboard/config?workspaceId=...` -- 读取配置
   - `PUT /api/a2ui/dashboard/config` -- 保存配置
   - 在现有 `GET /api/a2ui/dashboard` 中合并用户配置

3. **前端拖拽**：
   - 引入轻量拖拽库（如 `@dnd-kit/core`，已在 React 生态广泛使用）
   - 在 `overview-a2ui-tab.tsx` 中包裹 `A2UIViewer` 的 surface 渲染为可拖拽项
   - 每个 surface 右上角添加 "隐藏/删除" 按钮

4. **状态管理**：
   - 将 `customA2UISurfaces` 从 `useState` 迁移到 API 持久化
   - 使用 `useSWR` 或自定义 hook 管理配置的加载/保存

#### 阶段 2：可视化 Composer

**目标**：提供交互式界面构建 A2UI surface。

1. **Composer UI 组件** (`src/client/a2ui/composer.tsx`)：
   - **组件面板**：列出所有 18 种 A2UI 组件类型，可拖入画布
   - **画布区域**：拖入的组件形成树结构，实时渲染预览
   - **属性面板**：选中组件后编辑其属性（text、variant、accent 等）
   - **数据绑定编辑器**：设置 JSON Pointer 路径绑定
   - **JSON 输出面板**：实时显示生成的 A2UI 消息 JSON

2. **集成方式**：
   - 在 Overview Tab 工具栏添加 "Composer" 按钮
   - 打开为 Modal 或侧面板
   - Composer 的输出直接作为自定义 surface 添加到 Dashboard

3. **技术实现**：
   - 组件树使用 React state 管理（adjacency list）
   - 利用已有的 `A2UISurfaceRenderer` 做实时预览
   - 属性编辑器根据组件类型动态渲染表单

#### 阶段 3：Agent 实时推送 + Rust 后端

**目标**：Agent 可以通过 streaming 向 Dashboard 推送 A2UI 消息。

1. **Streaming 支持**：
   - 在 ACP (Agent Communication Protocol) 会话中支持 A2UI 消息类型
   - 使用 SSE 或 WebSocket 将 Agent 产生的 A2UI 消息推送到前端
   - 前端 `A2UIViewer` 支持增量消息更新（已有 `processA2UIMessages` 基础）

2. **Rust 后端**：
   - 将 `crates/routa-server/src/api/a2ui.rs` 从 mock 升级为完整实现
   - 从数据库读取 workspace 数据并生成 A2UI 消息（等效于 Next.js 的 `generateDashboardA2UI`）
   - 支持 `dashboard_config` 表的 CRUD

### 方案二：全量 Composer 优先

直接实现完整的可视化 Composer（类似 a2ui.org/composer），包含组件拖拽、属性编辑、数据绑定和 AI 辅助生成。此方案风险更高，但更贴合 Issue 引用 Composer 链接的意图。

**不推荐原因**：Composer 是最复杂的部分，缺少持久化和基础排序能力时，Composer 生成的 surface 也无法持久保存。

## 风险点

### 高风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **A2UI 规范不稳定** | v0.10 标注为 "under development"，未来 breaking changes 可能导致大量重构 | 将 A2UI 类型和渲染器封装在 `src/client/a2ui/` 目录内，通过 `index.ts` 统一导出，降低耦合 |
| **Composer 复杂度** | 可视化组件编辑器是一个完整的 IDE 级别功能，工程量大 | 分阶段实施；第一版只支持 JSON 编辑 + 模板，后续迭代添加可视化拖拽 |
| **双后端一致性** | Next.js 后端和 Rust 后端需保持 API 行为一致 | Rust 后端暂保留 mock，优先在 Next.js 侧完成功能，后续同步 |

### 中风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **性能 -- 大量 surface 渲染** | workspace 数据量大时，生成和渲染大量 A2UI 消息可能导致卡顿 | 使用 `React.useMemo` 缓存（已有）；对 surface 做懒加载/虚拟化 |
| **数据竞争** | 多个 Agent 同时推送 A2UI 消息可能导致 surface 状态冲突 | 每个 surface 有唯一 `surfaceId`，使用 `updateComponents` 的幂等性保证一致 |
| **拖拽库兼容性** | 拖拽库可能与现有 Tailwind CSS 布局产生冲突 | 选择与 React 生态良好集成的 `@dnd-kit`；做充分的样式隔离 |

### 低风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **内存存储丢失** | 当前 API route 使用 `Map` 内存存储自定义 surface，服务重启丢失 | 阶段 1 即引入数据库持久化 |
| **Tauri 桌面端兼容** | A2UI Dashboard 在桌面端可能因 Rust mock 后端表现异常 | 桌面端 Dashboard 数据在前端生成（`generateDashboardA2UI` 直接在客户端运行），不强依赖后端 API |

## 实施步骤

### Phase 1: 面板持久化与排序（预计 2-3 天）

| Step | 任务 | 产出 |
|------|------|------|
| 1.1 | 设计 `dashboard_config` 数据库表，编写 Drizzle 迁移脚本 | 迁移文件 |
| 1.2 | 实现 `GET/PUT /api/a2ui/dashboard/config` API | API 端点 |
| 1.3 | 创建 `useDashboardConfig` hook，管理配置加载/保存 | React hook |
| 1.4 | 将 `overview-a2ui-tab.tsx` 中 `customA2UISurfaces` 状态迁移到持久化 | 状态重构 |
| 1.5 | 集成 `@dnd-kit/core`，为每个 surface 添加拖拽排序 | 拖拽功能 |
| 1.6 | 为每个 surface 添加 "隐藏" 按钮，隐藏列表可在工具栏中恢复 | UI 功能 |
| 1.7 | 编写单元测试和 E2E 测试 | 测试覆盖 |

### Phase 2: 可视化 Composer（预计 4-5 天）

| Step | 任务 | 产出 |
|------|------|------|
| 2.1 | 设计 Composer 组件架构：组件面板 + 画布 + 属性面板 | 设计文档 |
| 2.2 | 实现 Composer 核心 -- 组件树状态管理 | `composer.tsx` |
| 2.3 | 实现组件拖入画布功能 | 拖拽交互 |
| 2.4 | 实现属性编辑面板（根据组件类型动态渲染表单） | 属性编辑器 |
| 2.5 | 实现数据绑定编辑（JSON Pointer 路径选择器） | 数据绑定 UI |
| 2.6 | 集成实时预览（复用 `A2UISurfaceRenderer`） | 实时预览 |
| 2.7 | 将 Composer 输出接入 Dashboard（"Save to Dashboard" 按钮） | 集成 |
| 2.8 | 编写 Composer 单元测试 | 测试 |

### Phase 3: Agent 实时推送 + Rust 后端（预计 3-4 天）

| Step | 任务 | 产出 |
|------|------|------|
| 3.1 | 在 ACP 协议中定义 A2UI 消息类型 | 协议扩展 |
| 3.2 | 实现 SSE/WebSocket 端点用于 A2UI 消息推送 | Streaming API |
| 3.3 | 前端 `A2UIViewer` 支持增量消息流 | 渲染器增强 |
| 3.4 | Rust 后端：实现 `dashboard_config` CRUD | Rust API |
| 3.5 | Rust 后端：实现 A2UI 消息生成（从 DB 数据） | Rust 生成器 |
| 3.6 | 端到端测试：Agent -> A2UI -> Dashboard | E2E 测试 |

### 验收标准

- [ ] 用户可在 Dashboard 中拖拽重排面板顺序，刷新后保持
- [ ] 用户可隐藏/恢复默认面板
- [ ] 用户自定义的 A2UI surface 持久化保存到数据库
- [ ] 模板库中的 surface 可一键添加到 Dashboard
- [ ] Composer 可通过可视化操作生成有效的 A2UI JSON
- [ ] Composer 生成的 surface 可直接渲染到 Dashboard
- [ ] JSON 导入/导出功能正常工作
- [ ] 所有现有的 17 个单元测试继续通过
- [ ] 新增功能的单元测试覆盖率 >= 80%
- [ ] Playwright E2E 测试覆盖核心交互流程
