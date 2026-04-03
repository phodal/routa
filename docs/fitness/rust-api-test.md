---
dimension: api_contract
weight: 10
tier: normal
threshold:
  pass: 100
  warn: 90

metrics:
  - name: api_contract_parity
    command: npm run api:check 2>&1
    hard_gate: true
    tier: fast

  - name: rust_api_test
    command: cargo test -p routa-server --test rust_api_end_to_end 2>&1
    pattern: "test result: ok"
    hard_gate: false
    tier: normal
---

# API 契约测试证据

> 本文件记录 API 端点的测试状态，作为 maintainability 维度的证据来源。

## 规则目标
- API 回归检查必须按端点、方法、成功路径、负向路径、回归路径三层记录。
- 本文件更新遵循分层规则：
  - 先按 AGENTS.md 的工作原则与提交流程执行；
  - 再按 `docs/fitness/README.md` 对齐行为要求与评分前提；
  - 最后在本文件按 endpoint 级逐条登记并给出可执行证据。
- 任何新改动都先补齐本文件再提交，不允许只在 PR 描述写“已覆盖”。

## 端点矩阵（必须可执行）

状态标记：
- `VERIFIED`: 测试已存在且能稳定通过（给出文件路径）
- `BLOCKED`: 当前被阻塞（给出阻塞原因和 owner）
- `TODO`: 未开始/未补齐

| 模块 | 路由 | 场景 | 必需用例 | 状态 | 证据 |
|---|---|---|---|---|---|
| workspace | `GET /api/workspaces` | list | 默认工作区存在性与列表稳定返回 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| workspace | `POST /api/workspaces` | success | 创建成功 + 响应字段校验 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| workspace | `POST /api/workspaces` | invalid input | 空名/非法参数 400 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_contract_negative_filters` |
| workspace | `GET /api/workspaces/:id` | not found | 404 + 错误文本固定 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_contract_negative_filters` |
| workspace | `PATCH /api/workspaces/:id` | update | 标题更新与返回一致 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| workspace | `POST /api/workspaces/:id/archive` | archive | 归档后状态可读且明确 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| workspace | `DELETE /api/workspaces/:id` | delete | 删除后不可读 404 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| note | `GET /api/notes` | success chain | list/get/get-by-id 一致性 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| note | `POST /api/notes` | success | 创建成功路径 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| note | `POST /api/notes` | validation | 验证失败场景（待补） | TODO | `crates/routa-server/tests/rust_api_end_to_end.rs` |
| note | `DELETE /api/notes` | delete | 删除成功并清理引用 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| note | `GET /api/notes` | query by workspaceId/noteId | workspace 与 noteId 参数覆盖 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_workspace_and_note_flow` |
| task | `GET /api/tasks` | list/filter | 过滤参数与排序边界 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_task_flow_with_validation` |
| task | `POST /api/tasks/{id}/status` | state machine | 无效转移返回冲突/错误 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_task_flow_with_validation` |
| task | `GET /api/tasks/{id}` | get | 创建/更新后的持久可读性 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_task_flow_with_validation` |
| task | `PATCH/DELETE /api/tasks/{id}` | update/delete | PATCH 与 DELETE 行为一致 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_task_flow_with_validation` |
| task | `POST /api/tasks` | create | 创建成功与字段校验 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_task_flow_with_validation` |
| kanban | `POST /api/kanban/import` | import | YAML 导入成功并返回 applied 明细 | VERIFIED | `crates/routa-server/tests/rust_api_task_artifacts.rs::api_kanban_import_export_roundtrip` |
| kanban | `GET /api/kanban/export` | export + validation | YAML 导出成功；缺失 `workspaceId` 返回 400 | VERIFIED | `crates/routa-server/tests/rust_api_task_artifacts.rs::api_kanban_import_export_roundtrip` |
| codebase | `POST /api/workspaces/{workspaceId}/codebases` | create + duplicate handling | 冲突返回语义一致性 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_codebase_and_file_search_flow` |
| codebase | `GET /api/files/search` | search path | 空路径/非法路径/结果可见性 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_codebase_and_file_search_flow` |
| codebase | `PATCH /api/codebases/{id}` | update | 更新字段成功 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_codebase_and_file_search_flow` |
| codebase | `POST /api/codebases/{id}/default` | set default | 默认目标可读返回正确 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_codebase_and_file_search_flow` |
| codebase | `DELETE /api/codebases/{id}` | delete | 删除成功返回 ok | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_codebase_and_file_search_flow` |
| github | `GET /api/github/issues` | list workspace-linked issues | workspace/codebase 解析、400/404 负向路径、返回 issue 元数据 | BLOCKED | `env: 需要可控 GitHub API stub 或可注入 base URL 的 rust_api_end_to_end harness` |
| ACP | `POST /api/acp` | initialize | 初始化返回协议元信息 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| ACP | `POST /api/acp` | unknown method | method 不存在返回结构固定 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| agents | `POST /api/agents` | create/list/get | 成功创建与查询链路 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_agent_flow_with_validation` |
| agents | `POST /api/agents/{id}/status` | invalid status | 非法状态返回 400 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_agent_flow_with_validation` |
| agents | `DELETE /api/agents/{id}` | delete | 删除后获取返回 404 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_agent_flow_with_validation` |
| agents | `GET /api/agents` | query by workspaceId/status | 条件筛选与默认列表 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_agent_flow_with_validation` |
| agents | `GET /api/agents/:id` | get | by path/query 一致性 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_agent_flow_with_validation` |
| sessions | `GET /api/sessions/{id}` | state and lifecycle | 会话不存在/rename/disconnect/context 行为 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `GET /api/sessions` | list/filter | workspace + parent + limit 过滤 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `PATCH /api/sessions/{id}` | rename | 会话不存在返回 404 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `DELETE /api/sessions/{id}` | delete | 删除行为与幂等安全 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `GET /api/sessions/{id}/history` | history + consolidation | 空历史与合并参数行为 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `POST /api/sessions/{id}/disconnect` | lifecycle | 缺失会话返回 404 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| sessions | `GET /api/sessions/{id}/context` | context | 会话拓扑查询与缺失处理 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_session_contract_with_negative_paths` |
| health | `GET /api/health` | availability | 返回 schema + 可读状态码 | VERIFIED | `crates/routa-server/tests/rust_api_end_to_end.rs::api_health_contract` |

## 回归清单（强制）
- [ ] workspace-codebase-task 的跨端点链路回归（同一 workspace/task 上的前后状态关系）
- [ ] 会话状态查询在任务完成前后的一致性
- [ ] `agent` 相关删除/状态变更与会话挂钩回归

## 负向场景（至少一条/端点）
- 路径不存在（404）
- 非法请求体（400）
- 状态冲突（409）
- 参数越界/类型错误（422）
- 并发/重复请求（幂等性 or 冲突）

## 执行命令（固定）
- `cargo test -p routa-server --test rust_api_end_to_end`

## 关键阻塞记录
- 若环境缺失导致 e2e 无法执行，标为 `BLOCKED: env`
- 若测试文件可复现但超时波动，标为 `BLOCKED: infra` 并附重试命令

## 下一批次（示例）
- `POST /api/acp/install` / `DELETE /api/acp/install` 全链路
- `GET /api/agents/{id}` + `PATCH /api/sessions/{id}`
- `/api/sessions` 的 list/filter + polling 心跳回归
