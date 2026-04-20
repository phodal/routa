---
title: "Architecture Quality DSL and ArchUnitTS backend-core integration"
date: "2026-04-03"
status: resolved
severity: medium
area: "fitness"
tags:
  - architecture
  - fitness
  - entrix
  - archunit
  - harness
  - i18n
  - backend-core
reported_by: "human"
related_issues:
  - "https://github.com/phodal/routa/issues/286"
github_issue: 286
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/286"
resolved_at: "2026-04-05"
---

# Architecture Quality DSL and ArchUnitTS backend-core integration

## What Happened

当前仓库已经具备 `docs/fitness/*.md -> entrix -> /api/fitness/* -> Harness/Fitness UI` 的完整治理链路，但“后端 core 架构质量”仍缺少独立、结构化、可视化友好的度量层。

目前只有 `.dependency-cruiser.cjs` 提供仓库级、粗粒度的 TypeScript 依赖边界约束；对于 `src/core/**` 这类 TypeScript backend core，还没有更细粒度的架构规则执行与结果展示。

同时，如果后续希望引入类似 `guarding` 的可视化与多语言能力，直接复用 `ArchUnitTS` 自带 beta HTML report 并不合适，因为展示文案和模板并不适合 Routa 当前的 i18n 体系。

## Expected Behavior

后端 core 的架构约束应作为独立的治理主题进入 fitness / entrix，而不是继续混在 `code_quality` 的粗粒度静态检查里。

理想状态下需要同时满足：

- 有独立的 architecture quality / backend architecture 维度入口
- 规则表达与执行后端分离，便于后续扩展到 Rust 或图分析后端
- `ArchUnitTS` 先作为 TypeScript backend core 的执行器接入
- UI 消费结构化结果并通过 Routa 的 i18n 字典渲染，而不是依赖外部 HTML 报告

## Reproduction Context

- Environment: both web + desktop
- Trigger:
  - 希望引入 `ArchUnitTS` 度量 backend core
  - 需要判断它更适合落在 `fitness` / `entrix` 的哪一层
  - 希望后续提供类似 `guarding` 的可视化，同时保持中英文等多语言可维护

## Why This Might Happen

- 现有 `code_quality` 中的 `dependency-cruiser` 主要是粗粒度 repo guard，并不覆盖更细的 layered / slice / rule-result 模型。
- `ArchUnitTS` 适合 TypeScript 规则执行，但不天然等于 Routa 的治理/展示模型。
- 现有 Harness/Fitness UI 更偏向展示 spec、plan、report 和治理图谱，还没有专门的 architecture-quality 结果模型。
- 如果把文案直接写死在规则或 HTML report 里，会和当前 `src/i18n/` 的应用内翻译体系冲突，增加多语言维护成本。

## Proposed Work (Prioritized)

### 1) 维度落位

- 新增独立的 fitness 维度，而不是继续挤进 `docs/fitness/code-quality.md`
- 优先考虑：
  - `docs/fitness/backend-architecture.md`
  - 或 `docs/fitness/architecture-quality.md`
- 第一阶段建议 `weight: 0`，先作为 advisory surface 接入，不扰动当前总分与 CI 权重

### 2) 执行后端

- 先引入 `ArchUnitTS` 作为 TypeScript backend core 规则执行器
- 首批覆盖对象聚焦：
  - `src/core/**`
  - `src/app/api/**` 与 `src/core/**` 的依赖边界
- 首批规则建议：
  - `src/core/**` 不依赖 `src/app/**` / `src/client/**`
  - `src/app/api/**` 不依赖 `src/client/**`
  - `src/core/**` 内部关键子域无 cycle
  - provider-specific 依赖不要泄漏到通用 core 模块

### 3) 结构化结果

- 不直接把 `ArchUnitTS` 生成的 HTML 作为最终 UI
- 优先产出 JSON/structured artifact，至少包含：
  - rule id
  - severity
  - status
  - source/target violations
  - metric summary
- 让 entrix metric 只负责调用脚本并消费稳定的结构化输出

### 4) UI / i18n

- 在 Routa 现有 Harness / Fitness UI 中渲染 architecture quality
- 文案走 `src/i18n/locales/*.ts`
- 规则本体只保留稳定 id / key，不把展示文案写死在执行后端
- 借鉴 `guarding` 的分层思路：
  - rules
  - executor
  - results
  - app-localized rendering

## Relevant Files

- `docs/fitness/README.md`
- `docs/fitness/manifest.yaml`
- `docs/fitness/code-quality.md`
- `.dependency-cruiser.cjs`
- `src/app/api/fitness/specs/route.ts`
- `src/app/api/fitness/plan/route.ts`
- `src/app/settings/harness/harness-console-page.tsx`
- `src/client/hooks/use-harness-settings-data.ts`
- `src/i18n/types.ts`
- `src/i18n/locales/en.ts`
- `src/i18n/locales/zh.ts`
- `src/core/**`
- `src/app/api/**`

## Acceptance Criteria

- [ ] 新增一个独立的 architecture quality / backend architecture fitness 维度文档
- [ ] 将新维度加入 `docs/fitness/manifest.yaml`
- [ ] 产出一个可执行的 `ArchUnitTS` backend-core 验证入口
- [ ] entrix 能把该入口作为 metric 执行，而不是只依赖手工测试
- [ ] 第一阶段结果可作为 advisory surface 暴露给 Harness/Fitness UI
- [ ] UI 消费结构化结果，并通过 Routa i18n key 渲染中英文文案
- [ ] 不重复开与 `phodal/routa#286` 等价的 GitHub issue；本地 issue 与远端 issue 保持关联

## References

- `https://github.com/phodal/routa/issues/286`
- `https://github.com/LukasNiessen/ArchUnitTS`
- `https://github.com/modernizing/guarding`
