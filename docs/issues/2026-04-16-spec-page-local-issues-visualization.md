---
title: "feat: Spec 页面 — 本地 Issues 可视化看板"
date: "2026-04-16"
kind: issue
status: open
severity: medium
area: ui
tags: [spec, issues, kanban, visualization, local-issues]
reported_by: "human"
related_issues: []
github_issue: 470
github_state: open
github_url: "https://github.com/phodal/routa/issues/470"
---

# Spec 页面：本地 Issues 可视化

## What We Want

新建一个 **Spec** 页面（路由 `/workspace/[workspaceId]/spec`），用于可视化 `docs/issues/` 目录下的本地 issue 文档。  
交互和视觉体验参考现有 Kanban 页面，但数据来源是本地 Markdown issue 文件而非 Task/Board 数据。

## Motivation

当前 `docs/issues/` 下有 157+ 个 Markdown issue 文件，只能通过文件浏览器或编辑器查看。  
需要一个可视化界面来：

- 按状态（open / investigating / resolved / wontfix）分列展示
- 快速筛选和检索
- 一目了然地掌握项目健康度和问题分布

## Implementation Plan

### Phase 1: Backend API

**1.1 Next.js API Route — `GET /api/spec/issues`**

- 路径：`src/app/api/spec/issues/route.ts`
- 职责：扫描工作区目录下的 `docs/issues/*.md`，解析 YAML frontmatter，返回结构化 JSON
- 参数：`workspaceId`（用于确定工作区根目录）
- 响应结构：

```typescript
interface SpecIssue {
  filename: string;        // e.g. "2026-04-15-some-issue.md"
  title: string;
  date: string;
  kind: "issue" | "analysis" | "progress_note" | "verification_report" | "github_mirror";
  status: "open" | "investigating" | "resolved" | "wontfix";
  severity: "info" | "low" | "medium" | "high" | "critical";
  area: string;
  tags: string[];
  reportedBy: string;
  relatedIssues: string[];
  githubIssue: number | null;
  githubState: string | null;
  githubUrl: string | null;
}

// GET /api/spec/issues?workspaceId=xxx
// Response: { issues: SpecIssue[] }
```

- 使用 `gray-matter` 或手动解析 YAML frontmatter
- 排除 `_template.md` 和 `issue-gc-state.yaml`

**1.2 Rust/Axum API — Tauri 桌面端**

- 路径：`crates/routa-server/src/api/spec.rs`
- 与 Next.js API 保持相同的请求/响应契约
- 从工作区 `docs/issues/` 目录读取文件

### Phase 2: Frontend Page

**2.1 路由和页面结构**

按照现有 Kanban 页面的 Server Component + Client Component 模式：

```
src/app/workspace/[workspaceId]/spec/
├── page.tsx                   # Server Component，generateStaticParams
└── spec-page-client.tsx       # Client Component，数据获取和渲染
```

**2.2 核心组件**

| 组件 | 职责 |
|------|------|
| `SpecPageClient` | 主容器，通过 `desktopAwareFetch` 获取 issues 数据 |
| `SpecBoard` | 看板主体，按 status 分列（open / investigating / resolved / wontfix） |
| `SpecCard` | Issue 卡片，展示 title、severity badge、area、date、tags |
| `SpecCardDetail` | 点击卡片后的详情侧面板，展示完整 issue 内容（渲染 Markdown body） |
| `SpecFilterBar` | 筛选栏：按 kind / severity / area / tags / reportedBy 过滤 |

**2.3 列配置**

与 Kanban 类似的列式布局，默认 4 列：

| 列 | status | 颜色 |
|----|--------|------|
| Open | `open` | sky |
| Investigating | `investigating` | amber |
| Resolved | `resolved` | emerald |
| Won't Fix | `wontfix` | slate |

**2.4 卡片信息**

每张卡片展示：
- 标题（title）
- 严重级别徽章（severity → 颜色编码）
- 功能区域（area）
- 日期（date）
- 标签列表（tags）
- GitHub issue 链接（如有）
- Kind 标识（issue / analysis / progress_note / verification_report / github_mirror）

### Phase 3: Navigation Integration

**3.1 侧边栏注册**

在 `src/client/components/desktop-sidebar.tsx` 的 `primaryItems` 或 `secondaryItems` 中添加 Spec 入口：

```typescript
{
  id: "spec",
  label: t.nav.spec,
  href: `${workspaceBaseHref}/spec`,
  icon: <FileText size={iconSize} />,  // 或 ClipboardList
}
```

**3.2 i18n 翻译**

| 文件 | 添加内容 |
|------|---------|
| `src/i18n/types.ts` | `nav.spec: string` |
| `src/i18n/locales/en.ts` | `spec: "Spec"` |
| `src/i18n/locales/zh.ts` | `spec: "规格"` |

### Phase 4: Enhancement (可选)

- 搜索：全文搜索 issue 标题和内容
- 统计面板：按 area / severity / kind 的分布图表
- Issue 详情中渲染 Markdown body
- 支持从 Spec 页面直接打开对应文件（通过 VS Code URI 或文件链接）
- 与 GitHub issue 的状态同步视觉指示

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/` — 参考 Kanban 页面实现模式
- `src/client/components/desktop-sidebar.tsx` — 侧边栏导航注册
- `src/i18n/types.ts` / `src/i18n/locales/en.ts` / `src/i18n/locales/zh.ts` — i18n
- `docs/issues/_template.md` — Issue frontmatter 模板
- `docs/issues/issue-gc-state.yaml` — Issue 清理状态
- `crates/routa-server/src/api/` — Rust 后端 API 目录

## Acceptance Criteria

- [ ] `GET /api/spec/issues?workspaceId=xxx` 正确返回解析后的 issue 列表
- [ ] Spec 页面按 status 分列展示 issues
- [ ] 卡片展示 title、severity、area、date、tags
- [ ] 支持按 kind / severity / area 筛选
- [ ] 侧边栏可跳转到 Spec 页面
- [ ] i18n 支持中英文
- [ ] Tauri 桌面端对应的 Axum API 实现
- [ ] 通过 `desktopAwareFetch` 统一前端 API 调用
