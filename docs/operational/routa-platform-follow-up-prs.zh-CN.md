# Routa 平台后续拆分 PR 记录

本文件记录 PR1（Kanban Agent Artifact Tools）之外的后续平台缺口。它们和 PR1 同属“让 Routa 更稳定承接项目迭代”的方向，但不应混入同一个实现分支。

本文件基于当前 Routa 代码现状修订：

- Kanban 已有列级 `automation` 配置，不是完全没有 transition gate。
- `update_card` 本身不是最大风险面，真正需要治理的是 agent 可写任务/卡片字段边界。
- Session history 已经有 `session_messages` 和 `HistoryCompactor` 雏形，后续应接线与加固，而不是从零设计。

## PR2: MCP Agent Write Boundary / Task Metadata Protection

问题：Kanban agent 通过 MCP 写卡片和任务时，缺少清晰的 profile / role 级字段写入边界。`update_card` 当前主要更新 `title`、`description`、`comment`、`priority`、`labels`；更大的风险面在 `update_task` / task API，它可以更新 `status`、`columnId`、`dependencies`、`completionSummary`、`verificationVerdict`、`assignedProvider`、`assignedRole`、`assignedSpecialistId` 等流程或运行时字段。后续 AI 可能绕过 lane gate，造成卡片语义、流程状态或验收结论失真。

当前现状：

- `update_card` 是偏卡片展示/正文的工具。
- `move_card` 是 lane 迁移的明确工具。
- `update_task` 是宽字段任务更新工具，适合系统内部和受控场景，但不适合所有普通 Kanban agent 无差别使用。
- `kanban-planning` profile 需要能写方案正文和 canonical story，但不应直接改流程状态。

建议边界：

- 按 MCP profile / specialist role 定义任务字段写入白名单。
- 普通 planning / product / architecture agent 可写：`objective`、`scope`、`acceptanceCriteria`、`verificationCommands`、`testCases`、必要的 `contextSearchSpec`。
- 执行 / QA agent 可写：`completionSummary`、`verificationReport`、必要的 evidence artifact；是否可写 `verificationVerdict` 需要单独受 gate 或 reviewer profile 控制。
- lane/status 迁移统一走 `move_card`，不要通过 `update_task.status` 或 `update_task.columnId` 绕过 transition gate。
- `dependencies`、`releaseLabel`、approval、owner verdict、assigned runtime/provider/specialist 等流程元数据应只允许系统 orchestrator、human owner/admin 或专门高权限工具修改。
- 保持 API 兼容：不删除现有字段，但 MCP 普通 profile 不应暴露或不应允许写入高风险字段。

验收：

- `kanban-planning` agent 不能通过 `update_task` 修改 `status` / `columnId` 绕过 `move_card`。
- 普通 agent 不能覆盖 owner / approval / release / dependency 等关键流程元数据。
- Product / Architecture agent 仍能正常写入 story 字段和 canonical YAML。
- Execution / QA agent 仍能写入 completion / verification / artifact 证据。
- 系统内部 orchestrator、人类 owner/admin、专门工具仍保留必要高权限路径。
- TS MCP tests 覆盖 profile 字段白名单；Rust MCP parity 如暴露同类工具，也必须覆盖同样约束。

## PR3: Wire and Harden Existing Session Compaction

问题：本地 SQLite 长期运行时，ACP session history 会同时写入 `acp_sessions.message_history` 和 `session_messages`。当前已有 `session_messages` 表和 `HistoryCompactor` 雏形，但它没有形成清晰的运维入口、dry-run、活跃 session 保护和 SQLite 维护流程。结果是长时间 Mode B 运行后，`routa.db` / WAL 仍可能膨胀，并且后续人工清理风险较高。

当前现状：

- `session_messages` 已经存在，用于按事件追加 session history。
- `acp_sessions.message_history` 仍保留 JSON 历史，形成兼容和回退路径。
- `HistoryCompactor` 已存在，尝试合并旧 `agent_message_chunk` 并清理旧 trace。
- 现有 compactor 测试较薄，且没有明确接入 CLI/API/维护命令。

建议边界：

- 不从零设计 compaction，优先把现有 `HistoryCompactor` 接入受控维护入口。
- 增加 dry-run：输出候选 session 数、候选消息数、预计删除/合并数量、预计影响范围。
- 增加 apply：只处理非活跃 session，保留 final response、tool call/result 摘要、artifact、completion/verification 相关证据。
- 明确 `session_messages` 与 `acp_sessions.message_history` 的一致性策略：压缩后不能出现 UI 读旧 JSON 仍膨胀、而新表已压缩的双轨不一致。
- SQLite 维护命令应考虑 WAL checkpoint / VACUUM，但必须避免服务运行中锁库；优先维护模式或显式停止服务后执行。
- 不处理 workspace/project 业务数据，不清 artifact，不清 task completion summary，不清 verification report。

验收：

- 构造包含大量 streaming chunk 的旧 session，dry-run 能报告候选数量但不修改数据。
- apply 后重复 chunk 被合并或裁剪，`session_messages` 记录数下降。
- `acp_sessions.message_history` 不继续保留同等体量的重复 delta，或有明确兼容策略说明。
- final response / transcript readout / artifact / task evidence 仍可读。
- 活跃 session 不被处理。
- Windows SQLite 下不会因 WAL / 文件锁导致维护失败或破坏数据库。

## PR4: Extend Existing Kanban Transition Gates

问题：Routa 已经有列级 `KanbanColumnAutomation` gate，但能力仍是分散的、部分前后端不对齐的。当前已有 `requiredArtifacts`、`requiredTaskFields`，TS 侧还有 `contractRules`、`deliveryRules`，`move_card` 已经会阻断部分不满足条件的迁移。后续需要扩展为更完整的通用 gate 能力，但不能新造一套与现有 `automation` 并行的 workflow gate。

当前现状：

- TS model 已支持 `requiredArtifacts`、`requiredTaskFields`、`contractRules`、`deliveryRules`。
- Rust model 目前主要支持 `required_artifacts`、`required_task_fields`，需要补 parity。
- Kanban settings UI 已支持配置 trigger、required artifacts、required task fields。
- `move_card` / task status API 已经有部分 gate 检查。

建议边界：

- 在现有 `KanbanColumnAutomation` 上增量扩展，保持旧 board 配置兼容。
- 补齐 TS / Rust parity，避免 Web 与 Rust/Axum 后端 gate 语义不一致。
- 新增 gate 字段建议：
  - `requiredChecklist`
  - `requiredHumanApproval`
  - `validatorCommand`
  - `mode: blocking | warning`
- `blocking` gate 阻断 lane transition；`warning` gate 允许迁移但必须记录可见 warning / artifact / audit note。
- `move_card`、task status/column update API、MCP `move_card` 必须走同一套 gate 检查。
- UI 只做现有 Kanban settings 的最小扩展，不做完整 workflow designer。
- QuantDinger 的 `8891 -> 8888` 发布前回归门控只能作为 workspace board 配置或示例，不进入 Routa core 的通用产品语义。

验收：

- 旧 board 的 `requiredArtifacts` / `requiredTaskFields` 配置继续有效。
- TS 和 Rust 后端对同一个 board 配置给出一致的 transition 结果。
- 缺 blocking artifact / checklist / human approval 时，lane transition 被阻断并返回可读原因。
- warning gate 不阻断迁移，但在卡片或事件中留下可见 warning。
- validator command 失败时按 `mode` 决定阻断或警告。
- Kanban settings 能配置最小 gate 字段；agent prompt 能读到缺口并指导补证据。
- 不包含任何 QuantDinger 专有端口、环境或发布文案。
