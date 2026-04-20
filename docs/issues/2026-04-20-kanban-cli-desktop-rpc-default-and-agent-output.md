---
title: "Kanban CLI should default to Desktop RPC and expose agent-friendly output"
date: "2026-04-20"
kind: issue
status: resolved
severity: medium
area: "cli"
tags: ["kanban", "cli", "desktop", "rpc", "ai", "output"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-18-kanban-rust-core-cli-parity.md"
  - "https://github.com/phodal/routa/issues/492"
github_issue: 503
github_state: closed
github_url: "https://github.com/phodal/routa/issues/503"
---

# Kanban CLI 默认应该命中 Desktop RPC，并返回更适合 agent 的结果

## What Happened

在 Desktop 已运行且本地服务监听 `http://127.0.0.1:3210` 的情况下，agent 通过 `routa kanban ...` 调用 Kanban CLI 时，实际命中了当前工作目录下的 `routa.db`，而不是 Desktop 正在使用的数据库。

结果表现为：

- `routa kanban board list --workspace-id default` 返回的是 cwd 数据库里的 board，而不是 Desktop 看板里的 board
- agent 根据这个 board id 创建 card 后，Rust Desktop 看板页面没有显示该 card
- `routa kanban status --workspace-id default` 默认输出完整 JSON-RPC envelope，包含 `jsonrpc/id/result`，对 agent 来说需要额外剥 transport 包装
- 即便 CLI 和 Desktop 指向同一个数据库，CLI 进程内的 in-memory event bus 也不会让已运行的 Desktop 进程实时收到更新事件

## Expected Behavior

Kanban CLI 在 Desktop/local server 运行时，应优先复用 `http://127.0.0.1:3210/api/rpc` 这条已存在的服务面，而不是默认新开一个独立的本地状态视角。

默认交互应该是：

- `routa kanban ...` 优先命中 `127.0.0.1:3210`
- 只有本地服务不可达时，才显式告警并回退到本地 DB
- 默认输出面向 CLI / agent 的文本摘要，而不是原始 JSON-RPC envelope
- `--json` 时只输出 `result` payload，避免让调用方再手动剥 transport 层

## Reproduction Context

- Environment: desktop + cli
- Trigger:
  1. 启动 Routa Desktop，确认本地服务运行在 `http://127.0.0.1:3210`
  2. 打开 Desktop 看板页面 `http://localhost:3210/workspace/default/kanban?boardId=af4302cd-e0db-4f81-823d-ebbab8a25e31`
  3. 在 repo cwd 直接执行 `routa kanban board list --workspace-id default`
  4. 返回的 board id 与 Desktop 页面中的 board id 不一致
  5. 用 bare CLI 创建 card 后，Desktop 看板中没有出现这张卡

## Why This Might Happen

- CLI 顶层 `--db` 默认值仍然是当前目录下的 `routa.db`，没有针对 Kanban/Desktop surface 做默认 transport 选择
- `routa kanban` 目前直接把 JSON-RPC 请求发给进程内 `RpcRouter`，没有优先复用桌面服务的 `/api/rpc`
- CLI 输出层仍然暴露 transport envelope，而不是定义更稳定的 CLI-level contract
- Desktop 的实时刷新依赖服务进程内的事件分发；CLI 单独起 `AppState` 时，这个事件不会传播给已运行的 Desktop 进程

## Relevant Files

- `crates/routa-cli/src/main.rs`
- `crates/routa-cli/src/kanban_cli.rs`
- `crates/routa-cli/src/commands/kanban.rs`
- `crates/routa-core/src/rpc/methods/kanban/shared.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `crates/routa-server/src/api/rpc.rs`

## Observations

- bare CLI 默认 board id 与 Desktop board id 不同，说明命中了不同的 SQLite 数据源
- Desktop DB 中默认 workspace `default` 对应的 board id 是 `af4302cd-e0db-4f81-823d-ebbab8a25e31`
- agent 截图里的 CLI 流程会先 `board list`，再把 board id 手动拼到 `card create`，所以默认 transport 和默认输出会直接影响 agent 成功率

## References

- https://github.com/phodal/routa/issues/492
- https://github.com/phodal/routa/issues/503

## Resolution

已通过以下提交落地：

- `e6fa02be` `fix(cli): default kanban commands to desktop rpc (#503)`
- `2410a88d` `fix(core): make kanban default-board switching atomic (#503)`
- `3584c735` `docs(cli): clarify kanban default board behavior (#503)`

实际验证结果：

- `routa kanban ...` 默认优先命中 `http://127.0.0.1:3210/api/rpc`
- 当本地服务不可达时，CLI 会显式 warning 并回退到本地 DB
- `board list`、`status`、`card list/search/create/delete` 默认输出为 CLI/agent 友好的文本摘要
- `--json` 保留纯 `result` 输出，不再暴露 JSON-RPC envelope
- `card create-issue`、`automation list/trigger`、`sync github`、`status` 这些 #492 关注的工作流命令在当前 CLI surface 上均已可用
- 在 live Desktop surface 上完成了默认 board 切换、card create、card delete、页面可见性与回收验证
- 通过 CLI 创建的 card 已验证会在 Kanban UI 中无手动刷新实时出现，删除后也会无手动刷新实时消失
- CLI help 已补充说明 `card create` 默认落到 workspace 默认 board 和 `backlog` 列，降低 agent 对先 `board list` 的依赖

剩余非阻断项：

- 当前 workspace 里仍然保留了历史测试 board；仓库里还没有一条正式的 board cleanup / delete path
