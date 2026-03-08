---
title: "Spec Analysis: Lightweight Worker Orchestration Architecture Design"
issue: 71
date: 2026-03-07
labels: [backend, enhancement, architecture]
author: phodal
status: open
---

# Spec Analysis: Lightweight Worker Orchestration Architecture (#71)

## 需求概述

Issue #71 提出在现有 Routa.js 双后端架构（Next.js + Rust/Axum）之上，设计一套**轻量级 Worker 编排方案**，核心目标是将当前单进程、硬编码并发的 `BackgroundTaskWorker` 演进为具备调度决策、资源感知、故障恢复能力的 Worker 池化架构，且**不引入外部消息队列依赖**（如 Redis/RabbitMQ），仅复用现有 DB（Postgres/SQLite）作为任务队列。

### 核心驱动力

1. **并发瓶颈** -- 当前 `MAX_CONCURRENT_TASKS = 2` 硬编码，无法根据宿主机资源动态调整。
2. **调度公平性缺失** -- 纯 Priority FIFO 调度，大量 webhook/polling 任务可饿死手动任务。
3. **故障检测滞后** -- 依赖 2h 超时 + 5min 孤儿检测，缺乏心跳机制，僵尸任务处理不及时。
4. **资源不区分** -- 不区分 local process 与 Docker container 的资源消耗差异。
5. **Vercel 适配** -- 单进程 singleton 模式无法在 Vercel 无状态 serverless 环境下持久运行。
6. **任务亲和缺失** -- 无法将特定任务路由到特定执行环境（本地进程 vs Docker 容器）。

### 设计原则

- **零外部依赖** -- 复用 DB 作为任务队列
- **渐进式演进** -- 兼容现有 `BackgroundTaskWorker`，可逐步迁移
- **双后端对称** -- 架构设计同时适用于 Next.js 和 Rust backend
- **环境自适应** -- 自动感知 local dev / Docker / Vercel 等部署形态

---

## 涉及的模块/文件

### 核心调度层（需要重构/新建）

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/core/background-worker/index.ts` | 现有调度 Worker（单进程 setInterval 轮询） | **重大重构** -- 调度逻辑提取至 Scheduler，保留为兼容入口 |
| `src/core/acp/acp-process-manager.ts` | ACP 会话管理（管理 6 种 adapter/process） | **封装** -- 封装为 `LocalWorker`，适配 Worker 接口 |
| `src/core/acp/docker/process-manager.ts` | Docker 容器管理（含容器复用逻辑） | **封装** -- 封装为 `DockerWorker`，适配 Worker 接口 |

### 数据模型层（需要扩展）

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/core/models/background-task.ts` | 任务模型定义（含 Workflow 编排字段） | **扩展** -- 可能新增 `assignedWorkerId`、`constraints` 字段 |
| `src/core/store/background-task-store.ts` | 任务持久化接口 + InMemory 实现 | **扩展** -- 新增 Worker 相关查询方法 |
| `src/core/db/pg-background-task-store.ts` | Postgres 实现 | **扩展** -- 同步 store 接口变更 |

### 系统初始化层

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/core/routa-system.ts` | 系统组件初始化（Pg/SQLite/InMemory） | **扩展** -- 注册 WorkerRegistry、Scheduler 等新组件 |

### API 层

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/app/api/background-tasks/route.ts` | 任务 REST API | **微调** -- 可能新增 worker 状态查询端点 |
| `src/app/api/schedules/tick/route.ts` | 定时任务触发 | **不变** -- 继续作为任务入队源 |

### Docker 基础设施

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/core/acp/docker/types.ts` | Docker 容器类型定义（含 `PooledContainerInfo`） | **扩展** -- 已有池化类型，需与 Worker 抽象对齐 |
| `src/core/acp/docker/detector.ts` | Docker 可用性检测 | **不变** -- 被 DockerWorker 复用 |

### Rust 对称后端

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `crates/routa-server/src/api/background_tasks.rs` | Rust 端 Background Tasks API（当前为 stub） | **重大实现** -- 需实现完整调度逻辑 |

### Workflow 引擎（间接影响）

| 文件路径 | 角色 | 变更类型 |
|---------|------|---------|
| `src/core/workflows/workflow-executor.ts` | Workflow 执行器（通过 BackgroundTask 编排步骤） | **间接受益** -- 新调度引擎自动支持 workflow 步骤的约束路由 |
| `src/core/workflows/workflow-types.ts` | Workflow 类型定义 | **不变** |

---

## 技术方案建议

### Phase 1: Worker 抽象层（基础）

**目标**: 定义统一的 `Worker` 接口，将现有执行环境封装为 Worker 实现。

1. **定义 Worker 接口** -- 新建 `src/core/worker/worker.ts`
   - 接口包含 `id`, `type`, `capabilities`, `status`, `currentLoad`, `maxConcurrency`
   - 方法: `execute(task)`, `cancel(taskId)`, `heartbeat()`
   - `WorkerType`: `"local" | "docker" | "remote"`
   - `WorkerStatus`: `"REGISTERED" | "HEALTHY" | "SUSPECT" | "UNHEALTHY" | "DEAD"`

2. **实现 LocalWorker** -- 封装 `AcpProcessManager`
   - capabilities: `["acp", "opencode", "claude", "claude-code-sdk", "workspace-agent"]`
   - 利用现有的 `createSession`/`createClaudeSession`/`createDockerSession` 等方法
   - `maxConcurrency` 根据系统 CPU 核数动态设定

3. **实现 DockerWorker** -- 封装 `DockerProcessManager`
   - capabilities: `["acp", "opencode", "isolated"]`
   - 利用现有的 `acquireContainer`/容器复用逻辑
   - 重要: `DockerProcessManager` 已实现了 `persistentContainer` 复用和 `idleTimeout` 机制，可直接适配

4. **实现 WorkerRegistry** -- 新建 `src/core/worker/registry.ts`
   - 内存 `Map<string, Worker>` + DB fallback
   - `register`/`deregister`/`getAvailable(constraints)` 方法
   - 关键约束: **DB-driven** 状态，确保双后端可共享数据库

### Phase 2: 调度引擎增强

**目标**: 从简单的 Priority FIFO 演进为多维度调度。

1. **Constraint Filter** -- Worker capabilities 匹配任务 requirements
   - 任务模型扩展 `constraints?: { capabilities?: string[], environment?: "local" | "docker" }` 字段
   - 调度时校验: `worker.capabilities` 包含 `task.constraints.capabilities`

2. **Fair Scheduling** -- 限制单个 workspace 的并发占比
   - 新增配置: `maxConcurrentPerWorkspace`（默认值 = 总并发 / 2）
   - 防止某个 workspace 的大量 webhook 任务饿死其他 workspace 的手动任务

3. **Affinity Scoring** -- 优先分配到曾执行过同 workspace 任务的 Worker
   - Worker 维护 `recentWorkspaces: Set<string>`
   - 对于 Docker Worker 尤其重要: 容器可能已加载了 workspace 的 git 仓库，复用可避免冷启动

4. **动态并发控制** -- 替代硬编码 `MAX_CONCURRENT_TASKS = 2`
   - 根据系统资源（CPU、内存）动态调整
   - Docker Worker 和 Local Worker 分别计算并发上限

### Phase 3: 心跳与故障恢复

**目标**: 引入心跳机制，替代粗粒度的超时检测。

1. **心跳机制**
   - Worker 每 10s 向 HealthMonitor 报告: `heartbeat(workerId, load, taskIds)`
   - HealthMonitor 更新 `lastSeen` 时间戳
   - Next.js 端: `setInterval`；Rust 端: `tokio::time::interval`

2. **故障恢复状态机**
   - `HEALTHY -> SUSPECT (miss 1) -> UNHEALTHY (miss 3) -> DEAD (miss 6, 60s)`
   - UNHEALTHY 时: 查找被分配给该 Worker 的任务，reset 为 PENDING
   - DEAD 时: 反注册 Worker，释放资源

3. **Dead Letter Queue**
   - 任务重试次数耗尽后进入 DLQ 状态（新增 `DEAD_LETTER` 状态到 `BackgroundTaskStatus`）
   - 提供 API 查看和手动重试 DLQ 任务

### Phase 4: Docker 容器池化

**目标**: 从单一 persistentContainer 演进为多容器池。

当前 `DockerProcessManager` 已有基础的容器复用（`persistentContainer`），需要扩展为完整的容器池:

1. **ContainerPoolManager**
   - `minIdle: 0`（dev 模式节省资源）
   - `maxTotal: 5`（可配置上限）
   - `idleTTL: 5min`（已有实现: `CONTAINER_IDLE_TIMEOUT_MS`）
   - `warmupOnDemand: true`

2. **Auto-Scaler**
   - `queue depth > idle count` -> scale up（启动新容器）
   - `idle > min + TTL expired` -> scale down（停止空闲容器）
   - 利用已有 `PooledContainerInfo` 类型（`src/core/acp/docker/types.ts`）

---

## 数据库 Schema 变更建议

### background_tasks 表扩展

```sql
ALTER TABLE background_tasks ADD COLUMN assigned_worker_id TEXT;
ALTER TABLE background_tasks ADD COLUMN constraints JSONB;  -- {"capabilities": [...], "environment": "docker"}
ALTER TABLE background_tasks ADD COLUMN queued_at TIMESTAMP;
ALTER TABLE background_tasks ADD COLUMN dispatched_at TIMESTAMP;
```

### 新增 worker_registry 表

```sql
CREATE TABLE worker_registry (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- "local" | "docker" | "remote"
  capabilities TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  current_load INTEGER DEFAULT 0,
  max_concurrency INTEGER DEFAULT 2,
  last_heartbeat TIMESTAMP,
  metadata JSONB,               -- 扩展信息（Docker container info 等）
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 风险点

### 1. 双后端一致性风险 (高)

- **问题**: Rust 端 `background_tasks.rs` 当前为纯 stub 实现（返回空列表），与 Next.js 端功能差距巨大。
- **影响**: Worker 编排需要两个后端实现完全相同的调度语义，否则前端在切换后端时行为不一致。
- **建议**: Phase 1 优先在 Next.js 端验证架构，Rust 端同步实现但可滞后一个 phase。调度决策必须 DB-driven，避免纯内存状态导致的不一致。

### 2. Vercel 无状态环境适配 (高)

- **问题**: Issue 明确指出 Vercel 是无状态 serverless 环境，长轮询 worker 无法持久运行。当前 `BackgroundTaskWorker` 的 `setInterval` 模式在 Vercel 上不可用。
- **影响**: Scheduler/WorkerRegistry 的内存状态在每次 cold start 后丢失。
- **建议**: 
  - Vercel 模式下使用 Cron + Edge Function 触发调度（已有 `/api/schedules/tick` 先例）
  - 所有调度状态持久化到 DB，内存仅作缓存
  - Worker 心跳通过 DB timestamp 实现，而非内存回调

### 3. 渐进式迁移的兼容性 (中)

- **问题**: 新架构需兼容现有 `BackgroundTaskWorker` 的行为，包括已有的 Workflow 编排（`dependsOnTaskIds`）、progress tracking、orphan detection 等。
- **影响**: 如果新 Scheduler 与旧 Worker 并行运行，可能出现双重 dispatch。
- **建议**: 引入 feature flag（环境变量 `ROUTA_WORKER_V2=true`），新旧 Worker 互斥启动。

### 4. Docker 容器池化的资源消耗 (中)

- **问题**: 每个 Docker 容器被限制为 2 CPU + 2GB 内存（见 `process-manager.ts` L215-217），多容器池会显著增加宿主机资源消耗。
- **影响**: 本地开发环境可能资源不足。
- **建议**: 池化策略需区分部署环境: 本地开发 `minIdle=0, maxTotal=2`，生产环境 `minIdle=1, maxTotal=5`。

### 5. 任务模型 Schema 变更的迁移成本 (中)

- **问题**: 新增 `assigned_worker_id`、`constraints` 等字段需要 Drizzle ORM migration，影响 Postgres 和 SQLite 两个 schema。
- **影响**: 需要同时维护 `drizzle/` 和 `drizzle-sqlite/` 两套 migration。
- **建议**: Phase 1 先不改 schema，用 Worker 内存状态追踪任务分配；Phase 2 再做 DB schema 迁移。

### 6. Workflow 引擎的调度兼容性 (低)

- **问题**: `WorkflowExecutor` 创建的 BackgroundTask 依赖 `dependsOnTaskIds` 和 `listReadyToRun()` 来实现步骤依赖。新 Scheduler 必须保留这一语义。
- **影响**: 如果新的 Constraint-based routing 忽略了依赖检查，workflow 步骤会乱序执行。
- **建议**: `listReadyToRun()` 逻辑必须在新 Scheduler 的 dispatch 流程中保留为第一步。

---

## 实施步骤

### Phase 1: Worker 抽象层 (预计 5-6 天)

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1.1 | 定义 `Worker` 接口、`WorkerType`、`WorkerStatus` 类型 | 新建 `src/core/worker/types.ts` |
| 1.2 | 实现 `LocalWorker`，封装 `AcpProcessManager` | 新建 `src/core/worker/local-worker.ts` |
| 1.3 | 实现 `DockerWorker`，封装 `DockerProcessManager` | 新建 `src/core/worker/docker-worker.ts` |
| 1.4 | 实现 `WorkerRegistry`（内存 Map + DB fallback） | 新建 `src/core/worker/registry.ts` |
| 1.5 | 单元测试覆盖 Worker 接口和 Registry | 新建 `src/core/worker/__tests__/` |
| 1.6 | 在 `RoutaSystem` 中注册 WorkerRegistry | 修改 `src/core/routa-system.ts` |

### Phase 2: 调度引擎增强 (预计 5-7 天)

| 步骤 | 内容 | 文件 |
|------|------|------|
| 2.1 | 提取调度逻辑至 `Scheduler` 类 | 新建 `src/core/worker/scheduler.ts` |
| 2.2 | 实现 Constraint-based routing（capabilities 匹配） | `scheduler.ts` |
| 2.3 | 实现 Fair Scheduling（per-workspace 配额） | `scheduler.ts` |
| 2.4 | 实现动态并发控制（替代 `MAX_CONCURRENT_TASKS = 2`） | `scheduler.ts` |
| 2.5 | 扩展 `BackgroundTask` 模型添加 `constraints` 字段 | 修改 `src/core/models/background-task.ts` |
| 2.6 | 重构 `BackgroundTaskWorker` 为 Scheduler 的薄封装 | 修改 `src/core/background-worker/index.ts` |
| 2.7 | E2E 测试: 手动任务 + webhook 任务混合调度场景 | `e2e/` |

### Phase 3: 心跳与故障恢复 (预计 5 天)

| 步骤 | 内容 | 文件 |
|------|------|------|
| 3.1 | 实现 `HealthMonitor`（心跳收集 + 状态机） | 新建 `src/core/worker/health-monitor.ts` |
| 3.2 | Worker 心跳上报机制 | 修改 `local-worker.ts`、`docker-worker.ts` |
| 3.3 | 故障恢复: 检测 DEAD Worker，重新分配任务 | `health-monitor.ts` + `scheduler.ts` |
| 3.4 | 新增 `DEAD_LETTER` 状态支持 | 修改 `background-task.ts`、Store 实现 |
| 3.5 | DB schema migration（`worker_registry` 表） | `drizzle/`、`drizzle-sqlite/` |

### Phase 4: Docker 容器池化 (预计 5-7 天)

| 步骤 | 内容 | 文件 |
|------|------|------|
| 4.1 | 重构 `DockerProcessManager` 为 `ContainerPoolManager` | 修改 `src/core/acp/docker/process-manager.ts` |
| 4.2 | 实现多容器池管理（从单一 persistentContainer 扩展） | `process-manager.ts` |
| 4.3 | 实现 Auto-Scaler（基于队列深度的弹性伸缩） | 新建 `src/core/worker/auto-scaler.ts` |
| 4.4 | 环境自适应配置（local dev vs production 参数差异） | 配置文件或环境变量 |
| 4.5 | 集成测试: 多容器并发任务执行 | `tests/` |

### 预计总工期: 20-25 天（可并行部分工作）

---

## 与现有代码的关键映射

```
BackgroundTaskWorker  ----提取调度逻辑----> Scheduler
AcpProcessManager     ----封装为--------> LocalWorker
DockerProcessManager  ----封装为--------> DockerWorker
BackgroundTaskStore   ----扩展worker字段--> WorkerRegistry(DB部分)
BGWorker.checkCompletions ----提取故障检测--> HealthMonitor
```

## 开放问题（需团队决策）

1. **Vercel Cron 调度器** -- 是否引入 Vercel Cron + Edge Function 作为 serverless 调度器？现有 `/api/schedules/tick` 是一个参考模式。
2. **独立 Worker 进程** -- 是否需要支持独立的 Worker 进程（类似 GitLab Runner），还是仅在 Next.js 进程内运行？
3. **Docker 资源限额** -- Docker Worker 的 `--cpus`/`--memory` 限制是否需要纳入调度决策？当前硬编码为 2 CPU + 2GB。
4. **多租户隔离** -- 多个 workspace 共享 Worker Pool 时，是否需要硬隔离机制？
