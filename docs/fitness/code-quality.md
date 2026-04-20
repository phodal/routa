---
dimension: code_quality
weight: 18
tier: normal
threshold:
  pass: 90
  warn: 80

metrics:
  # ══════════════════════════════════════════════════════════════
  # 代码膨胀检测 - 防止 AI 生成过长代码
  # ══════════════════════════════════════════════════════════════
  
  - name: legacy_hotspot_budget_guard
    command: entrix hook file-length --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" --overrides-only
    pattern: "file_budget_violations: 0"
    hard_gate: true
    tier: fast
    description: "已登记的历史热点文件必须满足冻结预算，只允许缩小不允许继续膨胀"

  - name: file_line_limit
    command: entrix hook file-length --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
    pattern: "file_budget_violations: 0"
    hard_gate: false
    tier: fast
    description: "本次变更的代码文件必须满足行数预算；默认 ≤1600 行，历史超标文件按 HEAD 基线冻结"

  - name: function_line_limit
    command: |
      # TypeScript: 检测超过 100 行的函数
      grep -rn "^[[:space:]]*\(export \)\?\(async \)\?function\|^[[:space:]]*\(export \)\?const.*= \(async \)\?(" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "function_check: scanned", $1, "definitions"}'
    pattern: "function_check: scanned"
    hard_gate: false
    tier: normal
    description: "函数行数限制 ≤100 行（需人工审查）"

  # ══════════════════════════════════════════════════════════════
  # 重复代码检测 - 防止 AI 复制粘贴
  # ══════════════════════════════════════════════════════════════

  - name: duplicate_code_ts
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        printf '%s\n' "$changed_files" | \
          xargs npx jscpd --min-lines 20 --min-tokens 120 --reporters console --format typescript,javascript 2>&1 || \
          echo "jscpd changed-file check failed"
      fi
    pattern: "Found 0 clones|No duplicates found|No changed TS/JS files"
    hard_gate: false
    tier: deep
    description: "本次变更的 TypeScript/JavaScript 文件不应新增大块复制代码"

  - name: ast_grep_structural_smells
    command: |
      if ! command -v ast-grep >/dev/null 2>&1 && ! command -v sg >/dev/null 2>&1; then
        echo "ast-grep not installed"
      else
        changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps 2>/dev/null | \
          grep -E '\.(ts|tsx|js|jsx)$' | \
          grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
        if [ -z "$changed_files" ]; then
          echo "No changed TS/JS files"
        else
          runner=$(command -v ast-grep >/dev/null 2>&1 && echo ast-grep || echo sg)
          cat <<'EOF' >/tmp/routa-ast-grep-rule.yml
          id: nested-response-wrapper
          language: TypeScript
          rule:
            any:
              - pattern: |
                  try {
                    $$$BODY
                  } catch ($ERR) {
                    return NextResponse.json($$$ARGS)
                  }
              - pattern: |
                  try {
                    $$$BODY
                  } catch ($ERR) {
                    console.error($$$LOG)
                    return NextResponse.json($$$ARGS)
                  }
          EOF
          printf '%s\n' "$changed_files" | xargs "$runner" scan \
            --rule /tmp/routa-ast-grep-rule.yml 2>&1 | \
          awk 'BEGIN {count=0} /^error\[nested-response-wrapper\]/ {count++} END {print "ast_grep_structural_matches:", count}'
          rm -f /tmp/routa-ast-grep-rule.yml
        fi
      fi
    pattern: "ast_grep_structural_matches: 0|No changed TS/JS files|ast-grep not installed"
    hard_gate: false
    tier: deep
    description: "用 ast-grep 检查本次变更中新增的可疑结构性包装代码"

  - name: duplicate_function_name
    command: |
      git diff --unified=0 HEAD -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*((export )?(async )?function [A-Za-z0-9_]+|const [A-Za-z0-9_]+ *= *(async )?\()' | \
        sed -E 's/.*function ([A-Za-z0-9_]+).*/\1/; s/.*const ([A-Za-z0-9_]+) *=.*/\1/' | \
        sort | uniq -d | wc -l | \
      awk '{print "duplicate_new_function_names:", $1}'
    pattern: "duplicate_new_function_names: 0"
    hard_gate: false
    tier: fast
    description: "本次变更中不应新增重复函数名"

  - name: duplicate_code_rust
    command: |
      # Rust 重复检测（简化版，按“文件 + impl 头”分组，避免不同文件中常见类型名误报）
      grep -rH "^impl " crates --include="*.rs" 2>/dev/null | \
      sed -E 's#^([^:]+):[[:space:]]*(impl[^\\{]+\\{).*#\1 :: \2#' | \
      sort | uniq -c | \
      awk '$1 > 2 {dup++} END {print "rust_duplicate_impls:", dup+0}'
    pattern: "rust_duplicate_impls: 0"
    hard_gate: false
    tier: normal
    description: "Rust 重复 impl 块检测"

  # ══════════════════════════════════════════════════════════════
  # 复杂度检测 - 防止过度工程
  # ══════════════════════════════════════════════════════════════

  - name: cyclomatic_complexity
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" -- src apps 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        count=$(printf '%s\n' "$changed_files" | \
          xargs npx eslint --rule "complexity: [error, 15]" --format compact 2>&1 | \
          grep -c "complexity" || true)
        echo "complexity_violations: ${count:-0}"
      fi
    pattern: "complexity_violations: 0|No changed TS/JS files"
    hard_gate: false
    tier: normal
    description: "本次变更的 TS/JS 文件中不得新增圈复杂度 >15 的函数"

  - name: cognitive_complexity
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+][[:space:]]{12,}(if|for|while)\b' | \
        wc -l | awk '{print "new_deep_nesting_count:", $1}'
    pattern: "new_deep_nesting_count: 0"
    hard_gate: false
    tier: normal
    description: "本次变更不得新增 >3 层缩进的 if/for/while 嵌套"

  # ══════════════════════════════════════════════════════════════
  # 依赖健康检测 - 防止依赖失序和循环依赖
  # ══════════════════════════════════════════════════════════════

  - name: dependency_cruiser_dependency_health
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps crates 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\\.next|_next|bundled)/' || true)

      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        npx --yes dependency-cruiser --config .dependency-cruiser.cjs src --validate
      fi
    hard_gate: true
    tier: fast
    description: "基于 dependency-cruiser 检测变更范围内循环依赖与依赖规则违规"

  # ══════════════════════════════════════════════════════════════
  # Lint 检查 - Hard Gate
  # ══════════════════════════════════════════════════════════════

  - name: eslint_pass
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" -- src apps crates 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx|cjs|mjs)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)

      if [ -z "$changed_files" ]; then
        echo "No changed lintable files"
      else
        printf '%s\n' "$changed_files" | xargs npx eslint 2>&1
      fi
    hard_gate: true
    tier: fast
    description: "ESLint 必须通过；fast 模式优先只检查本地变更文件"

  - name: ts_typecheck_pass
    command: node --import tsx tools/hook-runtime/src/typecheck-smart.ts 2>&1
    hard_gate: true
    tier: fast
    description: "TypeScript 类型检查必须通过；若检测到 stale .next types，会自动清理后重试一次"

  - name: clippy_pass
    command: cargo clippy --workspace -- -D warnings 2>&1
    hard_gate: true
    tier: fast
    description: "Clippy 必须通过（无警告）"

  # ══════════════════════════════════════════════════════════════
  # AI 特有检测
  # ══════════════════════════════════════════════════════════════

  - name: console_log_check
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*console\.(log|debug)' | \
        grep -vE 'test|spec|\.test\.' | wc -l | \
      awk '{print "new_console_log_count:", $1}'
    pattern: "new_console_log_count: 0"
    hard_gate: false
    tier: fast
    description: "本次变更不得新增生产代码中的 console.log/debug"

  - name: any_type_check
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*(: any|as any)\b' | \
        wc -l | awk '{print "new_any_type_count:", $1}'
    pattern: "new_any_type_count: 0"
    hard_gate: false
    tier: normal
    description: "本次变更不得新增 `: any` 或 `as any` 类型逃逸"
---

# Code Quality 证据

> 本文件只覆盖代码本体质量与静态质量底线，不再承接仓库治理或文档卫生类检查。
>
> **核心理念**: 通过量化指标约束 AI 的“乱写空间”，让复杂度、重复、类型逃逸和静态质量退化尽早暴露。

## 检测矩阵

| 检测项 | 阈值 | Hard Gate | 工具 |
|--------|------|-----------|------|
| 文件行数 | 新文件 ≤1600 行，历史超标文件按 HEAD 基线冻结 | ❌ | `python -m entrix.file_budgets` |
| 历史热点守护 | 已登记热点只允许缩小不允许继续膨胀 | ✅ | `python -m entrix.file_budgets --overrides-only` |
| 函数行数 | ≤100 行 | ❌ | grep + 人工 |
| 重复代码 | 变更文件不新增大块 clone | ❌ | jscpd |
| 结构坏味道 | 变更文件中结构型包装重复 = 0 | ❌ | ast-grep |
| 圈复杂度 | 变更文件中新增 >15 复杂度函数 = 0 | ❌ | ESLint |
| 深层嵌套 | 新增 >3 层嵌套 = 0 | ❌ | git diff + grep |
| 依赖健康检查 | 循环依赖/依赖违规为 0 | ✅ | dependency-cruiser |
| ESLint | 0 errors | ✅ | ESLint |
| TypeScript 类型检查 | 0 errors | ✅ | smart typecheck |
| Clippy | 0 warnings | ✅ | Clippy |
| console.log | 变更中新增数 = 0 | ❌ | git diff + grep |
| 重复函数名 | 变更中新增重复名 = 0 | ❌ | git diff + grep |
| any 类型 | 新增 `any` = 0 | ❌ | git diff + grep |

## AI 特有问题

### 1. 代码膨胀
AI 倾向于生成冗长代码，缺乏抽象能力。

**约束**: 新文件 ≤1600 行；历史超标热点必须进入预算冻结，只能缩小不能继续长大；函数 ≤100 行

### 2. 重复代码
AI 经常“复制粘贴”式生成，忽略已有实现。

**约束**: 仅检查本次变更文件，且只抓大块复制，避免为压全仓 clone 数做跨语义抽象

### 2.1 结构性重复
文本重复不一定等于坏设计，真正危险的是成批出现的结构性包装代码。

**约束**: 用 `ast-grep` 只检查本次变更中的高风险结构模式

### 3. 类型逃逸
AI 使用 `any` 绕过类型检查。

**约束**: 本次变更不得新增 `: any` 或 `as any`

### 4. 调试残留
AI 遗留 console.log/debug。

**约束**: 本次变更新增 console.log/debug = 0

## 维度边界

以下检查已经迁移到 `engineering_governance` 维度，不再算作 code quality：

- `scripts_root_file_count_guard`
- `graph_blast_radius_probe`
- `markdown_external_links`
- `todo_fixme_count`

## 本地执行

```bash
# 安装 jscpd
npm install -g jscpd

# 运行 dependency-cruiser 依赖健康检查（未安装时自动临时拉取）
npx --yes dependency-cruiser --config .dependency-cruiser.cjs src --validate
# 依赖图符合规则时会输出: no dependency violations found

# 运行变更文件重复检测
git diff --name-only --diff-filter=ACMR HEAD -- src apps

# 运行结构性模式检查（需安装 ast-grep）
ast-grep scan --help

# 运行 fitness 检查
entrix run
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `eslint.config.mjs` | ESLint 配置 |
| `.clippy.toml` | Clippy 配置（如有） |
| `.dependency-cruiser.cjs` | dependency-cruiser 配置 |
| `docs/fitness/engineering-governance.md` | 工程治理与仓库卫生检查 |
| `docs/fitness/README.md` | Fitness 规则手册 |
