---
dimension: testability
weight: 20
tier: normal
threshold:
  pass: 80
  warn: 70
  block: 0  # 测试失败直接阻断

metrics:
  - name: ts_test_pass
    command: npm run test:run:fast 2>&1
    pattern: "Tests\\s+(\\d+)\\s+passed"
    hard_gate: true
    tier: fast

  - name: ts_test_pass_full
    command: npm run test:run 2>&1
    pattern: "Tests\\s+(\\d+)\\s+passed"
    hard_gate: true
    tier: normal

  - name: ts_test_coverage
    command: npm run test:cov:ts 2>&1
    tier: normal
    description: "Vitest V8 line coverage must stay at or above 80%."

  - name: rust_test_pass
    command: cargo test --workspace --exclude routa-desktop 2>&1
    pattern: "test result: ok"
    serial: true
    hard_gate: true
    tier: normal

  - name: graph_test_radius_probe
    command: entrix graph test-radius --json
    tier: normal
    execution_scope: ci
    gate: advisory
    kind: holistic
    analysis: static
    evidence_type: probe
    scope: [web, rust]
    run_when_changed:
      - src/**
      - apps/**
      - crates/**
    description: "通过代码图估算 changed targets 的测试半径；图后端缺失时跳过不计分"

  - name: graph_test_mapping_probe
    command: entrix graph test-mapping --no-graph --json
    tier: normal
    execution_scope: local
    gate: advisory
    kind: holistic
    analysis: static
    evidence_type: probe
    scope: [web, rust, java]
    run_when_changed:
      - src/**
      - apps/**
      - crates/**
    description: "检查 changed source file 是否存在对应测试映射；TS/JS/Java 走路径规则，Rust 允许 inline test 或弱断言 unknown"
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
  - status: `VERIFIED`
  - required: 任务归属、状态持久化、DB → local JSONL fallback、session transcript/history hydration
  - evidence: `src/core/__tests__/session-history.test.ts`, `src/client/components/chat-panel/hooks/__tests__/use-chat-messages.test.tsx`, `src/app/api/acp/__tests__/route.test.ts`, `src/app/api/sessions/[sessionId]/history/__tests__/route.test.ts`
- [ ] workflow/规则映射层
  - status: `TODO`
  - required: 列表/状态转换边界、冲突校验（如同 ID/非法状态）
  - evidence:

### 单元测试（`routa-server`）
- [ ] error contract helpers
  - status: `TODO`
  - required: 错误分类与状态码映射一致性
  - evidence:
- [x] application/use-case: tasks
  - status: `VERIFIED`
  - required: task 创建默认值推导、标签清洗、状态/列一致性校验、retry trigger 行为
  - evidence: `crates/routa-server/src/application/tasks.rs`
- [x] application/use-case: sessions
  - status: `VERIFIED`
  - required: 内存/数据库 session 合并、workspace/parent 过滤、context 构建、history fallback 与缓存
  - evidence: `crates/routa-server/src/application/sessions.rs`
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

## Session Persistence / Recovery Characterization

- `src/core/__tests__/session-history.test.ts`
  - 锁定 session history 在 in-memory session metadata 缺失时，仍会使用本地 session 记录里的 `cwd` 去读取 DB / JSONL 历史。
- `src/client/components/chat-panel/hooks/__tests__/use-chat-messages.test.tsx`
  - 锁定 active session 首屏 transcript hydration 的重试行为，避免 live pane 因首轮空历史而停在空白态。
- `src/app/api/acp/__tests__/route.test.ts`
  - 锁定 `session/prompt` 在内存 store 丢失 session 时，仍能用本地持久化 metadata 重建 session。
- `src/app/api/sessions/[sessionId]/history/__tests__/route.test.ts`
  - 锁定 `/api/sessions/:id/history` 的 API fallback，确保 session metadata 与历史读取链路一致。
