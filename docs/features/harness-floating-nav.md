---
title: Harness Floating Navigation
---

# Harness 页面浮动导航菜单

## 概述

为了解决 Harness 设置页面 (`/settings/harness?workspaceId=default`) 中包含大量 item card 导致导航困难的问题，我们引入了一个右下角的浮动导航菜单。

## 功能特性

1. **浮动按钮**：位于页面右下角的固定位置
2. **快速导航**：点击按钮展开导航菜单，显示所有主要 section
3. **高亮当前位置**：根据滚动位置自动高亮当前可见的 section
4. **平滑滚动**：点击菜单项平滑滚动到对应 section
5. **点击外部关闭**：点击菜单外部区域自动关闭菜单

## 导航的 Sections

- **Governance Loop** - 治理循环图
- **Spec Sources** - 规范来源
- **Agent Instructions** - Agent 指令
- **Repository Signals** - 仓库信号
- **Hook Systems** - Hook 系统
- **Review Triggers** - 审核触发器
- **Entrix Fitness** - Entrix 适配度

## 实现细节

### 组件位置
- 文件：`src/client/components/harness-floating-nav.tsx`
- 使用位置：`src/app/settings/harness/page.tsx`

### 关键实现
1. **Section ID 绑定**：每个主要的 panel/card 用 `<div id="section-id">` 包裹
2. **滚动监听**：使用 `IntersectionObserver` 或滚动事件监听当前可见 section
3. **平滑滚动**：使用 `window.scrollTo({ behavior: "smooth" })` 实现

### 样式设计
- 使用 Tailwind CSS 实现响应式设计
- 支持深色模式
- 悬停效果和过渡动画
- 半透明背景与毛玻璃效果

## 使用方法

访问 `http://localhost:3000/settings/harness?workspaceId=default`，页面右下角会出现一个圆形的浮动按钮（带向上箭头图标）：

1. 点击按钮展开菜单
2. 选择要跳转的 section
3. 页面自动滚动到对应位置
4. 菜单自动关闭

## 扩展性

要添加新的导航项，只需在 `navSections` 数组中添加对应的配置，并确保对应的 section 有正确的 ID：

```typescript
const navSections: HarnessNavSection[] = useMemo(() => [
  { id: "governance-loop", label: "Governance Loop" },
  { id: "new-section", label: "New Section" },
  // ...
], []);
```

对应的 section：

```tsx
<div id="new-section">
  <YourNewComponent />
</div>
```

