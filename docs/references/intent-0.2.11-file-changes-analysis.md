# Intent 0.2.11 - File Changes Tracking 分析报告

## 概览
Intent 是一个基于 Electron + Svelte 的桌面应用，专注于代码工作空间管理和文件变更跟踪。

## 核心架构

### 技术栈
- **前端框架**: SvelteKit (SSR/SPA)
- **桌面框架**: Electron
- **编辑器**: 
  - CodeMirror 6 (代码编辑)
  - TipTap (富文本/Markdown)
  - Monaco Editor
- **终端**: xterm.js
- **数据库**: better-sqlite3
- **实时协作**: Yjs
- **Git集成**: 自定义实现

### 核心功能模块

#### 1. File Tracking (文件跟踪)
**位置**: `/dist/features/file-tracking/`

**核心组件**:
- `file-tracking.store.svelte.js` - Svelte store，管理文件跟踪状态
- `change-difference-utils.js` - 变更差异计算工具
- `performance-monitor.js` - 性能监控
- `tracking.config.js` - 跟踪配置

**主进程服务**:
- `file-tracking.service.js` - 主要服务逻辑
- `file-tracking-storage.js` - 数据持久化
- `git-integration.service.js` - Git 集成
- `file-tracking.ipc.js` - 进程间通信

**数据类型** (从 TypeScript 定义推断):
```typescript
enum ChangeState {
  Created,
  Modified, 
  Deleted,
  Renamed,
  Conflicted,
  Staged,
  Untracked
}

interface FileChange {
  id: string;
  path: string;
  workspacePath: string;
  state: ChangeState;
  diff: DiffData;
  metadata?: ChangeMetadata;
  timestamp: number;
  source?: 'agent' | 'manual' | 'git' | 'remote';
  agent?: AgentInfo;
  // ... more fields
}

interface ChangeMetadata {
  gitHash?: string;
  branch?: string;
  author?: string;
  message?: string;
  timestamp: number;
  // ... more fields
}
```

#### 2. Workspace Management (工作空间管理)
**位置**: `/dist/features/workspace/`

**核心组件**:
- `workspace-unified-state.svelte.js` - 统一状态管理 (85KB)
- `workspace.store.svelte.js` - 工作空间 store
- `workspace-recency.store.svelte.js` - 最近使用记录
- `workspace-storage-manager.js` - 存储管理
- `workspace.client.js` - 客户端 API
- `optimistic-workspace-manager.js` - 乐观更新管理
- `unified-save-queue.js` - 统一保存队列
- `workspace-metrics.js` - 工作空间指标

**变更检测器**:
- `change-detector-refactored.js` - 重构后的变更检测器
- `change-detector-manager.js` / `change-detector-manager-impl.js` - 变更检测管理
- `remote-change-detector.js` - 远程变更检测
- `change-detection/change-processor.js` - 变更处理器

#### 3. Accept Changes (接受变更)
**位置**: `/dist/features/accept-changes/`

这个模块负责处理用户接受或拒绝文件变更的 UI 和逻辑。

#### 4. Line Changes (行级变更)
**位置**: `/dist/features/line-changes/`

更细粒度的行级别变更跟踪。

#### 5. Git Tracking (Git 跟踪)
**位置**: `/dist/features/git-tracking/`

Git 仓库状态跟踪和同步。

#### 6. Diffs (差异对比)
**位置**: `/dist/features/diffs/`

文件差异计算和显示。

## UI 组件架构

### SvelteKit 路由
从 `index.html` 可以看出使用了 SvelteKit 的 SPA 模式:
- 主入口: `/app/immutable/entry/start.*.js`
- App 入口: `/app/immutable/entry/app.*.js`
- 路由节点: `/app/immutable/nodes/` (0-13 个节点)

### 编辑器集成
应用集成了多个编辑器引擎:
1. **CodeMirror 6**: 主代码编辑器
   - 支持多语言高亮 (JavaScript, Python, Rust, Go, Java, C++, PHP, SQL, YAML, XML, JSON, Markdown, HTML, CSS)
   - 支持 Merge View (`@codemirror/merge`)
   - 支持搜索 (`@codemirror/search`)
   - 支持 Lint (`@codemirror/lint`)

2. **TipTap**: 富文本/Markdown 编辑
   - 支持代码块、表格、链接、图片
   - 支持 Markdown 转换
   - 支持协作编辑

3. **Monaco Editor**: 备选编辑器

### 依赖的核心库
- **D3.js**: 数据可视化 (可能用于展示变更图表)
- **Mermaid**: 图表渲染
- **Diff**: 文本差异算法
- **Cheerio**: HTML 解析
- **Marked**: Markdown 解析
- **Canvas Confetti**: 庆祝动画效果 🎉

## Agent 集成

### Agent 系统
**位置**: `/dist/features/agent/`

应用内置了 AI Agent 支持，可能包括:
- 代码生成
- 变更建议
- 自动化任务

### Specialists (专家角色)
应用定义了多个专家角色:
- `implementor.md` - 实施者
- `developer.md` - 开发者
- `verifier.md` - 验证者
- `ui-designer.md` - UI 设计师
- `pr-shepherd.md` - PR 管理者
- `pr-reviewer.md` - PR 审查者
- `spec-writer.md` - 规范撰写者

这些可能是不同的 AI Agent 角色或工作流模式。

## MCP (Model Context Protocol) 集成
**位置**: `/dist/features/mcp/`

使用了 `@modelcontextprotocol/sdk`，可能用于:
- AI 模型上下文管理
- 与外部 AI 服务通信

## 远程能力

### SSH 支持
**位置**: `/dist/features/ssh/`
使用 `ssh2` 库支持远程工作空间。

### Remote FS (远程文件系统)
**位置**: `/dist/features/remote-fs/`
支持远程文件系统访问。

### CDP (Chrome DevTools Protocol)
**位置**: `/dist/features/cdp/`
使用 `chrome-remote-interface` 进行浏览器自动化。

## 第三方集成

### GitHub
**位置**: `/dist/features/github-auth/`
使用 `@octokit/rest` 进行 GitHub 集成。

### Linear
**位置**: `/dist/features/linear-auth/`
项目管理工具 Linear 的集成。

### Sentry
**位置**: `/dist/features/sentry-auth/`
错误追踪和监控。

## 数据流架构

### IPC (进程间通信)
**位置**: `/dist/features/ipc/`

Electron 主进程和渲染进程之间的通信层。

### Events (事件系统)
**位置**: `/dist/features/events/`

应用内事件总线。

### Storage (存储)
**位置**: `/dist/features/storage/`

- 使用 `electron-store` 进行配置存储
- 使用 `better-sqlite3` 进行结构化数据存储

## 文件变更跟踪的工作流

根据模块结构推断的工作流:

1. **检测变更**:
   - `change-detector-refactored.js` 监听文件系统变化
   - `remote-change-detector.js` 检测远程变更
   - `git-integration.service.js` 集成 Git 状态

2. **处理变更**:
   - `change-processor.js` 处理变更事件
   - `change-difference-utils.js` 计算差异
   - `unified-save-queue.js` 管理保存队列

3. **存储变更**:
   - `file-tracking-storage.js` 持久化变更记录
   - `workspace-storage-manager.js` 管理工作空间状态

4. **展示变更**:
   - `file-tracking.store.svelte.js` 提供响应式状态
   - UI 组件渲染变更列表和差异视图

5. **接受/拒绝变更**:
   - `accept-changes/` 模块处理用户操作
   - 更新工作空间状态

## UI 组件推测

虽然无法直接看到 UI 源码，但从架构推测可能包含:

### 主界面布局
- **侧边栏**: 工作空间选择器、文件树
- **主编辑区**: CodeMirror/Monaco 编辑器
- **变更面板**: 文件变更列表
- **差异视图**: Merge View 显示差异
- **底部面板**: 终端 (xterm.js)

### Changes View (变更视图)
可能包含:
- **文件列表**: 显示所有变更文件
  - 按状态分组 (Created, Modified, Deleted, etc.)
  - 显示变更来源 (agent, manual, git)
  - 时间戳
- **差异视图**: 
  - 行级高亮
  - Accept/Reject 按钮
  - Merge 冲突解决
- **历史记录**: 变更时间线

### Agent 相关 UI
- **Agent 活动日志**: 显示 Agent 执行的操作
- **Agent 建议面板**: 展示 Agent 的变更建议
- **专家模式选择器**: 切换不同的 Agent 角色

## 性能优化

### 性能监控
`performance-monitor.js` 可能跟踪:
- 文件变更检测延迟
- 差异计算时间
- 渲染性能

### 优化策略
- **乐观更新**: `optimistic-workspace-manager.js`
- **保存队列**: `unified-save-queue.js` 批量处理
- **增量计算**: 差异计算采用增量算法
- **WebGL 渲染**: xterm 使用 `@xterm/addon-webgl`

## 特色功能

### 1. 实时协作
使用 Yjs 支持多人协作编辑。

### 2. Terminal 集成
- 使用 `node-pty` 提供真实终端
- xterm.js 渲染
- 支持 Unicode 11
- 支持 Web Links
- 支持搜索和序列化

### 3. 自动更新
**位置**: `/dist/features/auto-update/`
使用 `electron-updater` 支持应用自动更新。

### 4. 导出功能
**位置**: `/dist/features/export/`
支持导出工作空间数据。

### 5. Debug Export
**位置**: `/dist/features/debug-export/`
支持导出调试信息。

## 配置和设置

从 `.claude/settings.local.json` 可以看出:
- 集成了 MCP (Auggie codebase-retrieval)
- 支持 Pencil (可能是另一个编辑器/工具)
- 有权限控制系统

## 总结

Intent 是一个功能丰富的 AI 辅助代码编辑器/工作空间管理工具，核心特点:

1. **强大的文件变更跟踪**: 
   - 多来源变更检测 (本地、Git、远程、Agent)
   - 细粒度差异计算
   - 历史记录管理

2. **AI Agent 集成**:
   - 多种专家角色
   - 自动化工作流
   - MCP 协议支持

3. **现代编辑器体验**:
   - 多编辑器引擎
   - 丰富的语言支持
   - 终端集成

4. **团队协作**:
   - 实时协作编辑
   - Git 集成
   - Linear/GitHub 集成

5. **跨平台远程能力**:
   - SSH 远程工作空间
   - 远程文件系统
   - 浏览器自动化 (CDP)

这个应用很可能是 **Augment Code** 公司开发的 AI 代码助手的桌面客户端。

---

## 深度分析：文件变更跟踪的UI组件和工作流

### 核心状态管理

从编译后的代码分析，Intent 使用了复杂的状态管理系统来追踪文件变更。

#### WorkspaceUnifiedState (工作空间统一状态)

**核心状态结构**:
```typescript
interface WorkspaceState {
  version: number;
  workspace: {
    id: string;
    status: 'loading' | 'ready';
  };
  mainPanel: {
    type: 'notes' | 'file' | 'file-tracking-diff' | 'accept-changes' | 
          'change-set' | 'chat-changes' | 'local-changes' | 
          'commit-changeset' | 'code-review' | 'agent-turn-changes' | 
          'activity-changes' | 'dashboard' | 'browser' | 'empty';
    selectedNoteId?: string;
    selectedFile?: string;
    selectedChangeId?: string;
    selectedTrackedChange?: TrackedChange;
    selectedAgentTurn?: AgentTurnData;
    selectedActivityEvent?: ActivityEvent;
    // ... more fields
  };
  drawer: {
    open: boolean;
    type: 'overview' | null;
    itemId: string | null;
  };
  navigation: {
    history: NavigationEntry[];
    currentIndex: number;
  };
  ui: {
    hasInitialized: boolean;
    lastUpdated: number;
    jumpToLine?: number;
  };
  // Runtime state
  workspaceData: Workspace | null;
  agentsList: Agent[];
  terminalsList: Terminal[];
  workspaceEvents: WorkspaceEvent[];
  isEditingTitle: boolean;
  editingTitle: string;
  isDraggingOver: boolean;
  showPullRequestModal: boolean;
  showAugieSetup: boolean;
  showWorkspaceInitializer: boolean;
  isComponentMounted: boolean;
  agentsLoadingInProgress: boolean;
  isNewlyCreatedWorkspace: boolean;
}
```

#### 导航历史 (Navigation History)

应用维护了一个完整的导航历史栈：

```typescript
interface NavigationEntry {
  type: 'note' | 'file' | 'diff' | 'accept-changes' | 
        'chat-changes' | 'dashboard' | 'change-set' | 
        'agent-turn-changes' | 'activity-changes' | 
        'local-changes' | 'browser' | 'activity' | 
        'staged' | 'unstaged' | 'commit' | 'source' | 
        'agent-aggregate-changes' | 'code-review' | 
        'commit-changeset';
  id: string;
  label?: string;
  timestamp: number;
  scrollPosition?: number;
  trackedChange?: TrackedChange;
  filePath?: string;
  chatChanges?: Change[];
  agentTurnData?: AgentTurnData;
  activityEventData?: ActivityEvent;
  // ... more fields
}
```

**特色功能**:
- 支持前进/后退导航 (类似浏览器)
- 记录每个视图的滚动位置
- 历史条目限制为 50 条，自动修剪

### 文件变更的 UI 面板类型

#### 1. `file-tracking-diff` - 文件差异视图
显示单个文件的变更差异。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-diff', {
  detail: {
    change: TrackedChange,
    filePath: string,
    changeId: string,
    scrollToLine?: number
  }
}));
```

**状态更新**:
```typescript
state.mainPanel.type = 'file-tracking-diff';
state.mainPanel.selectedTrackedChange = change;
state.mainPanel.selectedFile = filePath;
state.mainPanel.selectedChangeId = changeId;
state.mainPanel.scrollToLine = scrollToLine;
```

#### 2. `accept-changes` - 接受变更视图
用户审查并接受/拒绝文件变更的主界面。

**特殊行为**:
- 如果用户在 `file-tracking-diff` 视图再次点击相同的文件，会切换到 `accept-changes` 视图
- 这是一个"汇总"视图，显示所有待处理的变更

#### 3. `change-set` - 变更集视图
准备提交的变更集合。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-commit'));
```

**集成**:
- 自动加载 Git 状态
- 调用 `gitStore.loadStatus(workspaceId, true)`

#### 4. `chat-changes` - 聊天变更视图
显示从 AI 对话中产生的变更。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-chat-changes', {
  detail: {
    changes: Change[],
    title: string,
    messageId: string,
    isAggregate: boolean,
    agentId: string,
    turnNumber: number
  }
}));
```

**特点**:
- 可以显示单条消息的变更
- 可以显示聚合的变更
- 关联到特定的 Agent 和会话

#### 5. `local-changes` - 本地变更视图
显示所有本地未提交的变更。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-local-changes'));
```

#### 6. `commit-changeset` - 提交变更集视图
查看历史提交的变更。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-commit-changeset', {
  detail: {
    commitHash: string,
    commitMessage: string
  }
}));
```

#### 7. `code-review` - 代码审查视图
AI 驱动的代码审查面板。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:open-code-review', {
  detail: {
    result: string,
    agentId: string,
    stagedFiles: string[],
    status: 'running' | 'complete' | 'error'
  }
}));
```

**实时更新**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:code-review-update', {
  detail: {
    status: string,
    result?: string,
    streamingText?: string,
    error?: Error
  }
}));
```

**特点**:
- 支持流式更新
- 显示审查进度
- 可以查看 staged 文件

#### 8. `agent-turn-changes` - Agent 回合变更
显示 Agent 特定回合产生的所有变更。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:navigate-to-changes', {
  detail: {
    type: 'agent-turn-changes',
    agentId: string,
    sessionId: string,
    turnNumber: number
  }
}));
```

#### 9. `activity-changes` - 活动变更
基于工作空间活动事件的变更视图。

**触发方式**:
```javascript
window.dispatchEvent(new CustomEvent('workspace:navigate-to-changes', {
  detail: {
    type: 'activity-changes',
    event: ActivityEvent
  }
}));
```

### 提交消息生成器

从代码片段中发现了一个智能提交消息生成功能：

**输入**:
- 变更文件列表及其状态
- 文件差异内容
- 最近的提交消息（用于上下文）

**处理逻辑**:
- 跳过过大的文件 diff
- 标记被跳过的文件及原因
- 对于截断的文件显示大小

**输出格式**:
```
Guidelines:
- Be concise but descriptive
- Use present tense ("add" not "added")
- Don't end the subject with a period
- Include a body for complex changes
- Focus on WHY the change was made, not just what changed

Wrap your final commit message in <<<COMMIT_MESSAGE>>> and <<</COMMIT_MESSAGE>>> tags.

Files changed (N):
- path/to/file1.ts (modified)
- path/to/file2.ts (new file)
- path/to/file3.ts (deleted)

## Note: X file(s) had their diffs skipped:
- large-file.json (too large)

## Note: Y file(s) had their diffs truncated due to size:
- another-large-file.ts (123KB)

## Recent commit messages for context:
...
```

### 跨窗口同步

Intent 支持多窗口同步：

**机制**:
1. 使用 `localStorage` 的 `storage` 事件
2. 监听键名格式: `workspace:state:${workspaceId}`
3. 跨窗口监听器回调

**同步的状态**:
- `mainPanel` 变化
- `navigation` 变化
- 其他工作空间状态更新

### 性能优化

#### 1. 内存缓存
```typescript
memoryCache: Map<string, WorkspaceState>
```
避免重复读取 localStorage。

#### 2. 防抖保存
默认 300ms 延迟，批量保存状态更新。

#### 3. 统一保存队列 (Unified Save Queue)
```typescript
class UnifiedSaveQueue {
  debounceMs: 300;
  maxRetries: 3;
  queue: Map<string, any>;
  
  schedule(key, data);
  flush();
  flushSync(); // 同步刷新（在页面卸载时）
}
```

**特点**:
- 自动重试机制
- Quota 超限时清理旧数据
- 在 `beforeunload` 时同步刷新

#### 4. 乐观更新 (Optimistic Updates)

```typescript
class OptimisticWorkspaceManager {
  optimisticWorkspaces: Map<string, OptimisticWorkspace>;
  pendingCreations: Set<string>;
  
  createOptimisticWorkspace(name, path): tempId;
  resolveOptimisticWorkspace(tempId, realWorkspace);
  failOptimisticWorkspace(tempId, error);
}
```

用于创建工作空间时的即时 UI 反馈。

#### 5. 状态缓存和自动清理

- 最多缓存 3 个工作空间状态
- 超过 5 分钟未访问的状态自动释放
- 每分钟运行一次清理任务

### 文件变更跟踪的完整生命周期

#### 1. 变更检测
```
文件系统变化
    ↓
change-detector-refactored.js
    ↓
change-processor.js
    ↓
change-difference-utils.js (计算差异)
    ↓
file-tracking-storage.js (持久化)
```

#### 2. 状态同步
```
主进程 (file-tracking.service.js)
    ↓
IPC (file-tracking.ipc.js)
    ↓
渲染进程 (file-tracking.store.svelte.js)
    ↓
UI 组件
```

#### 3. Git 集成
```
Git 事件
    ↓
git-integration.service.js
    ↓
file-tracking.service.js
    ↓
合并到统一状态
```

#### 4. UI 交互
```
用户点击文件变更
    ↓
dispatchEvent('workspace:open-diff')
    ↓
WorkspaceUnifiedState.openDiff()
    ↓
更新 mainPanel 状态
    ↓
导航历史记录
    ↓
保存滚动位置
    ↓
UI 重新渲染
```

#### 5. 接受变更
```
用户在 accept-changes 面板操作
    ↓
Accept Changes 模块
    ↓
更新文件状态
    ↓
从 tracking 中移除
    ↓
可选：自动提交到 Git
```

### UI 布局推测（基于状态管理）

```
┌─────────────────────────────────────────────────┐
│ Workspace Title Bar                             │
├───────────┬─────────────────────────┬───────────┤
│           │                         │           │
│ Sidebar   │   Main Panel            │  Drawer   │
│           │                         │ (optional)│
│ - Files   │  [Dynamic Content]      │           │
│ - Notes   │                         │ - Overview│
│ - Changes │  Types:                 │ - Details │
│ - Git     │  • notes                │           │
│ - Agents  │  • file                 │           │
│ - Activity│  • file-tracking-diff   │           │
│           │  • accept-changes       │           │
│           │  • change-set           │           │
│           │  • chat-changes         │           │
│           │  • local-changes        │           │
│           │  • commit-changeset     │           │
│           │  • code-review          │           │
│           │  • agent-turn-changes   │           │
│           │  • activity-changes     │           │
│           │  • browser              │           │
│           │  • dashboard            │           │
│           │                         │           │
├───────────┴─────────────────────────┴───────────┤
│ Bottom Panel (Terminal / Console)               │
└─────────────────────────────────────────────────┘
```

### 关键 UI 事件

Intent 使用自定义事件在组件间通信：

| 事件名                                | 用途                        |
|---------------------------------------|----------------------------|
| `workspace:open-file`                 | 打开文件                    |
| `workspace:open-note`                 | 打开笔记                    |
| `workspace:open-browser-url`          | 打开浏览器视图              |
| `workspace:open-diff`                 | 打开差异视图                |
| `workspace:open-commit`               | 打开提交视图                |
| `workspace:navigate-to-changes`       | 导航到特定变更              |
| `workspace:open-chat-changes`         | 打开聊天变更                |
| `workspace:open-local-changes`        | 打开本地变更                |
| `workspace:open-commit-changeset`     | 打开提交变更集              |
| `workspace:open-code-review`          | 打开代码审查                |
| `workspace:code-review-update`        | 代码审查实时更新            |
| `note:save-scroll-position`           | 保存笔记滚动位置            |
| `note:restore-scroll-position`        | 恢复笔记滚动位置            |
| `file:save-scroll-position`           | 保存文件滚动位置            |
| `file:restore-scroll-position`        | 恢复文件滚动位置            |
| `panel:request-focus`                 | 请求面板焦点                |

### 多面板支持

Intent 支持类似 VS Code 的多面板布局：

```typescript
const panelLayoutManager = getPanelLayoutManager(workspaceId);

// 在相邻面板或分割面板打开
panelLayoutManager.openTabInAdjacentOrSplit({
  type: 'file' | 'note' | 'browser',
  title: string,
  closable: boolean,
  workspaceId: string,
  // type-specific data
  filePath?: string,
  noteId?: string,
  browserUrl?: string,
  data?: any
}, sourcePanelId?);

// 在当前面板打开标签页
panelLayoutManager.openTab({...});

// 更新文件路径（重命名时）
panelLayoutManager.updateFileTabPath(oldPath, newPath);

// 聚焦面板
panelLayoutManager.focusedPanelId
```

### 文件重命名处理

当文件重命名时，Intent 会：

1. 更新所有打开的面板标签页
2. 更新主面板的 `selectedFile`
3. 更新导航历史中的所有引用
4. 处理工作树路径（worktree path）和相对路径

### 数据持久化策略

**键名格式**:
```
workspace:state:${workspaceId}
```

**存储内容**:
```typescript
{
  version: 2,
  workspace: {...},
  mainPanel: {...},
  drawer: {...},
  navigation: {
    history: [...], // 简化版，不包含运行时数据
    currentIndex: number
  },
  ui: {...}
}
```

**不持久化的数据**:
- `workspaceData` (从 Workspace Store 重新加载)
- `agentsList` (从 Agent Store 重新加载)
- `terminalsList` (运行时状态)
- `workspaceEvents` (从 Event Store 重新加载)
- 所有 UI 临时状态（模态框、拖拽状态等）

### 状态迁移

支持从旧版本迁移状态：

```typescript
migrateState(oldState) {
  if (oldState.version === 1) {
    // 从 v1 迁移到 v2
    return {
      version: 2,
      workspace: { id: oldState.workspaceId, status: 'ready' },
      mainPanel: {
        type: oldState.mainContentType || 'notes',
        selectedFile: oldState.selectedFile,
        selectedNoteId: oldState.selectedNoteId,
        // ... 映射其他字段
      },
      drawer: {
        open: oldState.drawerOpen || false,
        type: oldState.drawerType || null,
        itemId: oldState.dockActiveItemId || null
      },
      // ... 更多映射
    };
  }
  return oldState;
}
```

## 总结：Intent 的文件变更跟踪架构

Intent 实现了一个**企业级的文件变更跟踪和协作系统**，其核心特点：

### 1. **多视图变更管理**
- 9+ 种不同的变更视图类型
- 统一的状态管理
- 无缝切换和导航

### 2. **智能上下文保持**
- 滚动位置记忆
- 导航历史栈（支持前进/后退）
- 跨窗口状态同步

### 3. **AI 原生设计**
- Agent 变更跟踪
- 聊天消息关联的变更
- AI 驱动的代码审查
- 智能提交消息生成

### 4. **性能优化**
- 内存缓存 + 防抖保存
- 乐观更新
- 自动清理机制
- 批量保存队列

### 5. **Git 深度集成**
- 实时 Git 状态同步
- Staged/Unstaged 视图
- 提交历史查看
- 文件重命名处理

### 6. **协作能力**
- 实时文件同步
- 跨窗口状态共享
- 远程工作空间支持

这是一个**高度复杂、功能丰富的 AI 辅助代码编辑器**，专为现代团队协作和 AI 增强的工作流设计。

