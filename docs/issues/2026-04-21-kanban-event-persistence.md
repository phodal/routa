# 为 Kanban 建立可持久化的流动事件模型

- **kind**: progress_note
- **created**: 2026-04-21
- **workspaceId**: e3569255-cb47-48c6-97f7-89bf4e52da06
- **boardId**: bc908c24-a080-4227-88a1-0193ccddc90d
- **status**: backlog
- **issue**: 本地卡片无法通过 MCP 访问，创建为本地追踪

## 背景

当前事件系统（`crates/routa-server/src/api/kanban.rs` 中 `kanban_events` 函数）依赖内存 `EventBus`，所有事件只存在于当前进程生命周期内。

关键文件已分析：
- `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs` — Agent 事件订阅/取消订阅
- `crates/routa-server/src/api/kanban.rs` — SSE 端点和事件转发（第 454-498 行）
- `src/app/api/kanban/events/route.ts` — Next.js SSE 端点
- `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs` — 会话状态管理

## 问题

1. 事件仅在内存 EventBus 中，WebSocket 断开后丢失
2. 服务重启后 EventBus 状态完全丢失
3. 前端重连无法同步最近变更

## 建议 Story

```yaml
story:
  version: 1
  language: zh-CN
  title: 实现 Kanban 事件持久化模型与流式广播
  problem_statement: |
    当前事件系统依赖内存 EventBus，所有事件只存在于当前进程生命周期内。
    客户端断开 SSE 连接后无法恢复状态，服务重启后事件完全丢失。
  user_value: |
    前端在重连后能立即获取最近的 Kanban 事件，无需等待下一次变更触发器。
    后端重启时事件总线状态完整保留。
  acceptance_criteria:
    - id: AC1
      text: 事件写入持久化存储（SQLite DB 中的 kanban_events 表）
      testable: true
    - id: AC2
      text: GET /api/kanban/events 支持 workspaceId 参数，过滤该 workspace 的最近 N 条事件并以 SSE 格式返回
      testable: true
    - id: AC3
      text: 前端 SSE 重连后能收到最近一条 kanban:changed 事件
      testable: true
    - id: AC4
      text: 服务端重启后 EventBus 重新订阅能从 DB 恢复并广播历史事件
      testable: true
  constraints_and_affected_areas:
    - crates/routa-server/src/api/kanban.rs
    - crates/routa-server/src/state.rs
    - crates/routa-server/src/db/
    - src/app/api/kanban/events/route.ts
    - src/core/kanban/kanban-event-broadcaster.ts
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: none
  out_of_scope:
    - 修改 ACP Session 事件持久化模型
    - 实现事件的完整 replay API
  invest:
    independent:
      status: pass
      reason: 不依赖其他卡片，可独立实施
    negotiable:
      status: pass
      reason: scope 边界清晰
    valuable:
      status: pass
      reason: 解决前端重连后状态丢失的核心痛点
    estimable:
      status: pass
      reason: scope 明确，4 个 AC 覆盖核心路径
    small:
      status: warning
      reason: 需要新建 DB schema
    testable:
      status: pass
      reason: 每个 AC 均可验证
```

## 行动项

- [ ] 等待 Kanban MCP board 可用后，将上述 story 创建为卡片并移动到 `todo`
- [ ] 在 Rust 后端实现 `kanban_events` 表 schema
- [ ] 在 `kanban.rs` 中集成持久化写入
- [ ] 在 `kanban_events` SSE handler 中加载历史事件
- [ ] 前端 Playwright E2E 验证重连场景