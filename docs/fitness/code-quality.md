---
dimension: maintainability
weight: 14
threshold:
  pass: 90
  warn: 80

metrics:
  # ══════════════════════════════════════════════════════════════
  # 代码膨胀检测 - 防止 AI 生成过长代码
  # ══════════════════════════════════════════════════════════════
  
  - name: file_line_limit
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps crates 2>/dev/null | \
        grep -E '\.(ts|tsx|rs)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
      if [ -z "$changed_files" ]; then
        echo "changed_files_over_1000_lines: 0"
      else
        printf '%s\n' "$changed_files" | xargs wc -l 2>/dev/null | grep -v total | \
          awk '$1 > 1000 {count++} END {print "changed_files_over_1000_lines:", count+0}'
      fi
    pattern: "changed_files_over_1000_lines: 0"
    hard_gate: false
    description: "本次变更的代码文件行数限制 ≤1000 行"

  - name: function_line_limit
    command: |
      # TypeScript: 检测超过 100 行的函数
      grep -rn "^[[:space:]]*\(export \)\?\(async \)\?function\|^[[:space:]]*\(export \)\?const.*= \(async \)\?(" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "function_check: scanned", $1, "definitions"}'
    pattern: "function_check: scanned"
    hard_gate: false
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
    description: "本次变更中不应新增重复函数名"

  - name: duplicate_code_rust
    command: |
      # Rust 重复检测（简化版，检查相似的 impl 块）
      grep -rh "^impl " crates --include="*.rs" 2>/dev/null | sort | uniq -c | \
      awk '$1 > 3 {dup++} END {print "rust_duplicate_impls:", dup+0}'
    pattern: "rust_duplicate_impls: 0"
    hard_gate: false
    description: "Rust 重复 impl 块检测"

  # ══════════════════════════════════════════════════════════════
  # 复杂度检测 - 防止过度工程
  # ══════════════════════════════════════════════════════════════

  - name: cyclomatic_complexity
    command: |
      npx eslint --rule "complexity: [error, 15]" --format compact src 2>&1 | grep -c "complexity" || echo "0"
    pattern: "^0$|No files"
    hard_gate: false
    description: "圈复杂度限制 ≤15"

  - name: cognitive_complexity
    command: |
      # 检查是否有超过 3 层嵌套的代码
      grep -rn "^[[:space:]]\{12,\}if\|^[[:space:]]\{12,\}for\|^[[:space:]]\{12,\}while" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "deep_nesting_count:", $1}'
    pattern: "deep_nesting_count: [0-9]$"
    hard_gate: false
    description: "深层嵌套检测（>3层）"

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
    description: "基于 dependency-cruiser 检测变更范围内循环依赖与依赖规则违规"

  # ══════════════════════════════════════════════════════════════
  # Lint 检查 - Hard Gate
  # ══════════════════════════════════════════════════════════════

  - name: eslint_pass
    command: npm run lint 2>&1 && echo "eslint passed"
    pattern: "eslint passed"
    hard_gate: true
    description: "ESLint 必须通过"

  - name: clippy_pass
    command: cargo clippy --workspace -- -D warnings 2>&1 || true
    pattern: "Finished|could not find|warning: 0 warnings"
    hard_gate: true
    description: "Clippy 必须通过（无警告）"

  # ══════════════════════════════════════════════════════════════
  # AI 特有检测
  # ══════════════════════════════════════════════════════════════

  - name: todo_fixme_count
    command: |
      grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.ts" --include="*.tsx" --include="*.rs" \
        src apps crates 2>/dev/null | wc -l | awk '{print "todo_count:", $1}'
    pattern: "todo_count: [0-9]$|todo_count: [1-9][0-9]$"
    hard_gate: false
    description: "TODO/FIXME 数量监控（<100）"

  - name: console_log_check
    command: |
      git diff --unified=0 HEAD -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*console\.(log|debug)' | \
        grep -vE 'test|spec|\.test\.' | wc -l | \
      awk '{print "new_console_log_count:", $1}'
    pattern: "new_console_log_count: 0"
    hard_gate: false
    description: "本次变更不得新增生产代码中的 console.log/debug"

  - name: any_type_check
    command: |
      grep -rn ": any\|as any" --include="*.ts" --include="*.tsx" \
        src apps 2>/dev/null | wc -l | awk '{print "any_type_count:", $1}'
    pattern: "any_type_count: [0-9]$|any_type_count: [1-4][0-9]$"
    hard_gate: false
    description: "TypeScript any 类型使用检测（<50）"
---

# Code Quality 证据

> 本文件检测 AI 生成代码的常见质量问题，作为 maintainability 维度的补充证据。
>
> **核心理念**: 通过量化指标约束 AI 的"乱写空间"，防止代码膨胀和质量退化。

## 检测矩阵

| 检测项 | 阈值 | Hard Gate | 工具 |
|--------|------|-----------|------|
| 文件行数 | 变更文件 ≤1000 行 | ❌ | wc -l |
| 函数行数 | ≤100 行 | ❌ | grep + 人工 |
| 重复代码 | 变更文件不新增大块 clone | ❌ | jscpd |
| 结构坏味道 | 变更文件中结构型包装重复 = 0 | ❌ | ast-grep |
| 圈复杂度 | ≤15 | ❌ | ESLint |
| 深层嵌套 | ≤3 层 | ❌ | grep |
| 依赖健康检查 | 循环依赖/依赖违规为 0 | ❌ | dependency-cruiser |
| ESLint | 0 errors | ✅ | ESLint |
| Clippy | 0 warnings | ✅ | Clippy |
| TODO/FIXME | <100 | ❌ | grep |
| console.log | 变更中新增数 = 0 | ❌ | git diff + grep |
| 重复函数名 | 变更中新增重复名 = 0 | ❌ | git diff + grep |
| any 类型 | <50 | ❌ | grep |

## AI 特有问题

### 1. 代码膨胀
AI 倾向于生成冗长代码，缺乏抽象能力。

**约束**: 变更文件 ≤1000 行，函数 ≤100 行

### 2. 重复代码
AI 经常"复制粘贴"式生成，忽略已有实现。

**约束**: 仅检查本次变更文件，且只抓大块复制，避免为压全仓 clone 数做跨语义抽象

### 2.1 结构性重复
文本重复不一定等于坏设计，真正危险的是成批出现的结构性包装代码。

**约束**: 用 `ast-grep` 只检查本次变更中的高风险结构模式

### 3. 类型逃逸
AI 使用 `any` 绕过类型检查。

**约束**: any 类型 <50 处

### 4. 调试残留
AI 遗留 console.log 和 TODO。

**约束**: 本次变更新增 console.log/debug = 0，TODO <100

## 本地执行

```bash
# 安装 jscpd
npm install -g jscpd

# 运行 dependency-cruiser（未安装时自动临时拉取）
npx --yes dependency-cruiser --version

# 运行变更文件重复检测
git diff --name-only --diff-filter=ACMR HEAD -- src apps

# 运行结构性模式检查（需安装 ast-grep）
ast-grep scan --help

# 运行 fitness 检查
python3 docs/fitness/scripts/fitness.py
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `eslint.config.mjs` | ESLint 配置 |
| `.clippy.toml` | Clippy 配置（如有） |
| `.dependency-cruiser.cjs` | dependency-cruiser 配置 |
| `docs/fitness/README.md` | Fitness 规则手册 |
