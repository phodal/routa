---
title: "Harness monitor 无法从 Codex hooks 把真实用户 task 串到 session 与 file changes"
date: "2026-04-12"
kind: issue
status: resolved
resolved_at: "2026-04-13"
severity: medium
area: "harness-monitor"
tags: ["harness-monitor", "codex-hooks", "task-tracking", "session-attribution", "tui"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-12-harness-monitor-semantic-refactor-for-run-centric-operator-model.md"
github_issue: 413
github_state: closed
github_url: "https://github.com/phodal/routa/issues/413"
resolution: "Codex hook ingestion now materializes first-class tasks and session/turn links in SQLite, and task list/show paths read those task entities instead of treating session as task."
---

# Harness monitor 无法从 Codex hooks 把真实用户 task 串到 session 与 file changes

## What Happened

这张 issue 记录的是 2026-04-12 当时的缺口；截至 2026-04-13，这条链路已经补齐。

`crates/harness-monitor` 目前能跟踪：

- `session_id`
- `turn_id`
- `cwd`
- `transcript_path`
- file events
- dirty file ownership / confidence

但 `task list/show` 仍然只是把 active session 当作 task 展示，尚未把用户提交给 Codex 的真实任务建立为一等对象。

这导致：

- Session 可以被观测，但不知道它在执行哪个用户 task
- File change 可以归属到 session，却不能稳定归属到 task
- TUI/CLI 能看到 run/file/operator 状态，却无法完整表达一条 task journey

## Expected Behavior

Harness monitor 应该把 Codex hooks 中的 task 信号串成一条稳定链路：

- `SessionStart` 负责建立 session 身份与 transcript/workspace 锚点
- `UserPromptSubmit` 负责建立或更新真实用户 task
- `turn_id` 负责把 task 与后续本轮活动关联起来
- file events / dirty files / run assessment / TUI details 都可以回溯到同一个 task

最终用户在 UI 上应能看到一条连贯旅程：

- 用户 task
- 关联 session / run
- 关联 turn
- 关联 file changes
- 关联 eval / evidence / handoff

## Reproduction Context

- Environment: both
- Trigger: 使用 Codex hooks 驱动 `harness-monitor`，然后查看 `task list/show`、run 详情和 file attribution

## Why This Might Happen

- `SessionStart` hook 本身不包含用户 prompt，只能建立会话级锚点
- `UserPromptSubmit` 虽然包含 `prompt` 和 `turn_id`，但当前 ingestion 只把 payload 存进 turns，没有抽取成 task
- 现有 SQLite schema 没有真实 task 主表和 session/turn/task 映射表
- 当前 UI 和 CLI 仍沿用“session ≈ task”的过渡性表达

## Relevant Files

- `crates/harness-monitor/src/observe/hooks.rs`
- `crates/harness-monitor/src/shared/db.rs`
- `crates/harness-monitor/src/shared/models.rs`
- `crates/harness-monitor/src/main.rs`
- `crates/harness-monitor/src/run/task.rs`
- `crates/harness-monitor/src/run/run.rs`
- `crates/harness-monitor/src/ui/state_events.rs`
- `crates/harness-monitor/src/ui/views.rs`
- `crates/harness-monitor/src/ui/panels.rs`
- `crates/harness-monitor/src/run/orchestrator.rs`

## Observations

- Codex `SessionStart` schema只有 `session_id` / `cwd` / `transcript_path` / `source` / `model`，不包含 prompt。
- Codex `UserPromptSubmit` schema 明确包含 `prompt` 与 `turn_id`，它才是当前最可靠的 task 事实源。
- 本地 `~/.codex/sessions/*.jsonl` 提供了 transcript 回填路径，可作为 hook 缺失或 resume 场景下的补偿数据源。

## Resolution Notes

- SQLite schema 现在已有 `tasks`、`session_task_links`、`turn_task_links`。
- `UserPromptSubmit` 与 transcript recovery 都会落真实 task，并建立 session/turn 到 task 的映射。
- `list_tasks`、`get_task`、`active_task_for_session` 现在都以 task 作为一等对象读取。
- 剩余未完成部分更偏向 task journey / decision summary 的 UI 收敛，已由其他 open issue 跟踪。

## References

- https://developers.openai.com/codex/hooks
- `/Users/phodal/ai/codex/codex-rs/hooks/schema/generated/session-start.command.input.schema.json`
- `/Users/phodal/ai/codex/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json`
- `/Users/phodal/.codex/sessions/`
