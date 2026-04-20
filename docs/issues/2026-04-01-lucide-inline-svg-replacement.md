---
title: "Migrate inline SVG icons to lucide-react v1.7.0"
date: "2026-04-01"
status: resolved
severity: low
area: "frontend"
tags: ["frontend", "icons", "codemod", "lucide-react"]
reported_by: "codex"
related_issues: []
resolved_at: "2026-04-05"
resolution: "Migration completed. Most common icons (Check, Copy, RefreshCw, Bot, Search, Waypoints, etc.) have been migrated to lucide-react. Remaining SVGs are special-purpose (GitHub logo, charts, diagrams) that should stay as custom SVG."
---

# 将项目内联 SVG icons 批量替换为 lucide-react v1.7.0

## What Happened

当前前端代码中仍存在大量手写 `<svg>` 内联 icon，样式和一致性难以维护。项目新增了基于 TypeScript 的 codemod，目的是：

- 使用 `lucide-react@1.7.0` 提供的 icon 组件替换匹配的内联 svg。
- 自动补齐 `lucide-react` 的 import，避免手工逐个维护。
- 尽可能最小化改动（仅替换 icon 节点与 import）。

## Expected Behavior

- 可基于 `tools/codemods/replace-inline-svg-with-lucide.ts` 对 `src` 内的 `.tsx/.jsx` 文件做替换。
- `npm run codemod:lucide-icons -- --write` 会完成替换，并产生可回放的 JSON 报告（`--json`）。
- 未命中映射的图标仍保留原始 svg，并在输出里列明来源行号。

## Why This Matters

- 统一 icon 库后更容易维护、升级视觉规范。
- 降低重复 SVG 结构和属性差异引起的渲染一致性问题。
- 通过脚本化改造减少漏改风险。

## Relevant Files

- `tools/codemods/replace-inline-svg-with-lucide.ts`
- `tools/codemods/lucide-icon-map.ts`
- `package.json`
- `package-lock.json`
