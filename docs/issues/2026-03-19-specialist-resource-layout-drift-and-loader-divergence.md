---
title: "resources/specialists directory mixes runtime formats, taxonomy concerns, and locale overlays, causing loader divergence across TS and Rust"
date: "2026-03-19"
status: resolved
resolved_at: "2026-03-26"
severity: medium
area: "specialist-system"
tags: ["specialist", "resources", "prompt-loading", "locale", "yaml", "markdown"]
reported_by: "codex"
github_issue: 204
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/204"
related_issues:
  - "2026-03-08-cli-specialist-at-mention.md"
  - "https://github.com/phodal/routa/issues/204"
---

# `resources/specialists` 目录结构漂移，导致 TS / Rust specialist 加载语义不一致

## What Happened

`resources/specialists` 当前同时承担了三类职责：

1. 运行时 specialist 定义源
2. 长篇 prompt / 操作说明文档
3. 本地化文案覆盖目录

同一 specialist 还可能以 `.md` 和 `.yaml` 两种格式同时存在于顶层目录，例如 `developer`、`crafter`、`gate`、`routa`。

结果是：

- TypeScript 侧只加载 `.md`，并支持 `resources/specialists/zh-CN/`
- Rust 侧同时加载顶层 `.md` 和 `.yaml`，但不递归子目录
- 同一 specialist 在双后端中可能获得不同 prompt、不同字段集、不同 locale 可见性
- 顶层目录把 core role、team role、kanban workflow、review、tool-specific prompts 混在一起，命名依赖前缀而不是结构

## Expected Behavior

`resources/specialists` 应该满足以下条件：

- 运行时 specialist 配置有单一事实来源，不允许同 ID 的多格式文件静默并存
- TypeScript 与 Rust 对 specialist 的可见集合、优先级和 locale 覆盖语义保持一致
- 目录按稳定 taxonomy 组织，而不是长期依赖文件名前缀区分用途
- locale 目录只覆盖语言文案，不改变某个 locale 下可用 specialist 的能力集合

## Reproduction Context

- Environment: both
- Trigger: 审查 `resources/specialists` 结构与双后端加载逻辑时发现
- Scope:
  - `resources/specialists/*.md`
  - `resources/specialists/*.yaml`
  - `resources/specialists/zh-CN/*.md`
  - `src/core/specialists/specialist-file-loader.ts`
  - `crates/routa-core/src/workflow/specialist.rs`

## Why This Might Happen

- specialist 系统从“仅 Markdown frontmatter”演进到“Rust workflow 需要 YAML 原生定义”后，没有完成单一 schema 收敛
- locale 支持是在 TypeScript loader 上先行扩展的，而 Rust loader 仍停留在顶层目录扫描模型
- 新 specialist 类型逐步增加后，目录没有引入二级分类，继续沿用 `team-*`、`kanban-*` 等命名前缀扩展

## Relevant Files

- `resources/specialists/developer.md`
- `resources/specialists/developer.yaml`
- `resources/specialists/crafter.md`
- `resources/specialists/crafter.yaml`
- `resources/specialists/gate.md`
- `resources/specialists/gate.yaml`
- `resources/specialists/routa.md`
- `resources/specialists/routa.yaml`
- `resources/specialists/zh-CN/`
- `src/core/specialists/specialist-file-loader.ts`
- `src/core/orchestration/specialist-prompts.ts`
- `crates/routa-core/src/workflow/specialist.rs`

## Observations

- 顶层 `.md` 文件共 27 个，`zh-CN` 下 `.md` 文件共 18 个，缺失整组 `team-*` specialists
- Rust loader 在同一目录内同时读取 `.md` 和 `.yaml`，并按 `id` 写入同一个 `HashMap`，没有重复定义保护
- TypeScript loader 只读取 `.md`，因此 YAML-only 字段演进不会自然同步到前端路径
- 当前目录同时混有：
  - 基础角色：`routa` / `crafter` / `gate` / `developer`
  - workflow 阶段：`kanban-*`
  - team 角色：`team-*`
  - review / issue / tool 定向 specialist：`pr-*` / `issue-*` / `claude-code`

## Proposed Target Layout

建议将 specialist 目录拆成“运行时 schema”与“语言覆盖/文档说明”两个层次，并显式引入分类目录：

```text
resources/specialists/
  core/
    routa.yaml
    crafter.yaml
    gate.yaml
    developer.yaml
  team/
    agent-lead.yaml
    general-engineer.yaml
    frontend-dev.yaml
    backend-dev.yaml
    qa.yaml
    code-reviewer.yaml
    researcher.yaml
    ux-designer.yaml
    operations.yaml
  workflows/
    kanban/
      agent.yaml
      backlog-refiner.yaml
      todo-orchestrator.yaml
      dev-executor.yaml
      review-guard.yaml
      blocked-resolver.yaml
      done-reporter.yaml
  review/
    pr-reviewer.yaml
    pr-analyzer.yaml
    desk-check.yaml
  issue/
    issue-enricher.yaml
    issue-refiner.yaml
  tools/
    claude-code.yaml
    evolution-architecture.yaml
  locales/
    zh-CN/
      core/
        routa.md
        crafter.md
        gate.md
        developer.md
      team/
        ...
      workflows/
        kanban/
          ...
```

约束建议：

- `.yaml` 作为唯一运行时定义源
- `.md` 仅用于 locale prompt body 覆盖或作者说明，不再与顶层 runtime 文件同名并列
- 运行时 loader 统一支持递归目录与 locale overlay
- 同 ID 重复定义直接报错，不允许静默覆盖

## Migration Steps

1. 定义正式 schema 与加载优先级
   - 明确 runtime 只认 `.yaml`
   - 明确 locale overlay 的路径、字段范围和 fallback 规则

2. 引入重复定义校验
   - 在 TS / Rust loader 中检测重复 specialist ID
   - 在 CI 或测试中阻止同 ID 多文件共存

3. 迁移核心 specialists
   - 先迁移 `routa` / `crafter` / `gate` / `developer`
   - 将现有 `.md` 中真正运行时需要的 prompt 合并进 `.yaml`
   - 保留兼容期映射，但增加 deprecation 告警

4. 迁移 workflow 与 team specialists
   - 按分类目录搬迁 `kanban-*`、`team-*`、`pr-*`、`issue-*`
   - 统一文件命名为不带分类前缀的语义名，分类由目录表达

5. 补齐 locale overlay
   - `zh-CN` 仅覆盖已存在 specialist 的语言内容
   - 缺失翻译时自动回退默认语言，而不是让 specialist 消失

6. 收敛双后端 loader
   - TS 与 Rust 使用同一套搜索路径、递归策略、重复检查和 locale 合并规则
   - 为最终 specialist 集合增加对齐测试

7. 删除兼容层
   - 在验证完成后移除顶层 legacy `.md` runtime 读取逻辑
   - 清理旧命名前缀和重复文件

## References

- Local history searched: `docs/issues/2026-03-08-cli-specialist-at-mention.md`
- Runtime loaders inspected:
  - `src/core/specialists/specialist-file-loader.ts`
  - `crates/routa-core/src/workflow/specialist.rs`

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `resources/specialists/` is now organized into taxonomy directories such as
  `core/`, `team/`, `review/`, `issue/`, `tools/`, and `workflows/kanban/`.
- `src/core/specialists/specialist-file-loader.ts` loads YAML runtime
  definitions from nested directories, loads locale overlays only from
  `locales/<locale>/` or legacy locale folders, and rejects duplicate
  specialist IDs.
- `crates/routa-core/src/workflow/specialist.rs` mirrors the same YAML-only,
  recursive, locale-overlay-aware loading rules and duplicate-ID protection on
  the Rust side.
- `src/core/specialists/__tests__/specialist-file-loader.test.ts` covers locale
  overlay paths, Markdown exclusion from runtime loading, and duplicate ID
  failures.
