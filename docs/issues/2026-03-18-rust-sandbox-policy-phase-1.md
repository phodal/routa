---
title: "[GitHub #180] Rust sandbox policy Phase 1 — workspace-aware policy resolution and Docker enforcement"
date: "2026-03-18"
status: resolved
severity: high
area: "backend"
tags: ["github", "gh-180", "sandbox", "rust", "runtime-governance", "phase-1"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/issues/180", "https://github.com/phodal/routa/issues/41", "https://github.com/phodal/routa/issues/137"]
github_issue: 180
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/180"
---

# [GitHub #180] Rust sandbox policy Phase 1

## What Happened

Routa 的 Rust sandbox 目前仍然是最小 Docker executor：

- `POST /api/sandboxes` 只接受 `{ lang }`
- `POST /api/sandboxes/{id}/execute` 只接受 `{ code }`
- Docker 启动参数固定，没有 workspace-aware `workdir`
- 没有显式的只读/读写路径授权
- 没有 policy explain/preview
- 没有为后续 permission delegation 预留执行层落点

这意味着 Rust 后端虽然具备容器隔离，但还没有 issue #180 要求的 execution-layer permission system。

## Expected Behavior

Rust sandbox 需要先完成一个可运行的 Phase 1：

- 支持 first-class sandbox policy 输入
- 支持从 `workspaceId` / `codebaseId` 派生 workspace root
- 解析出 effective policy 并提供 explain 输出
- 在 Docker `run` 时实际落地：
  - `-w` workdir
  - RO/RW bind mounts
  - network mode
  - sanitized env / allowlist env
- 现有 `{ lang }` 老调用保持兼容

## Reproduction Context

- Environment: both
- Trigger: 对比 issue #180 目标与现有 `crates/routa-core/src/sandbox/*`、`crates/routa-server/src/api/sandbox.rs`

## Why This Might Happen

- 现有 Rust sandbox 来自早期“最小可运行 Docker executor”实现，目标是先打通容器生命周期而不是权限治理
- workspace/codebase 数据模型后来已经落地，但 sandbox API 还没有接入这些上下文
- permission delegation 在 #137 先实现了协议与协调层，执行层的 policy 承载仍然缺位

## Proposed Design

### Scope

本次只实现 Rust Phase 1，不在一次提交里塞入 repo-local config、capability module 全量治理和 delegation 联动。

### Data Model

新增 Rust sandbox policy 类型：

- `SandboxPolicyInput`
- `ResolvedSandboxPolicy`
- `SandboxPolicyContext`
- `SandboxMount`
- `SandboxNetworkMode`
- `SandboxEnvMode`

输入层允许：

- `workspaceId`
- `codebaseId`
- `workdir`
- `readOnlyPaths`
- `readWritePaths`
- `networkMode`
- `envMode`
- `envAllowlist`

解析后输出：

- `scopeRoot`
- `hostWorkdir`
- `containerWorkdir`
- `mounts`
- `notes`

### Resolution Rules

1. `codebaseId` 优先于 `workspaceId`
2. `workspaceId` 存在时优先使用 default codebase 的 `repo_path` 作为 scope root
3. 只有显式 policy 才进入新解析路径；旧请求保持 legacy behavior
4. 未提供 workspace/codebase 上下文时，显式 `workdir` 本身成为 scope root
5. root mount 默认只读；显式 `readWritePaths` 才放开写入
6. 相同路径冲突时 `readWrite` 优先
7. root 内部的子路径通过 nested bind mount 覆盖 root access
8. explain 输出必须显示 host path -> container path 映射

### HTTP API

保留：

- `POST /api/sandboxes`

新增：

- `POST /api/sandboxes/explain`

说明：

- `POST /api/sandboxes` 继续兼容旧 `{ lang }`
- 当 body 带 `policy` 时，先 resolve 再 create
- `POST /api/sandboxes/explain` 只做解析预览，不创建容器

### Docker Enforcement

当 policy 存在时：

- 用 `-w` 设置 `containerWorkdir`
- 用 `-v host:container:ro|rw` 落地 root mount 与 grant mounts
- `networkMode=none` 时使用 `--network=none`
- `envMode=sanitized` 时只透传 `envAllowlist`
- `envMode=inherit` 时透传宿主环境变量
- 用 sandbox labels 记录 `workspace_id` / `codebase_id` / `network_mode`

### Backward Compatibility

- 不带 `policy` 的请求继续沿用旧逻辑
- `SandboxInfo` 增加 `effectivePolicy`，仅 policy sandbox 返回

## Follow-up Phases

### Phase 2

- trusted repo-local config
- observation/action capability split
- default-deny capability allow-lists
- richer env profiles

### Phase 3

- permission delegation -> sandbox policy mutation
- audit/explain UI
- Rust / Next.js parity tests

## Relevant Files

- `crates/routa-core/src/sandbox/mod.rs`
- `crates/routa-core/src/sandbox/types.rs`
- `crates/routa-core/src/sandbox/manager.rs`
- `crates/routa-server/src/api/sandbox.rs`
- `crates/routa-core/src/store/codebase_store.rs`
- `crates/routa-core/src/state.rs`

## Observations

- Rust 侧已经有 `codebase_store` 和 `workspace_store`，足够支撑 workspace-aware resolution
- 当前 in-sandbox server 仍然只接受 `{ code }`，所以 Phase 1 应优先在 container launch 层 enforce policy，而不是先改执行协议
- `POST /api/sandboxes/explain` 可以作为后续 permission delegation 的直接承接面

## References

- `docs/issues/2026-02-28-gh-41-feat-runtime-governance-for-autonomous-agents-deny-lists-scoped-permissi.md`
- `docs/issues/2026-03-13-gh-137-implement-automatic-agent-lifecycle-notifications-permission-delegation.md`
- `docs/issues/2026-03-03-gh-55-sandbox-for-agent-worker.md`

## Resolution

- Rust sandbox Phase 1 is now present in the main execution path:
  - `crates/routa-core/src/sandbox/policy.rs` resolves workspace-aware policy input into effective Docker policy.
  - `crates/routa-server/src/api/sandbox.rs` supports `POST /api/sandboxes`, `POST /api/sandboxes/explain`, and permission mutation explain/apply routes with workspace/codebase context resolution.
  - `crates/routa-core/src/sandbox/manager.rs` enforces the resolved policy at container launch via Docker labels, bind mounts, `-w`, env injection, and network mode.
- The remaining parity gap was on the web side: TypeScript sandbox types did not model `effectivePolicy`, and explain helpers returned `unknown`.
- This round aligned web parity by adding typed `ResolvedSandboxPolicy`/mount/capability/env metadata in `src/core/sandbox/types.ts` and by typing explain responses in `src/core/sandbox/permissions.ts`.
- Added regression coverage in `src/core/sandbox/__tests__/permissions.test.ts` so sandbox create/explain/apply responses keep their policy shape.

## Verification

- `npx vitest run src/core/sandbox/__tests__/permissions.test.ts src/app/api/sandboxes/__tests__/route.test.ts 'src/app/api/sandboxes/[id]/__tests__/route.test.ts'`
- `entrix run --tier normal` on 2026-03-28: overall `PASS` with final score `98.6%`
