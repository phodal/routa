# SQLite Session History Maintenance

Routa 本地 SQLite 长时间运行后，ACP 会话历史可能同时占用：

- `session_messages`：按事件追加的会话消息表。
- `acp_sessions.message_history`：兼容旧读取路径的 JSON 历史列。
- `routa.db-wal`：SQLite WAL 文件。

维护入口：

```bash
npm run db:sqlite:compact-sessions -- --db ./routa.db --dry-run --json
npm run db:sqlite:compact-sessions -- --db ./routa.db --apply --checkpoint
```

如需在确认服务已停止后回收更多磁盘空间：

```bash
npm run db:sqlite:compact-sessions -- --db ./routa.db --apply --checkpoint --vacuum
```

行为边界：

- 默认 `dry-run`，只报告候选 session、可合并 chunk 和可删除行数。
- `--apply` 才会写入数据库。
- 默认保护 60 分钟内更新过的 session，也保护 `lease_expires_at` 尚未过期的 session。
- 可以用 `--active-session <id>` 显式保护正在运行的 session。
- 只合并连续的 `agent_message_chunk` 为 `agent_message`。
- 不删除 artifact、task completion summary、verification report 或业务对象。
- compaction 不更新 `acp_sessions.updated_at`，避免维护操作污染会话活跃时间线。
- `--checkpoint` 会执行 `PRAGMA wal_checkpoint(TRUNCATE)`。
- `--vacuum` 会执行 `VACUUM`，建议只在 Routa 服务停止后使用，避免 Windows SQLite 文件锁问题。
