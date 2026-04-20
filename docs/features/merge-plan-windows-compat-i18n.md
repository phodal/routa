---
title: Merge Plan - Windows Compat & i18n
---

# 合并方案：fix/windows-compatibility-and-i18n → upstream/main

> 创建日期：2026-03-31
> 分支：`fix/windows-compatibility-and-i18n`
> 目标：将本分支的 Windows 兼容性修复 + i18n 中文本地化整合到最新上游代码

---

## 1. 约束条件

### 1.1 远端只读约束

| 规则 | 说明 |
|------|------|
| **禁止 push 到 upstream** | `upstream`（phodal/routa）为只读上游，任何情况下不得 `git push upstream` |
| **禁止 force push** | 不得对任何远端执行 `--force` 推送 |
| **origin 仅作为备份** | `origin`（1339190177/routa）仅用于保存工作进度，合并完成后可选择性推送 |
| **所有合并操作在本地完成** | rebase / merge / cherry-pick 均在本地执行，确认无误后再决定是否推送 origin |

### 1.2 操作流程约束

```
upstream (只读拉取) → 本地 main → 本地合并分支 → origin (可选推送备份)
```

---

## 2. 分支差异概况

| 指标 | 数量 |
|------|------|
| merge-base commit | `6f6f8cb` |
| 本分支独有 commit | 9 |
| 上游独有 commit | 282 |
| 本分支变更文件 | 79 |
| 上游变更文件 | 441 |
| 双方共同修改文件（潜在冲突） | **44** |

### 本分支 9 个 commit 概览

| Commit | 内容 | 类型 |
|--------|------|------|
| `a17ccfee` | integrate Chinese localization across UI components | feat(i18n) |
| `ba3eb355` | add shell option for Windows compatibility in typecheck | fix(hook) |
| `bbae1e31` | resolve pre-push hook failures for Windows compatibility | fix |
| `87e46335` | add Windows compatibility for hook and Rust tests | fix(tests) |
| `c17f2825` | cross-platform path assertions and Windows file cleanup | fix(tests) |
| `e6b26666` | improve cross-platform compatibility for Windows | fix(tests) |
| `6d550725` | strip ANSI codes before pattern matching | fix(hook) |
| `df641db2` | improve cross-platform compatibility for Windows | fix(tests) |
| `9b8429af` | 修复缓存时间初始值逻辑错误 | fix(docker) |

### 上游 282 个 commit 主要主题

- **Fitness/Fluency 体系**：fitness dashboard、capability matrix、fluency scoring、instruction audit
- **Harness 系统**：hook workbench、governance loop、flow gallery、repo signal detector
- **Specialist 体系**：agents-md-auditor、JSON mode、specialist prompts
- **Kanban 增强**：file changes panel、card detail 重构、settings modal 重写、agent prompt handler 重构
- **CLI 新 crate**：`routa-cli`（fitness/fluency 模块）、`entrix`（evidence/governance/scoring）
- **UI 组件**：desktop-sidebar 重构、home-input AgentRole、onboarding checklist、settings 面板扩展

---

## 3. 冲突分析（按主题）

### 3.1 i18n 翻译体系 — 🔴 高风险

**涉及文件**：`src/i18n/locales/en.ts`、`src/i18n/locales/zh.ts`、`src/i18n/types.ts`

| 维度 | 本分支 | 上游 |
|------|--------|------|
| en.ts 新增行 | 639 | 264 |
| zh.ts 新增行 | 640 | 261 |
| types.ts 新增字段 | ~460 行 | ~240 行 |

**冲突原因**：

- 两侧在同一文件的相同 section（`common`、`nav`、`workspace`、`settings`、`onboarding`）追加字段
- 本分支新增完整 `kanban` section（~200 键），上游新增完整 `fitness` section（~200 键），插入位置重叠
- `types.ts` 的 `TranslationDictionary` 接口两侧都在扩展，合并时产生结构性冲突

**合并策略**：

1. 以 upstream 版本为基底
2. 手动合并 `types.ts`：保留上游的 `fitness`/`settings`/`onboarding` 扩展 + 追加本分支的 `kanban`/`workspace`/`nav` 扩展
3. `en.ts`：同样以 upstream 为基底，追加本分支独有的翻译键
4. `zh.ts`：以 upstream 为基底，追加本分支的中文翻译 + 为上游新增的 `fitness`/`onboarding`/`settings` 字段补充中文翻译

---

### 3.2 React UI 组件 — 🔴 高风险

**16 个共同修改文件**，关键冲突：

| 文件 | 本分支变更性质 | 上游变更性质 | 冲突级别 |
|------|--------------|------------|---------|
| `desktop-sidebar.tsx` | +22行(i18n t()) | +234行(重构+topAction) | 🔴 高 |
| `settings-panel-specialists-tab.tsx` | +28行(i18n) | +581行(完全重写) | 🔴 高 |
| `home-input.tsx` | +56行(t()) | +25行(AgentRole) | 🟡 中高 |
| `schedule-panel.tsx` | +98行(t()) | +11行 | 🟡 中 |
| `settings-panel-mcp-tab.tsx` | +75行(t()) | +31行 | 🟡 中 |
| `collaborative-task-editor.tsx` | +161行(t()) | +7行 | 🟢 低 |
| `agent-install-panel.tsx` | +50行(t()) | +4行 | 🟢 低 |

**合并策略**：

- **上游重写的组件**（specialists-tab、desktop-sidebar）：采用上游新版，重新在上游代码上套用 `t()` 包装
- **本分支大幅修改的组件**（collaborative-task-editor、schedule-panel）：以上游为基础，重新应用 i18n 改动
- **小改动组件**（agent-install-panel、workflow-panel 等）：直接合并，冲突易解

---

### 3.3 Kanban 模块 — 🔴 高风险

**13 个共同修改文件**，上游在 kanban 目录变更 **+1654/-424** 行：

| 文件 | 上游变更 | 说明 |
|------|---------|------|
| `kanban-tab.tsx` | 重构 props 接口 | 引入 `KanbanAgentPromptHandler`，删除旧 prompt 类型 |
| `kanban-card-activity.tsx` | +215 | 大幅扩展活动展示 |
| `kanban-card-detail.tsx` | +213 | 卡片详情重构 |
| `kanban-settings-modal.tsx` | +261 | 设置模态框重写 |
| `kanban-tab-panels.tsx` | +174 | 面板逻辑扩展 |
| `kanban-tab-header.tsx` | -72 | 精简头部 |

**本分支对 kanban 的改动**：主要是 i18n 字符串替换 + 少量格式化（`handleSpecialistLanguageChange` → `_handleSpecialistLanguageChange`），这些在重写后的上游版本中不再相关。

**合并策略**：

1. **完全采用上游 kanban 代码**作为基础
2. 在上游新版组件上重新应用 i18n `t()` 包装
3. 本分支的格式化修改（缩进调整等）不再需要

---

### 3.4 Rust 后端 — 🟡 中等风险

**2 个冲突文件**：

| 文件 | 本分支 | 上游 |
|------|--------|------|
| `binary_manager.rs` | +1行(Windows兼容) | ±8行(功能扩展) |
| `runtime_manager.rs` | +1行(Windows兼容) | ±12行(功能扩展) |

**上游新增内容**（不冲突但需验证编译）：

- `routa-cli` 新 crate：fitness/fluency/harness/specialist 命令（~5000 行）
- `entrix` 新 crate：evidence/governance/model/scoring（~3300 行）
- `routa-core` 扩展：`harness.rs`、`git.rs`、`automation.rs`、`tasks.rs` 等

**合并策略**：

1. `binary_manager.rs` / `runtime_manager.rs`：以上游为主，重新应用 Windows 兼容性修复
2. 本分支独有的新文件（`terminal_manager.rs`、`folder_slug.rs`、`vcs.rs`、`acp_routes.rs`、`files.rs`）直接保留
3. 合并后执行 `cargo check` / `cargo test` 验证编译

---

### 3.5 Hook Runtime — 🟢 低风险

**4 个共同修改文件**：

| 文件 | 本分支 | 上游 | 策略 |
|------|--------|------|------|
| `fitness.ts` | 10行 | **+331行大幅扩展** | 以上游为主 |
| `check-markdown-links.test.ts` | 155行(跨平台改造) | 11行 | 保留本分支改造+合入上游小改 |
| `typecheck-smart.test.ts` | 93行(跨平台改造) | 10行 | 保留本分支改造+合入上游小改 |
| `metrics.test.ts` | 29行(新增) | 无 | 直接保留 |

---

### 3.6 Core 模块 — 🟢 低风险

**4 个冲突文件**，均为小规模改动，手动合并即可：

- `session-db-persister.test.ts`：两侧都是小修改
- `terminal-manager.test.ts`：上游 +107 行扩展，我们 +7 行
- `sqlite.ts`：上游 +18 行，我们做路径兼容
- `tool-call-context-writer.test.ts`：双方小修改

---

## 4. 执行计划

### Phase 0：准备工作

```bash
# 1. 确保工作区干净
git status

# 2. 拉取最新上游（只 fetch，不 merge）
git fetch upstream main

# 3. 创建本地合并工作分支
git checkout -b merge/upstream-sync fix/windows-compatibility-and-i18n
```

### Phase 1：Rebase 到 upstream/main

```bash
# 以 upstream/main 为基底 rebase
git rebase upstream/main
```

> 预期会产生 44 个文件的冲突，按以下优先级逐个解决。

### Phase 2：解决冲突（按优先级）

#### Step 2.1 — i18n 体系（最高优先级，其他组件依赖）

1. `src/i18n/types.ts`：合并两侧接口扩展
2. `src/i18n/locales/en.ts`：以 upstream 为底 + 追加本分支翻译键
3. `src/i18n/locales/zh.ts`：同上 + 为上游新增键补中文

#### Step 2.2 — Rust 后端

1. `binary_manager.rs` / `runtime_manager.rs`：以上游为主 + 重新应用 Windows 修复
2. 验证 `cargo check` 编译通过

#### Step 2.3 — Hook Runtime

1. `fitness.ts`：接受上游版本
2. 测试文件：保留本分支跨平台改造 + 合入上游新增断言

#### Step 2.4 — Core 模块

1. 4 个冲突文件手动合并（变更量小）

#### Step 2.5 — Kanban 模块

1. 13 个冲突文件全部接受上游版本
2. 在上游新版上重新应用 i18n `t()` 包装

#### Step 2.6 — React UI 组件

1. 上游重写的组件：接受上游 + 重新应用 i18n
2. 本分支大幅修改的组件：以上游为基础 + 重新应用 i18n
3. 小改动组件：直接合并

### Phase 3：验证

```bash
# TypeScript 编译检查
npx tsc --noEmit

# Rust 编译检查
cargo check

# 运行测试（单线程+超时）
npm test -- --maxWorkers=1 --testTimeout=60000

# Rust 测试
cargo test
```

### Phase 4：清理与收尾

```bash
# 确认所有冲突已解决
git rebase --continue

# 查看最终状态
git log --oneline -20

# 可选：推送到 origin 备份
# git push origin merge/upstream-sync
```

---

## 5. 风险清单

| # | 风险 | 影响 | 缓解措施 |
|---|------|------|---------|
| R1 | 上游重构组件的 i18n 改动量大 | 需要为 13+ 个 kanban 组件重新套用 t() | 逐个组件处理，先处理核心组件 |
| R2 | 上游新增 fitness section 需补中文翻译 | zh.ts 需新增 ~200 条翻译 | 使用本分支已有的翻译风格为基准 |
| R3 | Rust 新 crate 可能不兼容本分支的 Windows 修复 | 编译失败 | 合并后立即 cargo check 验证 |
| R4 | 上游删除了部分本分支依赖的接口（如旧 prompt handler） | TypeScript 编译错误 | 在上游新接口上重新实现 |
| R5 | rebase 282 个 commit 过程中冲突过多 | rebase 过程漫长且易出错 | 可改用 merge --no-ff 策略 |

---

## 6. 备选方案

如果 rebase 冲突过于复杂，可采用以下替代策略：

### 方案 B：Cherry-pick 策略

```bash
# 基于最新 upstream/main 创建新分支
git checkout -b merge/cherry-pick upstream/main

# 逐个 cherry-pick 本分支的关键 commit
git cherry-pick a17ccfee  # i18n integration
git cherry-pick 9b8429af  # docker detector fix
git cherry-pick 6d550725  # ANSI strip fix
# ... 其他 commit
```

优点：冲突范围更小，可控性更强。
缺点：丢失完整 commit 历史。

### 方案 C：Squash Merge 策略

```bash
# 基于最新 upstream/main
git checkout -b merge/squash upstream/main

# 将本分支所有改动 squash 为一个 commit
git merge --squash fix/windows-compatibility-and-i18n
# 解决冲突后提交
```

优点：历史最简洁。
缺点：丢失逐 commit 的变更上下文。

---

## 7. 预估工作量

| 阶段 | 预估时间 |
|------|---------|
| Phase 0-1：准备与 rebase | 30 分钟 |
| Phase 2.1：i18n 体系冲突解决 | 2-3 小时 |
| Phase 2.2：Rust 后端 | 30 分钟 |
| Phase 2.3-2.4：Hook + Core | 30 分钟 |
| Phase 2.5-2.6：Kanban + 组件 i18n 重做 | 3-4 小时 |
| Phase 3：编译验证与修复 | 1-2 小时 |
| **总计** | **7-10 小时** |
