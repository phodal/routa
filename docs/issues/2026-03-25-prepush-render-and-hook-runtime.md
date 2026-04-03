---
title: Pre-push Hook Output Is Buffered, Opaque, and Hard to Extend
date: "2026-03-25"
status: resolved
resolved_at: "2026-03-26"
severity: medium
area: dx
tags: [git-hooks, pre-push, entrix, renderer, scripts]
reported_by: Codex

resolution:
  - "status updated to resolved based on follow-up changes completed on 2026-03-26."
---

## What Happened

`git push` currently enters the `pre-push` hook and prints a single start line before
running local fitness checks through `entrix`. When lint, typecheck, or tests take time,
the terminal often appears stalled. On failure, users only receive a compact tail of the
captured output plus an interactive fix prompt.

## Why It Matters

- The current experience makes normal test latency look like a hung hook.
- Buffered output hides which metric is active and whether progress is being made.
- Failure summaries are compact but lose useful context when a command emits longer logs.
- Hook orchestration is spread across shell scripts, which makes it harder to evolve into a
  richer renderer, better progress UI, or reusable package-level tooling.
- `scripts/` is already crowded, so more hook logic in ad-hoc shell scripts increases
  discoverability and maintenance cost.

## Evidence

- `.husky/pre-push`
- `scripts/smart-check.sh`
- `tools/entrix/entrix/runners/shell.py`

## Desired Outcome

Pre-push checks should expose active phases and live progress clearly, preserve enough
failure context to diagnose issues quickly, and move toward a reusable hook runtime that
can be extended without adding more one-off shell scripts.

## Design direction (proposed)

Hook Runtime should be positioned as a **Local Fitness Gate Runtime**:

- Trigger layer: Husky / Git hooks only trigger execution.
- Runtime layer: `tools/hook-runtime` manages phase orchestration, metric parallelism,
  rendering, failure routing, and review handoff.
- Policy layer: Entrix defines the actual fitness/review rules.

This keeps hook behavior reusable across contexts (pre-push today, pre-commit and other local
entry points later), and prevents policy logic from being hardcoded in hook scripts.

## Concrete design constraints

- Keep hook scripts thin: only call the runtime command.
- Runtime should support machine-readable output (`jsonl`) for agent/CI consumers.
- Runtime should preserve failure context with output tails and summary metadata.
- Runtime should make phase behavior explicit (`submodule`, `fitness`, `review`) with clear
  routing semantics.
- Runtime should be evolvable into a package-style foundation for future non-hook callers
  (local CLI/task runner / IDE action).

## Alignment with `tools/hook-runtime/README.md`

- `hooks` entrypoint and phase model now documented in a dedicated README.
- `pre-push` flow defined as the current baseline behavior.
- Failure routing and review handoff are explicitly documented as runtime responsibilities.

## Follow-up done (2026-03-26)

针对你提的 4 点，已经对显示面做了收敛优化：

- 子模块检查：减少逐条 `Checking/OK` 日志，改为阶段汇总；只在失败时输出失败路径。
- phase 显示：补齐 `phase 3/3`（review checks），`dry-run` 下也会显示 skipped 语义。
- 失败日志：在失败摘要里加入 metric 命令、持续时间，并优先抽取 error/fail/fatal 等失败线索，去除长尾噪音。
- 难以定位问题：失败时直接给出 `- <metric>` 的命令与关键上下文，便于一眼知道挂在哪个检查点。

### Follow-up fix on same day

补充记录一个被你抓到的阻塞根因：Rust 测试模块 `crates/routa-core/src/workflow/specialist.rs` 中
`ROUTA_SPECIALISTS_RESOURCE_DIR` 是进程级环境变量，原先测试并行时会互相覆盖，导致
`test_load_default_dirs_reads_tauri_resource_specialists` 在某些执行顺序下偶发失效，进而影响 pre-push 的
`rust_test` 结果稳定性。

已修复方式：

- 在测试内新增 `with_specialists_resource_dir(...)` 作用域辅助，串行化该 env 变量相关测试；
- 使用 `EnvVarGuard` 在作用域结束自动恢复 env 原值；
- 替代手工 `set_var/remove_var`，避免并发路径下污染全局环境。

后续观察点：

- 重点关注 `pre-push` 上 `rust_test_pass` 的波动性。
