---
title: "[Feature] Settings 增加 Kanban YAML 导出，便于导入 Rust 版本"
date: 2026-03-20
status: resolved
resolved_at: "2026-04-03"
severity: medium
area: settings
tags: ["feature", "settings", "kanban", "yaml", "rust", "import-export"]
reported_by: "agent"
related_issues: [193]
github_issue: null
github_state: null
github_url: null
---

# [Feature] Settings 增加 Kanban YAML 导出，便于导入 Rust 版本

## 背景

Next.js 版本里的 Kanban/automation 设置已经能在 UI 中完成配置，但当前缺少一个面向 Rust 版本的直接迁移出口。

仓库里已经具备两块基础能力：

- Rust 侧已有 `KanbanConfig` YAML schema 与 `to_yaml()`/`from_yaml()`；
- CLI 已支持 `routa kanban board export/apply/validate` 的 YAML 流程。

当前 gap 在于：

- Web Settings 没有把现有 workspace 的 board/column/automation 配置导出成 YAML；
- 用户无法直接把 Next.js 中调好的设置拿去给 Rust 版本导入；
- 迁移过程仍然依赖手工抄写或额外 CLI 拼装，容易漂移。

## 目标

1. 在 Next.js Settings 中提供一个明确的 `Export YAML` 操作；
2. 导出的 YAML 直接对齐 Rust 侧 `KanbanConfig` 结构；
3. 支持按 `workspaceId` 导出，默认面向 `default` workspace；
4. 输出文件可作为后续 Rust 版本导入的基础输入。

## 非目标

- 本次不实现 Rust 侧 GUI 导入；
- 本次不改 Kanban automation 的语义；
- 本次不引入跨 workspace 的批量导出包格式。

## 验收标准

- Settings 中可输入/确认 `workspaceId` 并下载 `.yaml` 文件；
- YAML 至少包含 `version/workspaceId/boards/columns/automation`；
- `boards[].columns[]` 的 `stage/color/automation` 能被保留；
- 导出文件命名可区分 workspace，便于后续导入 Rust 版本。

## Resolution

This issue is resolved in the current codebase. The local status was updated
during issue hygiene on 2026-04-03 after verifying that the export path already
exists in both the API and the settings UI.

Evidence in current implementation:

- `src/app/api/kanban/export/route.ts` exports workspace-scoped Kanban YAML with
  `version`, `workspaceId`, `boards`, `columns`, and normalized automation data.
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx` exposes an
  `Export YAML` action, lets the user choose a `workspaceId`, and downloads a
  `kanban-<workspace>.yaml` file.
- `src/app/api/kanban/export/__tests__/route.test.ts` covers the export route.

The broader Rust-side YAML workflow is separately documented and resolved in
`docs/issues/2026-03-18-kanban-yaml-config-cli-bootstrap.md`.
