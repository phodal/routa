---
title: "Issue #100 实现状态分析 - Kanban Agent 多任务创建与列转换自动化"
date: 2026-03-09
status: resolved
resolved_at: "2026-04-03"
area: kanban
issue: https://github.com/phodal/routa/issues/100
language: zh-CN
---

# Issue #100 实现状态分析

## 📊 总体进度：约 60% 完成

### ✅ 已实现功能

#### 1. Kanban Agent 专家 (Phase 1) ✅
- **文件**: `resources/specialists/kanban-agent.md`
- **功能**: 
  - 从自然语言分解任务
  - 通过 `decompose_tasks` 工具批量创建任务
  - 包含任务大小和优先级指南

#### 2. 任务分解工具 (Phase 1) ✅
- **MCP 工具**: `decompose_tasks` 已注册
- **API 端点**: `/api/kanban/decompose` 完全实现
- **后端**: `KanbanTools.decomposeTasks()` 完全功能
- **特性**: 支持批量创建任务,包含标题、描述、优先级、标签

#### 3. 列转换事件 (Phase 2) ✅
- **事件类型**: `COLUMN_TRANSITION` 已定义
- **处理器**: `ColumnTransitionHandler` 类完全实现
- **功能**:
  - 卡片移动时触发事件
  - 支持 entry/exit/both 转换类型
  - 集成到 `KanbanWorkflowOrchestrator`

#### 4. 列自动化配置 (Phase 2) ✅
- **接口**: `KanbanColumnAutomation` 完全定义
- **字段**: enabled, providerId, role, specialistId, transitionType, requiredArtifacts, autoAdvanceOnSuccess
- **UI**: 列自动化设置面板已实现

#### 5. Desk Check Agent 专家 (Phase 3 - 部分) ✅
- **文件**: `resources/specialists/desk-check.md`
- **功能**: 代码审查清单、读取 agent 对话、移动卡片
- **缺失**: artifact 请求工具

#### 6. 工作流编排 (Phase 4 - 部分) ✅
- **类**: `KanbanWorkflowOrchestrator`
- **功能**: 自动推进卡片、跟踪自动化状态
- **缺失**: artifact 要求验证

---

### ❌ 缺失功能

#### 1. Agent 间 Artifact 通信 ❌ (关键缺口)

**需要的工具**:
- `request_artifact`: 从其他 agent 请求 artifact
- `provide_artifact`: 提供 artifact 响应

**当前状态**: 完全未实现
- 无 MCP 工具注册
- 无后端实现
- 无 artifact 存储机制

**影响**: Desk Check Agent 无法从 Dev Agent 请求截图或测试结果

#### 2. Artifact 存储系统 ❌

**需要**: 存储层用于 artifacts (截图、测试结果、代码差异)

**当前状态**: 
- A2A 协议有 `A2AArtifact` 接口,但未用于 Kanban
- 无通用 artifact 存储

**建议实现**:
- 选项 A: 作为 Note 附件存储
- 选项 B: 创建专用 `ArtifactStore` (推荐)
- 选项 C: 使用 A2A artifact 系统

#### 3. 截图捕获集成 ❌

**需要**: Agent 在实现过程中自动捕获截图

**当前状态**:
- `agent-browser` skill 存在,有截图能力
- Playwright MCP 工具可用
- **缺失**: 与 agent 工作流集成
- **缺失**: Agent 触发截图的工具

**建议**: 添加 `capture_screenshot` MCP 工具

#### 4. Artifact 要求强制执行 ❌

**需要**: 如果缺少必需的 artifact,阻止列转换

**当前状态**: 
- `requiredArtifacts` 字段存在但**未强制执行**

**需要实现**:
- 在 `ColumnTransitionHandler` 中检查 `requiredArtifacts`
- 查询 artifact 存储
- 缺少时拒绝转换并显示错误

#### 5. 并行任务执行跟踪 ❌

**问题**: "多个任务能同时在 Dev 列中由不同 agent 处理吗?"

**当前状态**:
- 代码中无硬性限制,可以多个 agent 同时活动
- **缺失**: 显示并行 agent 活动的 UI 面板
- **缺失**: 资源限制或任务队列

**建议**: 添加 "Agent Activity Panel" 到 Kanban UI

#### 6. 列 Agent 命名不清晰 ❌

**问题**: "Column Agent" vs "Transition Agent" vs "Stage Agent"?

**建议**: 使用 **"Transition Agent"** (更准确)

---

## 🔧 推荐实现顺序

### 优先级 1: Artifact 通信 (关键缺口)
1. **创建 Artifact Store** (2-3 天)
   - 定义 `Artifact` 模型
   - 实现 `ArtifactStore` (SQLite + Postgres)
   - CRUD 操作

2. **实现 MCP 工具** (1-2 天)
   - `request_artifact` 在 `AgentTools`
   - `provide_artifact` 在 `AgentTools`
   - 注册到 `routa-mcp-tool-manager.ts`

3. **截图集成** (1 天)
   - 添加 `capture_screenshot` MCP 工具
   - 包装 `agent-browser screenshot`
   - 自动存储为 artifact

### 优先级 2: Artifact 强制执行 (中等)
4. **强制执行必需 Artifacts** (1 天)
   - 更新 `ColumnTransitionHandler`
   - 阻止缺少 artifact 的转换
   - UI 反馈

### 优先级 3: UI 增强 (低)
5. **Agent Activity Panel** (2 天)
   - 显示每列的活动 agent
   - 显示 artifact 请求/响应
   - 链接到 agent 会话

6. **Artifact 预览** (1 天)
   - 在任务卡上显示附加的 artifacts
   - 内联预览截图
   - 下载测试结果

---

## 📋 实现清单

### Phase 1: Kanban Agent Specialist
- [x] 创建 `kanban-agent.md` ✅
- [x] 添加 `decompose_tasks` 工具 ✅
- [x] 集成到 `kanban-tab.tsx` ✅

### Phase 2: Column Transition Events
- [x] 发出 `COLUMN_TRANSITION` 事件 ✅
- [x] 创建 `ColumnTransitionHandler` ✅
- [x] 基于配置触发 Column Agent ✅

### Phase 3: Desk Check Agent
- [x] 创建 `desk-check.md` ✅
- [ ] 实现 `request_artifact` 工具 ❌
- [ ] 实现 `provide_artifact` 工具 ❌
- [ ] 添加截图捕获能力 ❌

### Phase 4: Workflow Orchestration
- [x] 实现 `KanbanWorkflowOrchestrator` ✅
- [x] 跟踪任务进度 ✅
- [x] 成功时自动推进 ✅
- [ ] 强制执行 artifact 要求 ❌
- [ ] 发出工作流完成事件 (部分完成)

---

## 💡 关键发现

1. **基础设施完善**: 多 agent 协调、事件总线、任务分解的核心基础设施已经完成
2. **关键缺口**: Agent 间 artifact 通信是最大的缺失功能
3. **估算准确**: 剩余工作量 1-2 周,与 issue 估算的 2-3 周总时长一致
4. **架构合理**: 现有设计支持扩展,添加 artifact 系统不需要重大重构

---

## 📝 下一步行动

1. 实现 artifact 存储层 (优先级最高)
2. 添加 `request_artifact` 和 `provide_artifact` MCP 工具
3. 集成截图捕获
4. 在转换中强制执行 artifact 要求
5. 构建 agent 活动 UI 面板

详细分析见: `docs/issues/2026-03-09-issue-100-implementation-analysis.md`

## 归档说明

这份文档现在作为历史分析快照保留，不再作为活跃 issue 跟踪项。

- GitHub `#100` 的本地镜像文件
  `docs/issues/2026-03-09-gh-100-feat-kanban-implement-kanban-agent-with-multi-task-creation-and-column-t.md`
  已是 `resolved`。
- GitHub 上游 issue 也已经关闭。
- 文中列出的缺口仍可作为后续演进参考，但不应继续让本文件保持
  `investigating` 状态。
