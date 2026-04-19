---
title: AI Branch Integration Guide
---

# AI 代码分支整合操作指南

> 基于 `fix/windows-compatibility-and-i18n` 与 `upstream/main` 整合实践总结
> 日期：2026-03-31

---

## 1. 整合前准备

### 1.1 远程仓库约束

```
upstream (原作者仓库) → 仅 fetch，禁止 push
origin   (自己 fork)  → 可推送备份，禁止影响 upstream
所有合并操作必须在本地完成
```

### 1.2 信息收集（必须先做）

```
步骤 1: git fetch upstream main          # 拉取最新上游
步骤 2: git merge-base <our-branch> upstream/main  # 找共同祖先
步骤 3: 统计分歧规模
  - 双方各有多少独有 commit
  - 双方各改了多少文件
  - 有多少共同修改文件（潜在冲突）
```

**关键命令**：

```bash
MERGE_BASE=$(git merge-base <our-branch> upstream/main)

# 分歧统计
git log --oneline <our-branch>...upstream/main --left-right

# 共同修改文件
OURS=$(git diff --name-only $MERGE_BASE...<our-branch> | sort)
THEIRS=$(git diff --name-only $MERGE_BASE...upstream/main | sort)
comm -12 <(echo "$OURS") <(echo "$THEIRS")
```

### 1.3 变更分类

在动手之前，必须将变更分为三类：

| 类型 | 说明 | 策略 |
|------|------|------|
| **A: 仅本分支修改** | 上游未触碰的文件 | 直接保留，零冲突 |
| **B: 仅上游修改** | 本分支未触碰的文件 | 直接接受上游 |
| **C: 双方共同修改** | 冲突高发区 | 需要手动合并 |

---

## 2. 分支策略选择

### 2.1 推荐策略：基于上游新建分支

```
upstream/main → 新建合并分支 → 逐主题应用本分支改动 → 推送到 fork
```

**为什么不用 rebase**：当上游有 200+ 新 commit 时，rebase 会逐 commit 产生冲突，过程极其痛苦。

**为什么不用 merge**：会产生双向冲突，且历史混乱。

**新分支策略优势**：
- 干净的线性历史
- 冲突范围可控（只关注本分支的改动如何适配上游新版）
- 可按主题分 commit

### 2.2 操作流程

```bash
# 1. 从上游创建新分支
git checkout -b merge/upstream-sync upstream/main

# 2. 按主题逐个应用本分支改动（而非一次性 merge）
# 详见第 3 节

# 3. 完成后推送到自己的 fork
git push --no-verify origin merge/upstream-sync
```

---

## 3. 按主题拆分提交

### 3.1 拆分原则

将本分支的所有 commit 按变更性质分组，**每组一个 commit**：

| 优先级 | 主题类型 | 示例 |
|--------|---------|------|
| 1 | 后端/基础设施修复 | Rust Windows 兼容、路径处理 |
| 2 | 构建工具链修复 | Hook runtime、process shell |
| 3 | 测试兼容性 | 跨平台测试、临时文件清理 |
| 4 | 类型定义/接口变更 | i18n types、API 接口 |
| 5 | 数据文件（翻译、配置） | en.ts、zh.ts |
| 6 | UI 组件改动 | React 组件 i18n 集成 |
| 7 | 修复提交 | 编译错误修复、审查修复 |

### 3.2 为什么按这个顺序

- **基础设施先行**：后端改动不依赖前端
- **类型定义先于数据**：types.ts 必须先于 en.ts/zh.ts
- **数据先于消费者**：翻译文件必须先于使用翻译的组件
- **修复最后**：只有所有主题都应用后才能发现并修复编译错误

### 3.3 每个主题的处理方法

#### 类型 A：直接保留（上游未改）

```bash
# 方法 1: git show 提取文件
git show <our-branch>:<file> > <file>

# 方法 2: git checkout 提取
git checkout <our-branch> -- <file>
```

#### 类型 B：直接接受上游

不需要任何操作（新分支已基于 upstream/main）。

#### 类型 C：需要合并（双方都改了）

```bash
# 1. 获取本分支的改动 diff
git diff $MERGE_BASE...<our-branch> -- <file>

# 2. 读取上游新版文件
# 用 Read 工具读取当前文件

# 3. 在上游新版基础上手动应用改动
# 用 Edit 工具逐个应用

# 4. 验证编译
npx tsc --noEmit  # TypeScript
cargo check        # Rust
```

---

## 4. 冲突处理实战模式

### 4.1 i18n 翻译体系合并（最常见的高冲突场景）

**场景**：两侧在同一个文件的同一位置追加内容。

**策略：上游为底 + 追加本分支独有内容**

```
1. 读取上游的 types.ts → 作为基底
2. 获取本分支的 diff → 提取新增的 section/field
3. 在上游文件的对应位置追加本分支的新增内容
4. 对 en.ts 和 zh.ts 做同样操作
5. 验证：key 对齐检查（types 的每个字段在 en/zh 中都有值）
```

**验证脚本**：

```bash
# 检查 types.ts 中声明的字段数
grep -c ": string" src/i18n/types.ts

# 检查 en.ts 中的翻译键数（粗略）
# 两侧应该一致
```

### 4.2 组件文件合并（上游重写 + 本分支加 i18n）

**场景**：上游完全重写了组件，本分支只是加了 `useTranslation`。

**策略：在上游新版上重新应用 i18n 模式**

```
1. 读取上游新版组件（已经是最新结构）
2. 添加 import: import { useTranslation } from "@/i18n";
3. 在组件函数体添加: const { t } = useTranslation();
4. 将硬编码字符串替换为 t.xxx.yyy
5. 注意：只替换用户可见的字符串，不替换 CSS 类名、API 路径
```

**常见错误**：
- 在普通函数（非组件/hook）中调用 `useTranslation` → 会触发 React hooks 规则错误
- 解决：将翻译值作为参数传入，或在外层组件获取 t 后传入

### 4.3 Rust 代码合并

**场景**：两侧修改了同一函数（如 unused variable 修复）。

**策略：比较两侧方案，取更好的**

```
1. 上游用 _param_name 前缀 → 更好（明确表示忽略）
2. 本分支用 #[allow(unused_variables)] → 可接受但不够精确
→ 选择上游方案，跳过本分支的改动
```

---

## 5. 并行执行策略

### 5.1 可并行的任务

当有多个**无依赖关系**的主题时，使用 Agent 并行处理：

```
可并行的组合：
- Rust 后端修复 + Hook Runtime 修复 + 测试修复
- i18n types 合并（不可并行，后续依赖它）
- UI 组件 i18n + Kanban i18n（i18n 合并完成后可并行）

不可并行的组合：
- i18n types + en.ts（en.ts 依赖 types.ts 的结构）
- types.ts + 组件改动（组件依赖 types.ts 中的 key）
```

### 5.2 Agent 使用注意事项

```
1. 每个 Agent 给出明确的文件范围，避免交叉修改
2. Agent 完成后必须验证编译
3. Agent 可能在文件中间状态触发 ESLint 自动回滚
   → 解决：用 sed 一次性完成多行修改，或分步 Edit
4. Agent 完成后检查 git status，确认无遗漏
```

---

## 6. 验证检查清单

### 6.1 编译验证

```bash
# TypeScript
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# 记录上游基线错误数，确保不新增

# Rust
cargo check
# 应该 0 错误

# ESLint（如项目配置了）
npm run lint
```

### 6.2 错误基线对比

```bash
# 获取上游错误基线
git stash
git checkout upstream/main -- .
npx tsc --noEmit 2>&1 | grep "error TS" > /tmp/upstream_errors.txt
git checkout merge/upstream-sync -- .

# 获取当前错误
npx tsc --noEmit 2>&1 | grep "error TS" > /tmp/our_errors.txt

# 对比
diff /tmp/upstream_errors.txt /tmp/our_errors.txt
```

### 6.3 推送前检查

```bash
# 确认无未提交的改动
git status --short

# 确认 commit 数量合理
git log --oneline merge/upstream-sync ^upstream/main

# 确认远端约束
git remote -v  # upstream 应该没有 push 记录
```

---

## 7. 审查流程

### 7.1 三路并行审查

```
Agent 1: 后端/工具链变更审查
  - 检查正确性、完整性、副作用、跨平台影响

Agent 2: 翻译体系审查
  - types/en/zh key 对齐
  - 翻译质量（术语一致性）
  - 缺失/重复 key

Agent 3: 组件集成审查
  - Hook 使用规范（只能在组件/hook 中调用）
  - import 完整性
  - 硬编码遗漏
  - key 匹配
```

### 7.2 审查问题分级

| 级别 | 定义 | 处理 |
|------|------|------|
| 🔴 严重 | 运行时错误、编译错误、语义错误 | 必须立即修复 |
| 🟡 中等 | 翻译质量、遗漏翻译 | 本次修复或记录 TODO |
| 🟢 轻微 | 风格问题、建议 | 记录后续改进 |

### 7.3 常见审查发现

```
1. useTranslation 在普通函数中调用 → 改为参数传入
2. 三元运算符两个分支返回相同值 → 修正翻译 key
3. 翻译 key 语义不匹配（noBoard 误用于 activeBoard）→ 新增正确 key
4. 术语翻译不统一（Agent: "智能体" vs "代理"）→ 统一标准译法
5. Hook 调用缺失（import 了但忘了 const { t } = ...）→ 补充
```

---

## 8. 推送与 PR 指南

### 8.1 推送到自己的 fork

```bash
# 推送合并分支
git push --no-verify origin merge/upstream-sync

# 如果要覆盖旧分支
git push --no-verify --force-with-lease origin <old-branch-name>
```

### 8.2 创建 PR 到上游

```
1. 浏览器打开: https://github.com/<owner>/<repo>/compare
2. 选择 base: <upstream>/main
3. 选择 head: <your-fork>/<branch>
4. 填写标题和描述
5. 提交
```

### 8.3 PR 描述模板

```markdown
## Summary
- 一句话概括
- 列出主要变更主题（3-5 个要点）

## Commits（按主题）
1. xxx - 简要说明
2. xxx - 简要说明

## Test plan
- [x] 已通过的验证
- [ ] 需要作者/CI 验证的项目
```

---

## 9. 踩坑记录

### 9.1 pre-commit hook 在 Windows 上失败

```
问题: husky pre-commit 调用 /bin/bash 导致 ENOENT
解决: git commit --no-verify 跳过 hook
注意: 仅在 Windows 环境问题导致 hook 失败时使用
```

### 9.2 ESLint 自动回滚中间状态

```
问题: Edit 工具分步修改时，import 了 useTranslation 但 t 尚未使用，
      ESLint 的 no-unused-vars 规则自动回滚了 import
解决: 用 sed 一次性完成 import + hook 调用 + 字符串替换
```

### 9.3 Agent 在文件路径含方括号时出错

```
问题: Next.js 动态路由文件 [workspaceId] 路径中的方括号
解决: 所有路径用双引号包裹
  git diff -- "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"
  grep -n "pattern" "src/app/workspace/[workspaceId]/..."
```

### 9.4 路径比较在 Windows 上失败

```
问题: git rev-parse --show-toplevel 返回 \\?\ 前缀的 UNC 路径
解决: 使用 canonicalize() 规范化后再比较
  let vcs_root = PathBuf::from(vcs.repo_root...);
  let vcs_root_canonical = vcs_root.canonicalize().unwrap_or(vcs_root);
  assert_eq!(vcs_root_canonical, repo_root);
```

### 9.5 Agent 修改后文件被 linter/formatter 改动

```
问题: 保存文件后 ESLint/Prettier 自动格式化，导致 diff 与预期不符
解决:
  1. 用 Read 重新读取文件后再 Edit
  2. 或者用 Bash + sed 一次性完成修改
  3. 或者在 Edit 前先 Read 确认当前内容
```

---

## 10. 工具使用优先级

```
文件搜索:  Glob > Bash find
内容搜索:  Grep > Bash grep
文件读取:  Read > Bash cat
文件编辑:  Edit > Bash sed（小改动）
          Bash sed > Edit（批量/正则替换）
文件创建:  Write > Bash echo/heredoc
命令执行:  Bash（系统命令、git、编译、测试）
并行任务:  Agent（background） > Agent（foreground）
代码审查:  Agent code-reviewer > 人工审查
```

---

## 11. 快速检查清单

整合开始前，确认以下事项：

- [ ] `git fetch upstream` 成功
- [ ] merge-base 已确定
- [ ] 双方 commit 数和文件数已统计
- [ ] 共同修改文件列表已生成
- [ ] 变更按主题分类完成
- [ ] 新分支从 upstream/main 创建
- [ ] 约束确认：upstream 只读、本地合并、origin 可选推送

整合完成后，确认以下事项：

- [ ] TypeScript 编译错误 ≤ 上游基线
- [ ] Rust cargo check 通过
- [ ] ESLint 无新增错误
- [ ] git status 无遗漏文件
- [ ] commit 数量合理（主题分组）
- [ ] 已 push 到 origin
- [ ] PR 描述已准备
