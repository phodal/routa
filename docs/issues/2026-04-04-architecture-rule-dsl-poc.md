---
title: "Cross-language architecture rule DSL rollout"
date: "2026-04-04"
status: resolved
severity: medium
area: "fitness"
tags:
  - architecture
  - fitness
  - dsl
  - archunit
  - rust
  - typescript
  - llm
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/286"
  - "https://github.com/phodal/routa/issues/296"
github_issue: 296
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/296"
resolved_at: "2026-04-04"
---

# Cross-language architecture rule DSL rollout

## What Happened

Routa 的 backend architecture fitness 已经接入了 `ArchUnitTS`，但规则仍然直接写死在 `scripts/fitness/check-backend-architecture.ts` 里。这让 TypeScript 执行路径先跑起来了，但规则定义本身还不能被 Rust 侧复用，也不适合拿给 LLM 生成/校验。

本次 rollout 把这条链拆成三层：

- 一份机器可读的 YAML DSL
- TypeScript 侧把 DSL 编译为 ArchUnitTS 规则
- Rust CLI 侧读取同一份 DSL，做解析、语义校验、执行计划输出，以及 graph-backed 规则执行

同时增加了一份面向 LLM 的 markdown case，并用 `claude -p` 实际生成了一份 DSL，再回喂给 TS/Rust 两端验证。

## Why This Matters

- 架构规则终于不再绑死在某一个执行器实现里。
- 同一份 rule intent 现在可以被 TypeScript 和 Rust 同时消费。
- LLM 可以在不改代码的前提下参与规则草拟和校验。
- 后续把 DSL 编译到 `ArchUnit`、Rust 原生依赖图、或 graph probe 后端时，不需要重做 authoring 格式。

## Validation Evidence

- Canonical DSL: `architecture/rules/backend-core.archdsl.yaml`
- LLM case: `architecture/rules/cases/backend-core.archdsl.md`
- TypeScript CLI validation: `npm run test:arch:dsl`
- TypeScript parser/compiler test: `npx vitest run scripts/__tests__/architecture-rule-dsl.test.ts`
- TypeScript lint: `npx eslint scripts/fitness/architecture-rule-dsl.ts scripts/fitness/check-backend-architecture.ts scripts/__tests__/architecture-rule-dsl.test.ts`
- Rust graph tests: `cargo test -p routa-cli graph::analyze -- --nocapture`
- Rust DSL tests: `cargo test -p routa-cli arch_dsl -- --nocapture`
- Rust CLI report: `cargo run -p routa-cli -- fitness arch-dsl --json`
- Graph smoke commands:
  - `cargo run -p routa-cli -- graph analyze --dir crates/routa-cli/src/commands --lang rust --output /tmp/routa-rust-graph.json`
  - `cargo run -p routa-cli -- graph analyze --dir src/core --lang typescript --output /tmp/routa-ts-graph.json`
- LLM validation:
  - first `claude -p` attempt on the backend-core case returned commentary/fences and failed automated parsing
  - after tightening the case contract, the regenerated backend-core YAML parsed in Rust and executed in the TypeScript path
  - a second `claude -p` prompt generated a `graph`-hint Rust rule pack that the Rust CLI executed against a synthetic crate pair and reported the expected dependency violation

## Known Limits

- Rust 侧已经能执行 graph-backed rule，但 `ArchUnitTS` 规则仍然保留在 TypeScript fitness 路径里。
- `ArchUnitTS` 的 cycle rule 仍会对当前仓库触发 `Maximum call stack size exceeded`。这次 rollout 已经把它收敛成结构化失败结果，但没有修复上游执行器问题。
- LLM case 已经足够驱动 Claude 输出可解析的 canonical YAML，但 `graph` 用例在 prompt 不够强时仍可能回到 markdown fences，需要继续保持严格的 output contract。

## Proposed Follow-up

- 将 DSL 范围从 backend-core 扩展到更细的 slice/layer 规则。
- 为 Rust 引入真实的依赖图执行器，而不只是验证器。
- 把 architecture DSL 结果接入 Harness/Fitness UI 的结构化展示层。
- 单独跟踪 `ArchUnitTS` cycle rule 栈溢出问题。
