---
dimension: design_system
weight: 10
tier: normal
threshold:
  pass: 90
  warn: 80
  block: 0

metrics:
  - name: design_system_css_contract
    command: npm run lint:css 2>&1
    pattern: "Design-system CSS lint passed"
    hard_gate: false
    tier: normal
    description: "代码层与设计层：桌面 shell 禁止回退为硬编码颜色，并保持 dt token 命名契约"

  - name: design_system_component_visual
    command: npm run test:e2e:desktop-shell 2>&1
    pattern: "\\d+\\s+passed"
    hard_gate: true
    tier: deep
    description: "组件层：desktop shell 关键 chrome 的 Playwright 视觉回归"

  - name: design_system_experience_accessibility
    command: npm run test:accessibility 2>&1
    pattern: "accessibility smoke passed"
    hard_gate: false
    tier: deep
    description: "页面层与体验层：关键桌面路由的 aria 结构快照与可访问性 smoke"
---

# Design System Quality Layers

## 目的

把 design system 的验收从一次性改造拆成 6 层可执行质量门：

- 代码层：禁止 shell 级颜色硬编码重新进入共享组件
- 设计层：继续以 `desktop-theme.css` 的 `--dt-*` token 为单一事实来源
- 组件层：`desktop shell` 关键 chrome 保持视觉基线
- 页面层：workspace / kanban / traces / session detail 维持稳定结构快照
- 体验层：关键路由保留 main landmark、heading 与可命名交互元素
- 性能层：关键路由在可接受的导航 / FCP / CSS 成本阈值内
  - 这部分已经迁移到 `runtime/performance.md`，避免把运行时预算继续塞进 design system 维度

## 当前门禁

### 1. 代码层

- 命令：`npm run lint:css`
- 范围：
  - `src/client/components/desktop-app-shell.tsx`
  - `src/client/components/desktop-layout.tsx`
  - `src/client/components/desktop-sidebar.tsx`
  - `src/client/components/desktop-nav-rail.tsx`
  - `src/client/components/workspace-switcher.tsx`
  - `src/app/styles/desktop-theme.css`
- 阈值：
  - shell 共享组件不得出现 palette class / hex / rgb 硬编码
  - `desktop-theme.css` 变量前缀只允许 `--dt-*` 与 `--color-desktop-*`

### 2. 设计层

- 由 `npm run lint:css` 同时覆盖
- 目标：
  - desktop token contract 不被页面内局部样式绕开
  - `workspace-switcher` 的 desktop 分支仍消费 desktop token

### 3. 组件层

- 命令：`npm run test:e2e:desktop-shell`
- 覆盖：
  - `desktop-shell-header`
  - `desktop-shell-sidebar`
  - `workspace-tab-bar`
  - `kanban-page-header`
  - `traces-page-header`
  - `traces-view-tabs`

### 4. 页面层

- 命令：`npm run test:accessibility`
- 覆盖页面：
  - `/workspace/default`
  - `/workspace/default/kanban`
  - `/traces`
  - `/workspace/default/sessions/1eed8a78-7673-4a1b-b6b9-cd68dc5b75c7`
- 规则：
  - 页面 landmark signature 需与基线 aria snapshot 保持一致

### 5. 体验层

- 命令：`npm run test:accessibility`
- 阈值：
  - 页面必须存在且仅存在一个 `<main>`
  - 页面必须至少包含一个 `h1` 或 `h2`
  - 关键可交互元素不得缺失 accessible name

## 使用方式

关键 shell 相关改动后，至少执行：

```bash
npm run lint:css
npm run test:e2e:desktop-shell
npm run test:accessibility
entrix run --dry-run
```

## 已知边界

- 这不是全仓 CSS lint，只聚焦 desktop shell 共享组件。
- `ariaSnapshot` 验证的是结构稳定性，不等于完整 WCAG 审计。
- performance smoke 已迁移到 `runtime/performance.md`；这里不再把运行时预算冒充成 design system 自身的质量门。
