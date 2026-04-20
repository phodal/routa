---
title: "Cross-language test mapping and missing-test gates should be first-class in entrix and visible in harness-monitor"
date: "2026-04-12"
kind: issue
status: open
severity: medium
area: "entrix"
tags: ["entrix", "harness-monitor", "testability", "pre-push", "tree-sitter", "cross-language"]
reported_by: "codex"
related_issues: [
  "docs/issues/2026-04-11-routa-watch-entrix-fast-fitness-tui.md",
  "docs/issues/2026-03-23-review-context-gap-and-validator-model-control.md",
  "https://github.com/phodal/routa/issues/412"
]
github_issue: 412
github_state: open
github_url: "https://github.com/phodal/routa/issues/412"
---

# Cross-language test mapping and missing-test gates should be first-class in entrix and visible in harness-monitor

## What Happened

当前仓库已经具备：

- `git status` / dirty file 级别的变更感知
- `entrix graph test-radius` / `review-context` 这类图分析能力
- `harness-monitor` 的 Git Status Panel 与 fitness 面板

但还没有一个统一能力去回答下面这个问题：

> 当用户改了某个源文件后，这次改动是否存在对应测试文件，测试是否也被同步修改，还是当前仓库根本找不到可关联的测试？

这导致两个缺口同时存在：

- `pre-push` / local fitness gate 目前无法把“改了代码但没有对应测试证据”作为显式信号
- `harness-monitor` 虽然能看到 dirty files，却不能在 Git Status Panel 中直观看出测试映射状态

## Expected Behavior

应当提供一个可复用的 cross-language test mapping capability，并满足两类消费方：

- `routa-entrix` / `tools/entrix`
  - 作为权威检测层
  - 在 `pre-push`、local fitness、graph/testability 分析中输出结构化结果
  - 能识别：
    - 有关联测试且本次测试文件也改了
    - 有关联测试但本次未改
    - 仓库内找不到明显测试
    - 当前语言/场景无法可靠判断
- `crates/harness-monitor`
  - 复用同一套结果
  - 在 Git Status Panel / detail panel 中展示 test mapping 状态与关联测试路径

该能力不应只为 TypeScript / Rust 写死，而应具备后续扩展到 Java 等语言的结构。

## Reproduction Context

- Environment: both
- Trigger: 评估 `crates/harness-monitor` 中“dirty file -> 对应测试是否存在/是否修改”的需求时，发现能力应该沉淀到 `routa-entrix` / `tools/entrix`，并被 `pre-push` 与 monitor 共同复用

## Why This Might Happen

- 当前 dirty file 观察能力与 graph/test-radius 能力分散在不同层，没有统一的“test mapping”抽象。
- TypeScript 在本仓库里可以用路径启发式取得高命中，但 Rust 同时存在 inline test、`tests.rs`、crate-level integration tests，单靠路径会误报。
- 现有图分析能力更偏 review/test-radius，尚未抽象成面向 hook/TUI 的稳定结构化 API。
- 语言支持策略还没有明确的扩展点，如果直接在 `harness-monitor` 内写死 TS/Rust 规则，后续 Java 等语言会继续复制逻辑。

## Relevant Files

- `tools/entrix/entrix/runners/graph.py`
- `tools/entrix/entrix/structure/impact.py`
- `tools/entrix/skills/entrix/specs/dimension-testability.spec.md`
- `crates/routa-cli/src/commands/graph/analyze.rs`
- `crates/routa-entrix/src/`
- `crates/harness-monitor/src/observe.rs`
- `crates/harness-monitor/src/state.rs`
- `crates/harness-monitor/src/tui_cache.rs`
- `crates/harness-monitor/src/tui_render.rs`
- `crates/harness-monitor/src/tui_panels.rs`
- `.husky/pre-push`

## Observations

- 仓库内 TypeScript 测试布局相对一致，常见模式包括：
  - `__tests__/foo.test.ts`
  - `__tests__/foo.test.tsx`
  - `route.ts -> __tests__/route.test.ts`
- Rust 测试形态至少包括：
  - inline `#[cfg(test)] mod tests`
  - `mod.rs` 旁边的 `tests.rs` / `tests_projection.rs`
  - crate integration tests：`crates/*/tests/*.rs`
- 因此 Rust 如果直接把“未找到同名 test 文件”判成 missing，会产生大量假阴性。
- `entrix graph test-radius` 已经能输出：
  - `impacted_test_files`
  - `test_files`
  - `untested_targets`
  说明底层已经有一部分语义能力，但还没有沉淀成“dirty file -> test mapping status”的稳定输出面。

## Design Direction

- 抽象统一接口，例如：
  - `TestMappingAnalyzer`
  - `LanguageTestResolver`
  - `TestMappingStatus`
- 返回结构应至少包含：
  - `source_file`
  - `language`
  - `status` (`changed` | `exists` | `inline` | `missing` | `unknown`)
  - `related_test_files`
  - `resolver_kind` (`path_heuristic` | `inline_test` | `graph_semantic`)
  - `confidence`
- 语言策略建议分层：
  - `path heuristic`：适合 TS/JS 等强约定仓库
  - `inline/module heuristic`：覆盖 Rust 的低成本稳定信号
  - `graph / tree-sitter semantic`：处理 Rust、Java 等需要符号级映射的语言
- `pre-push` 不应直接硬阻断所有 `missing`，而应区分：
  - `missing`：高信号，可作为 warn/block 候选
  - `unknown`：只提示，不默认阻断
- `harness-monitor` 应消费 entrix 输出，不重复实现一套独立规则。

## References

- `entrix graph test-radius`
- `entrix graph review-context`
- `docs/fitness/README.md`
