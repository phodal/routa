---
dimension: testability
weight: 14
description: 单元测试与集成测试证据清单
commands:
  - cargo test --workspace
  - npm run test:run
---

# 单元测试与集成测试证据

> 本文件记录测试条目的验证状态，作为 testability 维度的证据来源。

## 适用范围
- `routa-core`, `routa-server` 为本版主线；`routa-cli`, `routa-rpc` 在联动改动时同步纳入。

## 评估目标
- 用例以“行为正确性”计分，不以文件字数或命令日志计分。
- 每条规则有固定状态，禁止快照式增量字段（`delta` / `phase` / `current`）作为进度依据。

## 规则清单（逐项可验）

### 单元测试（`routa-core`）
- [ ] store: workspace
  - status: `TODO`
  - required: CRUD、查询过滤、归档状态一致性
  - evidence:
- [ ] store: codebase
  - status: `TODO`
  - required: 唯一性、默认配置、文件索引兼容性
  - evidence:
- [ ] store: task
  - status: `TODO`
  - required: 状态流转、列映射、并发冲突边界
  - evidence:
- [ ] store: agent
  - status: `TODO`
  - required: 创建/状态更新/不可变字段保护
  - evidence:
- [ ] store: session
  - status: `TODO`
  - required: 任务归属、状态持久化、过期清理策略
  - evidence:
- [ ] workflow/规则映射层
  - status: `TODO`
  - required: 列表/状态转换边界、冲突校验（如同 ID/非法状态）
  - evidence:

### 单元测试（`routa-server`）
- [ ] error contract helpers
  - status: `TODO`
  - required: 错误分类与状态码映射一致性
  - evidence:
- [ ] 参数校验器 / 清洗函数
  - status: `TODO`
  - required: 空值、非法类型、越界输入
  - evidence:
- [x] 轻量 handler-level 辅助逻辑
  - status: `VERIFIED`
  - required: 会话历史 chunk 合并逻辑正确性
  - evidence: `crates/routa-server/src/api/sessions.rs`

### 集成测试（与 API 行为强绑定）
- [x] notes 流程
  - status: `VERIFIED`
  - required: create/list/get/delete 的成功/失败闭环
  - evidence: `docs/fitness/rust-api-test.md`
- [x] tasks 流程
  - status: `VERIFIED`
  - required: create/update/status/list/delete + 无效状态更新
  - evidence: `docs/fitness/rust-api-test.md`
- [x] codebase/files 流程
  - status: `VERIFIED`
  - required: create/update/delete/search + 文件元数据一致性
  - evidence: `docs/fitness/rust-api-test.md`
- [x] agents 流程
  - status: `VERIFIED`
  - required: list/get/create/delete + invalid status handling
  - evidence: `docs/fitness/rust-api-test.md`
- [x] sessions 流程
  - status: `VERIFIED`
  - required: get/list/polling + 生命周期错误场景
  - evidence: `docs/fitness/rust-api-test.md`

## 一致性要求
- 同一业务行为修改，必须在本文件添加 `status=VERIFIED` 条目并写明测试文件路径。
- 阻塞项统一标记为 `BLOCKED`，并写明阻塞原因与负责人。
- 删除/关闭的规则项后需保留审计历史（可在 issue 记录中补充）。

## 近期优先级
- P0: `acp` / `agents` / `sessions` / polling 的 API 行为测试补齐
- P1: `agent` 与 `session` 错误状态回归
- P2: `task` 与 `codebase` 关键边界场景复测

## Common Failures (High Frequency)

- 状态不一致：`task.status` 与 `columnId` 不匹配
  - 对应修正：统一入口校验，添加冲突用例并固定错误信息
- 外部依赖触发失败导致超时/抖动
  - 对应修正：测试时优先隔离外部依赖，避免真实网络请求影响核心路径
- DB 状态污染
  - 对应修正：每个测试独立数据库（临时 db_path）并确保销毁
- 文件系统副作用未清理
  - 对应修正：临时目录/文件在 `Drop` 或测试尾部清理
- 查询参数命名不一致（camelCase / snake_case）
  - 对应修正：接口文档与用例字段统一验证

## This Batch
- 新增：`crates/routa-server/tests/rust_api_end_to_end.rs`
- 入口文件：`docs/fitness/rust-api-test.md`
- 下一个批次：补 `acp / agents / sessions / polling` 用例与健康检查场景
