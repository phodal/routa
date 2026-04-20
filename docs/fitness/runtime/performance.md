---
dimension: performance
weight: 0
threshold:
  pass: 80
  warn: 70
metrics:
  - name: web_route_performance_smoke
    command: npm run test:performance 2>&1
    pattern: "✅"
    tier: deep
    execution_scope: ci
    gate: advisory
    kind: holistic
    analysis: dynamic
    stability: noisy
    evidence_type: test
    scope: [web]
    run_when_changed:
      - src/app/**
      - src/client/**
      - src/app/styles/**
      - e2e/**
      - scripts/fitness/check-performance-smoke.mjs
      - scripts/page-snapshot-lib.mjs
    description: "关键 workspace / kanban / traces / session detail 路由的导航、FCP、CSS 体积与 long task smoke"

  - name: startup_performance_probe
    command: npm run test:performance:startup -- --json 2>&1
    pattern: '"summaryStatus":\s*"(pass|skipped)"'
    tier: normal
    execution_scope: local
    gate: advisory
    kind: holistic
    analysis: dynamic
    stability: noisy
    evidence_type: command
    scope: [desktop, acp, runtime]
    run_when_changed:
      - crates/routa-server/**
      - crates/routa-core/src/acp/**
      - apps/desktop/src-tauri/src/lib.rs
      - scripts/fitness/check-startup-performance.mjs
      - docs/fitness/runtime/performance.md
    description: "记录 Routa service 与 ACP provider 的本地启动延迟基线，作为 advisory startup evidence。"

  - name: sqlite_wal_mode_guard
    command: rg -q 'journal_mode = WAL' src/core/db/sqlite.ts && echo 'sqlite_wal_mode_ok'
    pattern: "sqlite_wal_mode_ok"
    tier: normal
    execution_scope: ci
    gate: soft
    kind: atomic
    analysis: static
    evidence_type: command
    scope: [web]
    run_when_changed:
      - src/core/db/sqlite.ts
    description: "本地 Node/SQLite 后端继续启用 WAL，避免回退到较差的并发读性能"
---

# Performance Runtime Evidence

这份文件只负责运行时性能证据，不承担 design system 或一般静态代码质量的职责。

## 当前覆盖

- `web_route_performance_smoke`
  - 命令：`npm run test:performance`
  - 环境：`ci`
  - 语义：`advisory`，失败会暴露回退，但不会替代发布前的真实产线或 staging 预算
- `startup_performance_probe`
  - 命令：`npm run test:performance:startup -- --json`
  - 环境：`local`
  - 语义：`advisory`，记录 `service_startup_ms` 与 provider startup baseline，不进入默认 CI gate
  - 当前覆盖：`service_startup_ms`、ACP provider 的 `initialize + session/new`，以及 Claude 的 startup stability
- `sqlite_wal_mode_guard`
  - 命令：静态检查 `src/core/db/sqlite.ts` 是否继续启用 `journal_mode = WAL`
  - 环境：`ci`
  - 语义：`soft`

## 边界

- 这里的 smoke 用于发现明显性能回退，不声明自己是 production latency 的事实来源。
- `performance` 与 `observability` 分离：有 tracing 或错误信号，不等于性能达标。
- `startup_performance_probe` 当前仍有 protocol gap：Claude 还没有与 ACP-native provider 完全对齐的 ready 定义，因此它的 startup 数字只能作为趋势参考，不能直接和 `opencode`、`qoder`、`codex-acp` 横向比较。

## Tracked Gaps

- `task_api_latency_probe` is intentionally not implemented yet. The need is tracked in
  `docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md`: Next.js task list serialization can
  monopolize the local dev server and make neighboring task-detail or task-changes requests look slow.
  Add an API-level latency/payload probe after the task list API is split into lean-list and detail
  hydration paths.
