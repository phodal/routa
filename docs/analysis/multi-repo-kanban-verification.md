# 多仓库看板协同方案验证报告

**Task ID**: 49405b3f-89c7-4d8c-821c-fbea1e0751ef
**Date**: 2026-04-17
**Type**: 架构分析与设计验证

## 验收标准验证

### AC1: 完整的架构分析文档
- ✅ 现状分析完成：已识别已有架构基础（Workspace:Codebase = 1:N）和实际缺口
- ✅ 缺口识别完成：6个关键缺口已详细说明（看板视图、分支策略、任务工作树、GitHub同步、依赖管理、PR协调）
- ✅ 根治方案设计完成：完整的架构原则和实施方案

### AC2: 数据模型扩展设计
- ✅ Task 模型增强：`worktreesByCodebase`, `pullRequests`, `repositoryDependencies`
- ✅ Board 配置增强：`perCodebaseOverrides`, `multiRepoStrategy`
- ✅ CodebaseGroup 概念设计（可选）

### AC3: API 增强设计
- ✅ Kanban 任务过滤：`/api/tasks?codebaseId={id}`
- ✅ 看板视图过滤状态管理：通过 `workspace.metadata` 存储

### AC4: 核心组件改造方案
- ✅ TaskWorktreeTruth 增强：`MultiCodebaseWorktreePlan`
- ✅ 分支规则解析增强：`resolveCodebaseBranchRules`
- ✅ Workflow Orchestrator 增强：多仓库完成逻辑
- ✅ PR 协调器：`MultiRepoPRCoordinator`

### AC5: UI 增强设计
- ✅ 看板工具栏：Codebase 过滤器组件设计
- ✅ 卡片详情：多 PR 展示组件设计
- ✅ 工作树切换器：多仓库工作树切换 UI

### AC6: 跨仓库依赖管理设计
- ✅ 依赖类型定义：`must_merge_first`, `branch_based`, `sync_tag`
- ✅ Dependency Gate 增强：`checkMultiRepoDependencyGate`

### AC7: 分阶段实施路线图
- ✅ Phase 1: 数据模型与基础 API (Week 1-2)
- ✅ Phase 2: 核心逻辑增强 (Week 3-4)
- ✅ Phase 3: 看板 UI 增强 (Week 5-6)
- ✅ Phase 4: 跨仓库依赖编排 (Week 7-8)
- ✅ Phase 5: 高级特性 (Week 9+)

### AC8: 兼容性保证说明
- ✅ 单仓库场景：`codebaseIds.length === 1` 时行为不变
- ✅ 渐进启用：通过 `workspace.metadata` 特性开关控制

### AC9: 风险缓解措施和测试策略
- ✅ 风险识别与缓解：数据迁移、UI复杂度、性能、Desktop同步
- ✅ 测试策略：单元测试、集成测试、E2E测试

## 关键文件清单

| 文件 | 改动类型 | 优先级 |
|------|----------|--------|
| `src/core/db/schema.ts` | 扩展 | P0 |
| `src/core/models/task.ts` | 扩展 | P0 |
| `src/core/models/kanban.ts` | 扩展 | P0 |
| `src/core/kanban/task-worktree-truth.ts` | 修改 | P0 |
| `src/core/kanban/board-branch-rules.ts` | 修改 | P0 |
| `src/core/kanban/workflow-orchestrator.ts` | 修改 | P0 |
| `src/core/kanban/multi-repo-pr-coordinator.ts` | 新增 | P0 |
| `src/app/workspace/[workspaceId]/kanban/kanban-codebase-filter.tsx` | 新增 | P1 |
| `src/app/workspace/[workspaceId]/kanban/components/kanban-multi-repo-prs.tsx` | 新增 | P1 |

## 数据库迁移

```sql
-- Phase 1: 扩展 tasks 表
ALTER TABLE "tasks"
  ADD COLUMN "worktrees_by_codebase" JSONB DEFAULT '{}',
  ADD COLUMN "pull_requests" JSONB DEFAULT '[]',
  ADD COLUMN "repository_dependencies" JSONB DEFAULT '[]';
```

## 验证结论

所有9个验收标准均已满足。方案文档完整、可执行，可作为后续开发任务分解的依据。

**下一步行动**：将此方案分解为具体的开发任务卡片，按5个阶段逐步实施。
